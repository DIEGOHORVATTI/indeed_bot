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
import { createTabGroup, closeTab, navigateTab, waitForTabLoad } from './tab-group';

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

// Collection stats
let collectionExternalApply = 0;
let collectionDuplicates = 0;
let collectionAlreadyKnown = 0;

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
    collectionStats: {
      externalApply: collectionExternalApply,
      duplicates: collectionDuplicates,
      alreadyKnown: collectionAlreadyKnown
    },
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
  collectionExternalApply = 0;
  collectionDuplicates = 0;
  collectionAlreadyKnown = 0;

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

/** Collect links from a single page using a specific tab */
async function collectSinglePage(
  tabId: number,
  pageUrl: string,
  pageNum: number
): Promise<{
  links: { url: string; jobKey: string }[];
  stats?: { totalCards: number; externalApply: number };
  jobCount?: number;
  error?: string;
}> {
  try {
    await navigateTab(tabId, pageUrl);
    await waitForTabLoad(tabId, 15000);
    await delay(2000);
  } catch (err) {
    return { links: [], error: `navigation_failed: ${err}` };
  }

  // Verify tab is still on Indeed
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.url.includes('indeed.com')) {
      return { links: [], error: `redirected: ${tab.url}` };
    }
  } catch {
    return { links: [], error: 'tab_closed' };
  }

  // Get total count if available
  let jobCount: number | undefined;
  const countResp = await sendToTab(tabId, { type: 'GET_TOTAL_COUNT' });
  if (countResp?.payload?.totalJobs > 0) {
    jobCount = countResp.payload.totalJobs;
  }

  // Collect links
  const response = await sendToTab(tabId, { type: 'COLLECT_LINKS' });
  const links: { url: string; jobKey: string }[] = response?.payload || [];
  const stats = response?.stats;

  console.log(`[collect] Tab ${tabId} page ${pageNum}: got ${links.length} links`);
  return { links, stats, jobCount };
}

