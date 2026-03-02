/**
 * Bot orchestrator — state machine that drives the application flow.
 * Human-review mode: auto-fills forms, user clicks native buttons to advance.
 * Supports concurrent tab workers for parallel applications.
 */

import { BotState, BotStatus, JobEntry, LogEntry, Message, Settings } from '../types';
import { JobRegistry } from '../services/job-registry';
import { AnswerCache } from '../services/answer-cache';
import { generateTailoredContent, generatePdfFromHtml, fetchExistingPdf } from '../services/claude';
import {
  fillCvTemplate,
  fillCoverTemplate,
  fillCvWithCoverTemplate,
  loadTemplates
} from '../services/pdf';
import { createTabGroup, addTabToGroup, closeTab, navigateTab, waitForTabLoad } from './tab-group';

const registry = new JobRegistry();
const cache = new AnswerCache();

export function getCache(): AnswerCache {
  return cache;
}

// ── State ──

interface TabWorker {
  tabId: number;
  job: JobEntry;
  state: 'navigating' | 'filling' | 'waiting_review' | 'done';
  cvPayload?: any; // Cached CV data for re-sending on STEP_ADVANCED
}

let state: BotState = 'idle';
let appliedCount = 0;
let skippedCount = 0;
let failedCount = 0;
let jobs: JobEntry[] = [];
let currentJobIndex = 0;
let log: LogEntry[] = [];
let settings: Settings | null = null;
let stopRequested = false;
let currentSearchUrl = '';
let currentSearchIndex = 0;
let totalSearchUrls = 0;
let currentPage = 0;
let totalPages = 0;
let estimatedTotalJobs = 0;

// Worker pool
let tabWorkers: TabWorker[] = [];
let collectionTabId: number | null = null;

// PDF cache — reuse previously generated CVs by safeTitle key
const pdfCache = new Map<
  string,
  {
    cvPdfData: ArrayBuffer;
    cvOnlyPdfData: ArrayBuffer;
    coverPdfData: ArrayBuffer;
    cvFilename: string;
    coverFilename: string;
  }
>();

// ── Logging ──

export function addLog(level: LogEntry['level'], message: string): void {
  const prefix = `[bot:${state}]`;
  console.log(`${prefix} [${level}] ${message}`);
  log.push({ timestamp: Date.now(), level, message });
  if (log.length > 200) log = log.slice(-100);
  broadcastStatus();
}

function broadcastStatus(): void {
  const status = getStatus();
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: status }).catch(() => {});
}

export function getStatus(): BotStatus {
  const pending = jobs.filter((j) => j.status === 'pending').length;
  const activeWorkers = tabWorkers.filter((w) => w.state !== 'done').length;
  return {
    state,
    appliedCount,
    skippedCount,
    failedCount,
    pendingJobs: pending,
    totalJobs: jobs.length,
    currentJob:
      tabWorkers.find((w) => w.state !== 'done')?.job?.title || jobs[currentJobIndex]?.title,
    currentSearchUrl,
    currentSearchIndex,
    totalSearchUrls,
    currentPage,
    totalPages,
    estimatedTotalJobs,
    activeWorkers,
    concurrentTabs: settings?.concurrentTabs || 1,
    log: log.slice(-50)
  };
}

// ── Helpers ──

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return delay(minMs + Math.random() * (maxMs - minMs));
}

function buildPageUrl(baseUrl: string, startOffset: number): string {
  try {
    const url = new URL(baseUrl);
    if (startOffset > 0) {
      url.searchParams.set('start', String(startOffset));
    } else {
      url.searchParams.delete('start');
    }
    return url.toString();
  } catch {
    // Fallback for malformed URLs
    const separator = baseUrl.includes('?') ? '&' : '?';
    return startOffset > 0 ? `${baseUrl}${separator}start=${startOffset}` : baseUrl;
  }
}

async function sendToTab(tabId: number, message: Message, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    const response = await new Promise<any>((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) resolve(undefined);
        else resolve(resp);
      });
    });
    if (response !== undefined) return response;
    if (i < retries - 1) await delay(2000);
  }
  return undefined;
}

