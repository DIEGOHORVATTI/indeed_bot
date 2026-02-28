/**
 * Bot orchestrator — state machine that drives the application flow.
 * Ported from Python bot.py.
 */

import { BotState, BotStatus, JobEntry, LogEntry, Message, Settings } from '../types';
import { JobRegistry } from '../services/job-registry';
import { AnswerCache } from '../services/answer-cache';
import { askClaudeForAnswer, generateTailoredContent } from '../services/claude';
import { fillCvTemplate, fillCoverTemplate, loadTemplates } from '../services/pdf';
import { createTabGroup, addTabToGroup, closeTab, navigateTab, waitForTabLoad } from './tab-group';
import { notifyUserInput } from '../utils/notifications';

const registry = new JobRegistry();
const cache = new AnswerCache();

let state: BotState = 'idle';
let appliedCount = 0;
let skippedCount = 0;
let jobs: JobEntry[] = [];
let currentJobIndex = 0;
let log: LogEntry[] = [];
let botTabId: number | null = null;
let settings: Settings | null = null;
let stopRequested = false;

// ── Logging ──

function addLog(level: LogEntry['level'], message: string): void {
  log.push({ timestamp: Date.now(), level, message });
  if (log.length > 200) log = log.slice(-100);
  broadcastStatus();
}

function broadcastStatus(): void {
  const status = getStatus();
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: status }).catch(() => {});
}

export function getStatus(): BotStatus {
  return {
    state,
    appliedCount,
    skippedCount,
    totalJobs: jobs.length,
    currentJob: jobs[currentJobIndex]?.title || jobs[currentJobIndex]?.url,
    log: log.slice(-50),
  };
}

// ── Helpers ──

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return delay(minMs + Math.random() * (maxMs - minMs));
}

async function sendToTab(tabId: number, message: Message): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response);
    });
  });
}

// ── Main Bot Loop ──

export async function startBot(userSettings: Settings): Promise<void> {
  if (state !== 'idle') return;

  settings = userSettings;
  state = 'collecting';
  appliedCount = 0;
  skippedCount = 0;
  jobs = [];
  currentJobIndex = 0;
  log = [];
  stopRequested = false;

  await registry.load();
  await cache.load();
  await loadTemplates();

  addLog('info', 'Bot started');
  broadcastStatus();

  try {
    await collectAndApply();
  } catch (err) {
    addLog('error', `Bot error: ${err}`);
  } finally {
    state = 'idle';
    addLog('info', `Bot finished. Applied: ${appliedCount}, Skipped: ${skippedCount}`);
    broadcastStatus();
  }
}

export function stopBot(): void {
  stopRequested = true;
  state = 'idle';
  addLog('info', 'Bot stopped by user');
  broadcastStatus();
}

export function pauseBot(): void {
  if (state === 'applying' || state === 'collecting') {
    state = 'paused';
    addLog('info', 'Bot paused');
    broadcastStatus();
  }
}

export function resumeBot(): void {
  if (state === 'paused') {
    state = 'applying';
    addLog('info', 'Bot resumed');
    broadcastStatus();
  }
}

// ── Collection + Application ──

async function collectAndApply(): Promise<void> {
  if (!settings) return;

  for (const searchUrl of settings.searchUrls) {
    if (stopRequested) break;

    addLog('info', `Collecting from: ${searchUrl}`);

    // Create tab group if first URL
    if (!botTabId) {
      const { tabId } = await createTabGroup(searchUrl);
      botTabId = tabId;
    } else {
      await navigateTab(botTabId, searchUrl);
    }

    await waitForTabLoad(botTabId, 15000);
    await delay(2000); // Wait for Indeed to fully render

    // Collect links from content script
    const response = await sendToTab(botTabId, { type: 'COLLECT_LINKS' });
    const links: { url: string; jobKey: string }[] = response?.payload || [];

    // Filter known jobs
    const newLinks: { url: string; jobKey: string }[] = [];
    for (const link of links) {
      if (await registry.isKnown(link.jobKey)) continue;
      newLinks.push(link);
    }

    const skipped = links.length - newLinks.length;
    addLog('info', `Found ${newLinks.length} new jobs${skipped ? ` (${skipped} already processed)` : ''}`);

    // Add to job list
    for (const link of newLinks) {
      jobs.push({
        url: link.url,
        jobKey: link.jobKey,
        status: 'pending',
      });
    }

    await randomDelay(2000, 4000);
  }

  // Apply to collected jobs
  state = 'applying';
  broadcastStatus();

  for (let i = 0; i < jobs.length; i++) {
    if (stopRequested) break;
    if ((state as BotState) === 'paused') {
      while ((state as BotState) === 'paused' && !stopRequested) {
        await delay(1000);
      }
    }
    if (stopRequested) break;

    if (settings!.maxApplies > 0 && appliedCount >= settings!.maxApplies) {
      addLog('info', `Reached max applies limit (${settings!.maxApplies})`);
      break;
    }

    currentJobIndex = i;
    const job = jobs[i];

    if (await registry.isKnown(job.jobKey)) {
      job.status = 'skipped';
      job.skipReason = 'already_processed';
      skippedCount++;
      continue;
    }

    addLog('info', `[${appliedCount + 1}${settings!.maxApplies ? '/' + settings!.maxApplies : ''}] Applying: ${job.url}`);

    const result = await applyToJob(job);

    if (result === true) {
      job.status = 'applied';
      appliedCount++;
      await registry.markApplied(job.jobKey);
      addLog('info', `Applied successfully to ${job.title || job.url}`);
    } else if (typeof result === 'string') {
      job.status = 'skipped';
      job.skipReason = result;
      skippedCount++;
      await registry.markSkipped(job.jobKey, result);
      addLog('warning', `Skipped: ${result}`);
    } else {
      job.status = 'failed';
      addLog('error', `Failed to apply to ${job.url}`);
    }

    broadcastStatus();
    await randomDelay(3000, 7000);
  }
}