async function collectAllJobs(): Promise<void> {
  if (!settings) return;

  totalSearchUrls = settings.searchUrls.length;
  const scrapingTabs = settings.concurrentTabs || 1;

  for (let searchIdx = 0; searchIdx < settings.searchUrls.length; searchIdx++) {
    if (stopRequested) break;

    const searchUrl = settings.searchUrls[searchIdx];
    currentSearchUrl = searchUrl;
    currentSearchIndex = searchIdx;

    addLog(
      'info',
      `[Link ${searchIdx + 1}/${totalSearchUrls}] Collecting from: ${searchUrl} (${scrapingTabs} tab(s))`
    );

    currentPage = 0;
    totalPages = 0;
    estimatedTotalJobs = 0;
    const batchStartIndex = jobs.length;
    const JOBS_PER_PAGE = 10;
    const seenJobKeys = new Set<string>();

    // Create scraping tabs
    const scrapingTabIds: number[] = [];
    for (let i = 0; i < scrapingTabs; i++) {
      if (i === 0 && collectionTabId) {
        scrapingTabIds.push(collectionTabId);
      } else {
        const { tabId } = await createTabGroup(searchUrl);
        scrapingTabIds.push(tabId);
      }
    }

    // Phase 1: Scrape first page to get total count
    const firstPageUrl = buildPageUrl(searchUrl, 0);
    const firstResult = await collectSinglePage(scrapingTabIds[0], firstPageUrl, 1);

    if (firstResult.error) {
      addLog('warning', `Page 1 failed: ${firstResult.error}`);
    }

    if (firstResult.jobCount) {
      estimatedTotalJobs = firstResult.jobCount;
      totalPages = Math.ceil(estimatedTotalJobs / JOBS_PER_PAGE);
      addLog('info', `Found ~${estimatedTotalJobs} jobs across ~${totalPages} page(s)`);
    }

    // Process first page results
    let consecutiveEmptyPages = 0;
    if (firstResult.links.length > 0 || (firstResult.stats && firstResult.stats.totalCards > 0)) {
      // Track external apply from stats
      if (firstResult.stats) {
        collectionExternalApply += firstResult.stats.externalApply;
      }
      let pageNew = 0;
      let pageDupes = 0;
      let pageKnown = 0;
      for (const link of firstResult.links) {
        if (seenJobKeys.has(link.jobKey)) {
          pageDupes++;
          collectionDuplicates++;
          continue;
        }
        seenJobKeys.add(link.jobKey);
        if (await registry.isKnown(link.jobKey)) {
          pageKnown++;
          collectionAlreadyKnown++;
          continue;
        }
        jobs.push({ url: link.url, jobKey: link.jobKey, status: 'pending' });
        pageNew++;
      }
      const parts = [`+${pageNew} new`];
      if (pageDupes > 0) parts.push(`${pageDupes} dupes`);
      if (pageKnown > 0) parts.push(`${pageKnown} known`);
      if (firstResult.stats?.externalApply) {
        parts.push(`${firstResult.stats.externalApply} external`);
      }
      addLog('info', `Page 1: ${parts.join(', ')}`);
    } else {
      consecutiveEmptyPages++;
      const statsInfo = firstResult.stats
        ? ` (${firstResult.stats.totalCards} cards, ${firstResult.stats.externalApply} external)`
        : '';
      if (firstResult.stats) collectionExternalApply += firstResult.stats.externalApply;
      addLog('info', `Page 1 empty${statsInfo}`);
    }

    currentPage = 1;
    broadcastStatus();

    // Early exit: if maxApplies is set and we already have enough pending jobs, skip remaining pages
    const pendingCount = jobs.filter((j) => j.status === 'pending').length;
    if (settings.maxApplies > 0 && pendingCount >= settings.maxApplies) {
      addLog(
        'info',
        `Already have ${pendingCount} pending job(s) (maxApplies=${settings.maxApplies}) — skipping remaining pages`
      );
      collectionTabId = scrapingTabIds[0];
      for (let i = 1; i < scrapingTabIds.length; i++) {
        closeTab(scrapingTabIds[i]).catch(() => {});
      }
      continue; // next search URL (or end)
    }

    // Phase 2: Parallel scraping of remaining pages
    let nextPage = 2;
    let globalEmptyStreak = consecutiveEmptyPages;

    while (!stopRequested && globalEmptyStreak < 3) {
      // Check if we've reached the last known page
      if (estimatedTotalJobs > 0 && totalPages > 0 && nextPage > totalPages) {
        addLog('info', `Reached last page (${totalPages}) — collection done`);
        break;
      }

      // Assign pages to tabs in parallel
      const pageAssignments: { tabId: number; pageNum: number; pageUrl: string }[] = [];
      for (let i = 0; i < scrapingTabIds.length && globalEmptyStreak < 3; i++) {
        const pn = nextPage + i;
        // Don't exceed known total pages
        if (estimatedTotalJobs > 0 && totalPages > 0 && pn > totalPages) break;
        const startOffset = (pn - 1) * JOBS_PER_PAGE;
        pageAssignments.push({
          tabId: scrapingTabIds[i],
          pageNum: pn,
          pageUrl: buildPageUrl(searchUrl, startOffset)
        });
      }

      if (pageAssignments.length === 0) break;

      // Scrape all assigned pages in parallel
      const results = await Promise.all(
        pageAssignments.map((a) => collectSinglePage(a.tabId, a.pageUrl, a.pageNum))
      );

      // Process results in page order
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const pn = pageAssignments[i].pageNum;
        currentPage = pn;

        // Pick up total count from any page if we don't have it yet
        if (estimatedTotalJobs === 0 && result.jobCount) {
          estimatedTotalJobs = result.jobCount;
          totalPages = Math.ceil(estimatedTotalJobs / JOBS_PER_PAGE);
          addLog('info', `Found ~${estimatedTotalJobs} jobs across ~${totalPages} page(s)`);
        }

        if (result.error) {
          addLog('warning', `Page ${pn} error: ${result.error}`);
          globalEmptyStreak++;
          continue;
        }

        // Track external apply from stats
        if (result.stats) {
          collectionExternalApply += result.stats.externalApply;
        }

        if (result.links.length === 0) {
          globalEmptyStreak++;
          const statsInfo = result.stats
            ? ` (${result.stats.totalCards} cards, ${result.stats.externalApply} external)`
            : '';
          addLog('info', `Page ${pn} empty${statsInfo} (${globalEmptyStreak}/3 consecutive)`);
          continue;
        }

        // Got results — reset empty streak
        globalEmptyStreak = 0;
        let pageNew = 0;
        let pageDupes = 0;
        let pageKnown = 0;
        for (const link of result.links) {
          if (seenJobKeys.has(link.jobKey)) {
            pageDupes++;
            collectionDuplicates++;
            continue;
          }
          seenJobKeys.add(link.jobKey);
          if (await registry.isKnown(link.jobKey)) {
            pageKnown++;
            collectionAlreadyKnown++;
            continue;
          }
          jobs.push({ url: link.url, jobKey: link.jobKey, status: 'pending' });
          pageNew++;
        }
        const totalNew = jobs.length - batchStartIndex;
        const pageInfo = totalPages > 0 ? ` (page ${pn}/${totalPages})` : '';
        const parts = [`+${pageNew} new`];
        if (pageDupes > 0) parts.push(`${pageDupes} dupes`);
        if (pageKnown > 0) parts.push(`${pageKnown} known`);
        if (result.stats?.externalApply) parts.push(`${result.stats.externalApply} external`);
        const totalInfo =
          estimatedTotalJobs > 0 ? ` — ${totalNew}/${estimatedTotalJobs}` : ` — ${totalNew} total`;
        addLog('info', `Page ${pn}${pageInfo}: ${parts.join(', ')}${totalInfo}`);
      }

      broadcastStatus();

      // Early exit: enough pending jobs for maxApplies
      const pendingNow = jobs.filter((j) => j.status === 'pending').length;
      if (settings.maxApplies > 0 && pendingNow >= settings.maxApplies) {
        addLog(
          'info',
          `Have ${pendingNow} pending job(s) (maxApplies=${settings.maxApplies}) — stopping collection early`
        );
        break;
      }

      nextPage += pageAssignments.length;
      await randomDelay(1500, 3000);
    }

    const totalCollected = jobs.length - batchStartIndex;
    const summaryParts = [`${totalCollected} Indeed Apply`];
    if (collectionExternalApply > 0) summaryParts.push(`${collectionExternalApply} external`);
    if (collectionAlreadyKnown > 0) summaryParts.push(`${collectionAlreadyKnown} already known`);
    if (collectionDuplicates > 0) summaryParts.push(`${collectionDuplicates} duplicates`);
    addLog(
      'info',
      `[Link ${searchIdx + 1}/${totalSearchUrls}] Collection complete: ${summaryParts.join(', ')} (${nextPage - 1} pages)`
    );
    console.log(`[collect] Search URL #${searchIdx + 1} finished: ${summaryParts.join(', ')}`);

    // Keep first scraping tab as collectionTabId for reuse as first worker
    collectionTabId = scrapingTabIds[0];
    // Close extra scraping tabs (keep only the first one)
    for (let i = 1; i < scrapingTabIds.length; i++) {
      closeTab(scrapingTabIds[i]).catch(() => {});
    }
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
  const remaining =
    settings?.maxApplies && settings.maxApplies > 0
      ? settings.maxApplies - appliedCount
      : pendingJobs.length;
  const numWorkers = Math.min(maxTabs, pendingJobs.length, remaining);

  addLog('info', `Starting ${numWorkers} concurrent tab(s) for ${pendingJobs.length} jobs`);

  // Reuse collection tab for the first worker
  const reuseTabId = collectionTabId;
  collectionTabId = null;

  for (let i = 0; i < numWorkers; i++) {
    if (stopRequested) break;
    await launchNextWorker(i === 0 ? reuseTabId : null);
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

async function launchNextWorker(reuseTabId: number | null = null): Promise<void> {
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
    tabId: reuseTabId || -1,
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
    await finishWorkerAndReuseTab(worker);
  }
}

/** Mark worker as done and reuse its tab for the next pending job */
async function finishWorkerAndReuseTab(worker: TabWorker): Promise<void> {
  worker.state = 'done';
  broadcastStatus();
  if (!stopRequested && jobs.some((j) => j.status === 'pending')) {
    await delay(1000);
    await launchNextWorker(worker.tabId);
  }
}

async function prepareAndFillJob(worker: TabWorker): Promise<void> {
  if (!settings) return;
  const job = worker.job;

  // Reuse existing tab or create a new one
  let tabId = worker.tabId;
  if (tabId > 0) {
    // Reuse tab — navigate to job page
    await navigateTab(tabId, job.url);
    addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] Reusing tab ${tabId}`);
  } else {
    const result = await createTabGroup(job.url);
    tabId = result.tabId;
    worker.tabId = tabId;
  }

  await waitForTabLoad(tabId, 15000);
  await delay(2000);

  // Check URL is still Indeed
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.includes('indeed.com')) {
    job.status = 'skipped';
    job.skipReason = 'redirected_external';
    skippedCount++;
    await finishWorkerAndReuseTab(worker);
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
    await finishWorkerAndReuseTab(worker);
    return;
  }

  // Click Apply button
  const applyResponse = await sendToTab(tabId, { type: 'CLICK_APPLY' });
  const applyResult = applyResponse?.payload;

  if (applyResult === 'external') {
    job.status = 'skipped';
    job.skipReason = 'external_apply';
    skippedCount++;
    await registry.markSkipped(job.jobKey, 'external_apply');
    await finishWorkerAndReuseTab(worker);
    return;
  }

  if (applyResult === 'not_found') {
    job.status = 'skipped';
    job.skipReason = 'no_apply_button';
    skippedCount++;
    await registry.markSkipped(job.jobKey, 'no_apply_button');
    await finishWorkerAndReuseTab(worker);
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
    await finishWorkerAndReuseTab(worker);
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

  await finishWorkerAndReuseTab(worker);
}