// ── Main Bot Loop ──

export async function startBot(userSettings: Settings): Promise<void> {
  if (state !== 'idle') return;

  settings = userSettings;
  state = 'collecting';
  appliedCount = 0;
  skippedCount = 0;
  failedCount = 0;
  jobs = [];
  currentJobIndex = 0;
  log = [];
  stopRequested = false;
  currentSearchUrl = '';
  currentSearchIndex = 0;
  totalSearchUrls = settings.searchUrls.length;
  tabWorkers = [];
  collectionTabId = null;

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
  // Close all worker tabs
  for (const worker of tabWorkers) {
    closeTab(worker.tabId).catch(() => {});
  }
  tabWorkers = [];
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

// ── Collection Phase ──

async function collectAllJobs(): Promise<void> {
  if (!settings) return;

  totalSearchUrls = settings.searchUrls.length;

  for (let searchIdx = 0; searchIdx < settings.searchUrls.length; searchIdx++) {
    if (stopRequested) break;

    const searchUrl = settings.searchUrls[searchIdx];
    currentSearchUrl = searchUrl;
    currentSearchIndex = searchIdx;

    addLog('info', `[Link ${searchIdx + 1}/${totalSearchUrls}] Collecting from: ${searchUrl}`);

    let pageNum = 1;
    currentPage = 0;
    totalPages = 0;
    estimatedTotalJobs = 0;
    const batchStartIndex = jobs.length;
    const JOBS_PER_PAGE = 10;
    let consecutiveEmptyPages = 0;
    let tabRetries = 0;
    const MAX_TAB_RETRIES = 3;

    while (!stopRequested) {
      // Build page URL using &start= parameter (0-indexed: page1=0, page2=10, page3=20...)
      const startOffset = (pageNum - 1) * JOBS_PER_PAGE;
      const pageUrl = buildPageUrl(searchUrl, startOffset);

      console.log(`[collect] Page ${pageNum} → ${pageUrl}`);

      // Create or navigate the collection tab
      try {
        if (!collectionTabId) {
          const { tabId } = await createTabGroup(pageUrl);
          collectionTabId = tabId;
          console.log(`[collect] Created new collection tab ${collectionTabId}`);
        } else {
          await navigateTab(collectionTabId, pageUrl);
        }

        await waitForTabLoad(collectionTabId, 15000);
        await delay(2000);
      } catch (err) {
        console.warn(`[collect] Tab navigation failed on page ${pageNum}:`, err);
        // Tab might have been closed — try to recreate
        collectionTabId = null;
        tabRetries++;
        if (tabRetries > MAX_TAB_RETRIES) {
          addLog(
            'error',
            `Collection tab failed ${MAX_TAB_RETRIES} times, giving up on this search`
          );
          break;
        }
        addLog(
          'warning',
          `Collection tab lost, recreating (retry ${tabRetries}/${MAX_TAB_RETRIES})...`
        );
        await delay(2000);
        continue; // Retry same page with a new tab
      }

      // Verify tab is still on Indeed (didn't redirect to error/404)
      try {
        const tab = await chrome.tabs.get(collectionTabId);
        console.log(`[collect] Tab URL after load: ${tab.url}`);
        if (!tab.url || !tab.url.includes('indeed.com')) {
          addLog('warning', `Page ${pageNum} redirected to ${tab.url}, skipping`);
          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= 2) break;
          pageNum++;
          await randomDelay(2000, 4000);
          continue;
        }
      } catch {
        // Tab was closed externally — recreate it and retry same page
        console.warn(`[collect] Tab ${collectionTabId} no longer exists, recreating`);
        collectionTabId = null;
        tabRetries++;
        if (tabRetries > MAX_TAB_RETRIES) {
          addLog('error', `Collection tab died ${MAX_TAB_RETRIES} times, giving up on this search`);
          break;
        }
        addLog(
          'warning',
          `Collection tab closed, recreating (retry ${tabRetries}/${MAX_TAB_RETRIES})...`
        );
        await delay(2000);
        continue; // Retry same page
      }

      // Tab survived — reset retry counter
      tabRetries = 0;
      currentPage = pageNum;
      broadcastStatus();

      // Try to get total count on every page until we get a reliable estimate
      if (estimatedTotalJobs === 0) {
        const countResp = await sendToTab(collectionTabId, {
          type: 'GET_TOTAL_COUNT'
        });
        if (countResp?.payload) {
          const rawJobCount = countResp.payload.totalJobs || 0;
          const rawPageCount = countResp.payload.totalPages || 0;

          if (rawJobCount > 0) {
            // Reliable count from page content
            estimatedTotalJobs = rawJobCount;
            totalPages = Math.ceil(estimatedTotalJobs / JOBS_PER_PAGE);
            addLog('info', `Found ~${estimatedTotalJobs} jobs across ~${totalPages} page(s)`);
          } else if (pageNum === 1) {
            // Page 1 has no count — don't set totalPages yet, let pagination discover it
            addLog('info', `Page 1 has no job count — will keep paginating until no more results`);
          }
          console.log(
            `[collect] Page ${pageNum} count check: rawJobs=${rawJobCount}, rawPages=${rawPageCount}, estimatedTotal=${estimatedTotalJobs}, totalPages=${totalPages}`
          );
          broadcastStatus();
        }
      }

      const response = await sendToTab(collectionTabId, {
        type: 'COLLECT_LINKS'
      });
      const links: { url: string; jobKey: string }[] = response?.payload || [];

      console.log(`[collect] Page ${pageNum}: got ${links.length} links`);

      if (links.length === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 3) {
          addLog('info', `3 consecutive empty pages — stopping collection after page ${pageNum}`);
          break;
        }
        addLog(
          'info',
          `Page ${pageNum} empty (${consecutiveEmptyPages}/3 consecutive), trying next page...`
        );
        pageNum++;
        await randomDelay(2000, 4000);
        continue;
      }

      consecutiveEmptyPages = 0;

      const newLinks: { url: string; jobKey: string }[] = [];
      for (const link of links) {
        if (await registry.isKnown(link.jobKey)) continue;
        newLinks.push(link);
      }

      for (const link of newLinks) {
        jobs.push({ url: link.url, jobKey: link.jobKey, status: 'pending' });
      }

      const skipped = links.length - newLinks.length;
      const totalNew = jobs.length - batchStartIndex;
      const pageInfo = totalPages > 0 ? ` (page ${pageNum}/${totalPages})` : '';
      const totalInfo =
        estimatedTotalJobs > 0 ? ` — ${totalNew}/${estimatedTotalJobs}` : ` — ${totalNew} total`;
      addLog(
        'info',
        `Page ${pageNum}${pageInfo}: +${newLinks.length} new${skipped ? ` (${skipped} known)` : ''}${totalInfo}`
      );
      console.log(
        `[collect] Page ${pageNum}: +${newLinks.length} new, ${skipped} known, ${totalNew} total collected`
      );
      broadcastStatus();

      // Stop if we've collected all estimated jobs or exceeded total pages
      // Only trust totalPages if we got a reliable job count (estimatedTotalJobs > 0)
      if (estimatedTotalJobs > 0 && totalPages > 0 && pageNum >= totalPages) {
        addLog(
          'info',
          `Reached last page (${pageNum}/${totalPages}) — collection done: ${totalNew} jobs`
        );
        break;
      }

      pageNum++;
      await randomDelay(2000, 4000);
    }

    const totalCollected = jobs.length - batchStartIndex;
    addLog(
      'info',
      `[Link ${searchIdx + 1}/${totalSearchUrls}] Collection complete: ${totalCollected} jobs from ${pageNum} page(s)`
    );
    console.log(
      `[collect] Search URL #${searchIdx + 1} finished: ${totalCollected} jobs collected from ${pageNum} pages`
    );
  }

  // Close collection tab
  if (collectionTabId) {
    await closeTab(collectionTabId);
    collectionTabId = null;
  }
}