// ── Apply to Single Job ──

async function applyToJob(job: JobEntry): Promise<true | string | false> {
  if (!botTabId || !settings) return false;

  // Navigate to job page
  await navigateTab(botTabId, job.url);
  await waitForTabLoad(botTabId, 15000);
  await delay(2000);

  // Check URL is still Indeed
  const tab = await chrome.tabs.get(botTabId);
  if (!tab.url || !tab.url.includes('indeed.com')) {
    return 'redirected_external';
  }

  // Scrape job info
  const scrapeResponse = await sendToTab(botTabId, { type: 'SCRAPE_JOB' });
  const jobInfo = scrapeResponse?.payload || {};
  job.title = jobInfo.title;
  job.company = jobInfo.company;

  // Generate tailored CV if enabled
  let cvPdfData: ArrayBuffer | undefined;
  let cvFilename: string | undefined;
  let coverPdfData: ArrayBuffer | undefined;
  let coverFilename: string | undefined;

  if (settings.personalization.enabled && settings.backendUrl && jobInfo.description) {
    try {
      addLog('info', `Generating tailored CV for: ${jobInfo.title} at ${jobInfo.company}`);
      const tailored = await generateTailoredContent(
        jobInfo,
        settings.personalization.baseCv,
        settings.personalization.baseCoverLetter,
        settings.backendUrl
      );

      const cvHtml = fillCvTemplate(tailored, settings.profile);
      const coverHtml = fillCoverTemplate(tailored, settings.profile);

      // PDF generation would need offscreen document or content script
      // For now, we'll pass HTML to content script and let it handle PDF
      // This is a simplification — full implementation would use offscreen API
      addLog('info', 'CV generated successfully');
    } catch (err) {
      addLog('warning', `CV generation failed: ${err}`);
    }
  }

  // Click Apply button
  const applyResponse = await sendToTab(botTabId, { type: 'CLICK_APPLY' });
  const applyResult = applyResponse?.payload;

  if (applyResult === 'external') return 'external_apply';
  if (applyResult === 'not_found') return 'no_apply_button';

  // Wait for wizard to load
  await delay(3000);

  // Walk through wizard steps
  const startTime = Date.now();
  const MAX_STEPS = 10;
  const TIMEOUT_MS = 60000;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      addLog('warning', 'Wizard timeout');
      break;
    }

    // Send fill and advance command to smartapply content script
    // We need to find the smartapply frame's tab
    const stepResponse = await sendToTab(botTabId, {
      type: 'FILL_AND_ADVANCE',
      payload: {
        cvData: cvPdfData,
        cvFilename,
        coverData: coverPdfData,
        coverFilename,
        jobTitle: job.title || '',
      },
    });

    const stepResult = stepResponse?.payload?.action;

    if (stepResult === 'submitted') {
      addLog('info', 'Application submitted');
      await delay(2000);
      return true;
    } else if (stepResult === 'needs_input') {
      // Notify user
      state = 'waiting_user';
      broadcastStatus();
      await notifyUserInput(
        job.title || 'Unknown job',
        stepResponse?.payload?.fieldLabel || 'Unknown field',
        botTabId
      );
      addLog('warning', `User input needed: ${stepResponse?.payload?.fieldLabel}`);
      // Wait for user to fill the field (poll every 5s for up to 5 minutes)
      for (let wait = 0; wait < 60; wait++) {
        if (stopRequested) return false;
        await delay(5000);
        // Check if field is now filled
        const retryResponse = await sendToTab(botTabId, {
          type: 'FILL_AND_ADVANCE',
          payload: { jobTitle: job.title || '' },
        });
        if (retryResponse?.payload?.action !== 'needs_input') {
          state = 'applying';
          if (retryResponse?.payload?.action === 'submitted') return true;
          break;
        }
      }
      state = 'applying';
    } else if (stepResult === 'continued') {
      await delay(2000);
      // Check for confirmation page
      const tabInfo = await chrome.tabs.get(botTabId);
      const url = tabInfo.url || '';
      if (url.includes('confirmation') || url.includes('submitted') || url.includes('success')) {
        return true;
      }
    } else {
      addLog('warning', `No button found at step ${step + 1}`);
      break;
    }
  }

  return false;
}