// ── Application Phase (event-driven worker pool) ──

async function collectAndApply(): Promise<void> {
  // Phase 1: Collect all jobs
  console.log('[bot] === PHASE 1: COLLECTION START ===');
  await collectAllJobs();
  console.log(`[bot] === PHASE 1: COLLECTION END — ${jobs.length} total jobs ===`);

  const pendingJobs = jobs.filter((j) => j.status === 'pending');
  if (pendingJobs.length === 0) {
    addLog('info', 'No jobs to apply');
    return;
  }

  // Phase 2: Launch concurrent workers
  console.log(`[bot] === PHASE 2: APPLYING START — ${pendingJobs.length} pending jobs ===`);
  state = 'applying';
  broadcastStatus();

  const maxTabs = settings?.concurrentTabs || 1;
  const numWorkers = Math.min(maxTabs, pendingJobs.length);

  addLog('info', `Starting ${numWorkers} concurrent tab(s) for ${pendingJobs.length} jobs`);

  for (let i = 0; i < numWorkers; i++) {
    if (stopRequested) break;
    await launchNextWorker();
    await delay(500); // Stagger tab creation slightly
  }

  // Wait for all workers to finish (event-driven via onStepAdvanced / onTabSubmitted)
  while (!stopRequested) {
    const activeWorkers = tabWorkers.filter((w) => w.state !== 'done').length;
    const hasPending = jobs.some((j) => j.status === 'pending');

    if (activeWorkers === 0 && !hasPending) break;
    if (activeWorkers === 0 && hasPending) {
      // All workers finished but still pending jobs — launch more
      await launchNextWorker();
    }

    await delay(1000);
  }
}

function getNextPendingJob(): JobEntry | null {
  return jobs.find((j) => j.status === 'pending') || null;
}

async function launchNextWorker(): Promise<void> {
  if (stopRequested || !settings) return;

  if (settings.maxApplies > 0 && appliedCount >= settings.maxApplies) {
    addLog('info', `Reached max applies limit (${settings.maxApplies})`);
    return;
  }

  const job = getNextPendingJob();
  if (!job) return;

  // Mark job so it's not picked by another worker
  job.status = 'skipped'; // Temporarily mark as in-progress
  job.skipReason = 'in_progress';

  const worker: TabWorker = {
    tabId: -1,
    job,
    state: 'navigating'
  };
  tabWorkers.push(worker);

  try {
    await prepareAndFillJob(worker);
  } catch (err) {
    addLog('error', `Worker error for ${job.title || job.url}: ${err}`);
    job.status = 'failed';
    failedCount++;
    worker.state = 'done';
    broadcastStatus();
  }
}

async function prepareAndFillJob(worker: TabWorker): Promise<void> {
  if (!settings) return;
  const job = worker.job;

  // Create tab and navigate to job page
  const { tabId } = await createTabGroup(job.url);
  worker.tabId = tabId;

  await waitForTabLoad(tabId, 15000);
  await delay(2000);

  // Check URL is still Indeed
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.includes('indeed.com')) {
    job.status = 'skipped';
    job.skipReason = 'redirected_external';
    skippedCount++;
    worker.state = 'done';
    await closeTab(tabId);
    broadcastStatus();
    return;
  }

  // Scrape job info
  const scrapeResponse = await sendToTab(tabId, { type: 'SCRAPE_JOB' });
  const jobInfo = scrapeResponse?.payload || {};
  job.title = jobInfo.title;
  job.company = jobInfo.company;

  addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] ${job.title} at ${job.company}`);
  broadcastStatus();

  // Generate tailored CV if enabled (with cache reuse)
  let cvPdfData: ArrayBuffer | undefined;
  let cvOnlyPdfData: ArrayBuffer | undefined;
  let cvFilename: string | undefined;
  let coverPdfData: ArrayBuffer | undefined;
  let coverFilename: string | undefined;

  if (settings.personalization.enabled && settings.backendUrl && jobInfo.description) {
    const safeTitle = (jobInfo.title || 'job')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .substring(0, 60);

    // Check in-memory cache first
    const cached = pdfCache.get(safeTitle);
    if (cached) {
      addLog('info', `Reusing cached CVs for: ${jobInfo.title}`);
      cvPdfData = cached.cvPdfData;
      cvOnlyPdfData = cached.cvOnlyPdfData;
      coverPdfData = cached.coverPdfData;
      cvFilename = cached.cvFilename;
      coverFilename = cached.coverFilename;
    } else {
      // Check if PDFs already exist on disk (output/ folder)
      cvFilename = `CV_${safeTitle}.pdf`;
      coverFilename = `Cover_${safeTitle}.pdf`;
      const cvCoverFilename = `CV_Cover_${safeTitle}.pdf`;

      const [existingCv, existingCvCover, existingCover] = await Promise.all([
        fetchExistingPdf(settings.backendUrl, cvFilename),
        fetchExistingPdf(settings.backendUrl, cvCoverFilename),
        fetchExistingPdf(settings.backendUrl, coverFilename)
      ]);

      if (existingCv && existingCvCover && existingCover) {
        addLog('info', `Reusing existing PDFs from output/ for: ${jobInfo.title}`);
        cvOnlyPdfData = existingCv;
        cvPdfData = existingCvCover;
        coverPdfData = existingCover;

        // Store in memory cache too
        pdfCache.set(safeTitle, {
          cvPdfData,
          cvOnlyPdfData,
          coverPdfData,
          cvFilename,
          coverFilename
        });
      } else {
        try {
          addLog('info', `Generating tailored CV for: ${jobInfo.title}`);
          const tailored = await generateTailoredContent(
            jobInfo,
            settings.personalization.baseCv,
            settings.personalization.baseCoverLetter,
            settings.backendUrl
          );

          const cvOnlyHtml = fillCvTemplate(tailored, settings.profile);
          cvOnlyPdfData = await generatePdfFromHtml(cvOnlyHtml, settings.backendUrl, cvFilename);

          const cvWithCoverHtml = fillCvWithCoverTemplate(tailored, settings.profile);
          cvPdfData = await generatePdfFromHtml(
            cvWithCoverHtml,
            settings.backendUrl,
            `CV_Cover_${safeTitle}.pdf`
          );

          const coverHtml = fillCoverTemplate(tailored, settings.profile);
          coverPdfData = await generatePdfFromHtml(coverHtml, settings.backendUrl, coverFilename);

          addLog('info', `CVs generated for: ${jobInfo.title}`);

          // Store in cache for reuse
          pdfCache.set(safeTitle, {
            cvPdfData,
            cvOnlyPdfData,
            coverPdfData,
            cvFilename,
            coverFilename
          });
        } catch (err) {
          addLog('error', `CV generation failed: ${err}`);
        }
      }
    }
  }

  const cvRequired = settings.personalization.enabled;
  if (cvRequired && !cvPdfData) {
    addLog('error', 'Dynamic CV required but generation failed. Skipping job.');
    job.status = 'skipped';
    job.skipReason = 'cv_generation_failed';
    skippedCount++;
    worker.state = 'done';
    await closeTab(tabId);
    broadcastStatus();
    return;
  }

  // Click Apply button
  const applyResponse = await sendToTab(tabId, { type: 'CLICK_APPLY' });
  const applyResult = applyResponse?.payload;

  if (applyResult === 'external') {
    job.status = 'skipped';
    job.skipReason = 'external_apply';
    skippedCount++;
    worker.state = 'done';
    await closeTab(tabId);
    await registry.markSkipped(job.jobKey, 'external_apply');
    broadcastStatus();
    return;
  }

  if (applyResult === 'not_found') {
    job.status = 'skipped';
    job.skipReason = 'no_apply_button';
    skippedCount++;
    worker.state = 'done';
    await closeTab(tabId);
    await registry.markSkipped(job.jobKey, 'no_apply_button');
    broadcastStatus();
    return;
  }

  // Wait for wizard to load
  addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] Waiting for wizard...`);
  let wizardReady = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    await delay(2000);
    try {
      const readyResp = await sendToTab(tabId, { type: 'WIZARD_READY' });
      if (readyResp?.payload?.ready) {
        wizardReady = true;
        break;
      }
    } catch {
      /* not injected yet */
    }
  }

  if (!wizardReady) {
    addLog('warning', 'Wizard did not load');
    job.status = 'failed';
    failedCount++;
    worker.state = 'done';
    await closeTab(tabId);
    broadcastStatus();
    return;
  }

  // Cache CV payload for re-sending on step advances
  worker.cvPayload = {
    cvData: cvPdfData ? Array.from(new Uint8Array(cvPdfData)) : undefined,
    cvOnlyData: cvOnlyPdfData ? Array.from(new Uint8Array(cvOnlyPdfData)) : undefined,
    cvFilename,
    coverData: coverPdfData ? Array.from(new Uint8Array(coverPdfData)) : undefined,
    coverFilename,
    jobTitle: job.title || '',
    baseProfile: settings?.personalization?.baseProfile || ''
  };

  // Send first fill command
  worker.state = 'filling';
  await sendFillCommand(worker);
}

async function sendFillCommand(worker: TabWorker): Promise<void> {
  const stepResponse = await sendToTab(worker.tabId, {
    type: 'FILL_AND_ADVANCE',
    payload: worker.cvPayload
  });

  const action = stepResponse?.payload?.action;
  addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] Fill result: ${action || 'no response'}`);

  if (action === 'filled') {
    worker.state = 'waiting_review';
    addLog(
      'info',
      `[Tab ${tabWorkers.indexOf(worker) + 1}] Waiting for user review — ${worker.job.title}`
    );
  } else if (action === 'needs_input') {
    worker.state = 'waiting_review';
    addLog(
      'warning',
      `[Tab ${tabWorkers.indexOf(worker) + 1}] Needs user input: ${stepResponse?.payload?.fieldLabel}`
    );
  } else if (action === 'continued') {
    // Special pages auto-handled (privacy/consent) — fill next step
    await delay(1500);
    await sendFillCommand(worker);
  } else {
    // No response or unknown — wait and retry once
    await delay(3000);
    const retry = await sendToTab(worker.tabId, {
      type: 'FILL_AND_ADVANCE',
      payload: worker.cvPayload
    });
    if (retry?.payload?.action === 'filled' || retry?.payload?.action === 'needs_input') {
      worker.state = 'waiting_review';
    } else {
      addLog(
        'warning',
        `[Tab ${tabWorkers.indexOf(worker) + 1}] Could not fill page, waiting for user`
      );
      worker.state = 'waiting_review';
    }
  }

  broadcastStatus();
}

// ── Event Handlers (called from background/index.ts) ──

export async function onStepAdvanced(senderTabId: number): Promise<void> {
  const worker = tabWorkers.find((w) => w.tabId === senderTabId);
  if (!worker || worker.state === 'done') return;

  addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] User advanced — filling next step`);
  worker.state = 'filling';
  broadcastStatus();

  await delay(1500); // Wait for new step DOM to settle
  await sendFillCommand(worker);
}

export async function onTabSubmitted(senderTabId: number): Promise<void> {
  const worker = tabWorkers.find((w) => w.tabId === senderTabId);
  if (!worker || worker.state === 'done') return;

  const job = worker.job;
  job.status = 'applied';
  appliedCount++;
  await registry.markApplied(job.jobKey);
  addLog('info', `Applied successfully: ${job.title || job.url}`);

  worker.state = 'done';
  await closeTab(senderTabId);
  broadcastStatus();

  // Launch next worker if there are pending jobs
  if (!stopRequested && jobs.some((j) => j.status === 'pending')) {
    await delay(1000);
    await launchNextWorker();
  }
}
