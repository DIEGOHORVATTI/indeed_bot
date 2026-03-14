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
import {
  createTab,
  closeTab,
  navigateTab,
  waitForTabLoad,
  getActiveTabId
} from './tab-group';
import { TIMING, LIMITS, URL_PATTERNS } from '../utils/constants';
import {
  sendStatus,
  sendScreenshot,
  sendJobApplied,
  sendJobFailed,
  sendLog as bridgeLog,
  isConnected
} from './ws-bridge';

const registry = new JobRegistry();
const cache = new AnswerCache();

export function getCache(): AnswerCache {
  return cache;
}

interface CvPayload {
  cvData?: number[];
  cvOnlyData?: number[];
  cvFilename?: string;
  coverData?: number[];
  coverFilename?: string;
  jobTitle: string;
  baseProfile: string;
}

interface TabWorker {
  tabId: number;
  job: JobEntry;
  state: 'navigating' | 'filling' | 'waiting_review' | 'done';
  cvPayload?: CvPayload;
}

let state: BotState = 'idle';
let applyMode: 'semi-auto' | 'full-auto' = 'semi-auto';
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

let tabWorkers: TabWorker[] = [];

let tabUrlListener: ((tabId: number, info: chrome.tabs.TabChangeInfo) => void) | null = null;

function startTabUrlMonitor(): void {
  stopTabUrlMonitor();
  tabUrlListener = (tabId, info) => {
    if (!info.url) return;
    const worker = tabWorkers.find((w) => w.tabId === tabId && w.state === 'waiting_review');
    if (!worker) return;

    const url = info.url;
    const isSubmission = URL_PATTERNS.submission.some((kw) => url.includes(kw));
    const leftSmartApply = !url.includes('smartapply.indeed.com');

    if (isSubmission || leftSmartApply) {
      addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] Submission detected via URL monitor: ${url}`);
      onTabSubmitted(tabId);
    }
  };
  chrome.tabs.onUpdated.addListener(tabUrlListener);
}

function stopTabUrlMonitor(): void {
  if (tabUrlListener) {
    chrome.tabs.onUpdated.removeListener(tabUrlListener);
    tabUrlListener = null;
  }
}

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

export function addLog(level: LogEntry['level'], message: string): void {
  const prefix = `[bot:${state}]`;
  console.log(`${prefix} [${level}] ${message}`);
  log.push({ timestamp: Date.now(), level, message });
  if (log.length > 200) log = log.slice(-100);
  broadcastStatus();
  if (isConnected()) {
    bridgeLog(level, message);
  }
}

function broadcastStatus(): void {
  const status = getStatus();
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: status }).catch(() => {});
  if (isConnected()) {
    sendStatus(status);
  }
}

async function reportScreenshot(tabId: number): Promise<void> {
  if (!isConnected()) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const pageContextResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title || '';
        const heading = document.querySelector('h1')?.textContent?.trim() || '';
        const metaDescription = (
          document.querySelector('meta[name="description"]') as HTMLMetaElement | null
        )?.content;
        return [title, heading, metaDescription || ''].filter(Boolean).join(' | ');
      }
    });
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 60
    });
    sendScreenshot({
      screenshot,
      url: tab.url || '',
      pageContext: String(pageContextResult?.[0]?.result || '')
    });
  } catch {}
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
    activeWorkers,
    scrapingTabs: 1,
    collectionStats: {
      externalApply: 0,
      duplicates: 0,
      alreadyKnown: 0
    },
    log: log.slice(-50)
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

export async function startBot(userSettings: Settings): Promise<void> {
  const selectedJobs = (userSettings.searchUrls || []).map((url, idx) => ({
    id: idx + 1,
    url,
    title: '',
    company: ''
  }));
  await applySelectedJobs(userSettings, selectedJobs, 'semi-auto');
}

let generateCvForBatch = true;

export async function applySelectedJobs(
  userSettings: Settings,
  selectedJobs: Array<{ id: number; url: string; title: string; company: string }>,
  mode: 'semi-auto' | 'full-auto',
  generateCv = true
): Promise<void> {
  if (state !== 'idle') return;

  settings = userSettings;
  state = 'applying';
  appliedCount = 0;
  skippedCount = 0;
  failedCount = 0;
  jobs = selectedJobs.map((j) => {
    let jobKey = '';
    try {
      const params = new URL(j.url).searchParams;
      jobKey = params.get('jk') || params.get('vjk') || '';
    } catch {}
    return {
      url: j.url,
      jobKey,
      title: j.title,
      company: j.company,
      status: 'pending' as const
    };
  });
  currentJobIndex = 0;
  log = [];
  stopRequested = false;
  tabWorkers = [];
  currentSearchUrl = '';
  currentSearchIndex = 0;
  totalSearchUrls = 0;
  generateCvForBatch = generateCv;
  applyMode = mode;

  await registry.load();
  await cache.load();
  if (generateCvForBatch) await loadTemplates();
  startTabUrlMonitor();

  addLog('info', `Aplicando em ${jobs.length} vaga(s) — modo: ${mode}`);
  broadcastStatus();

  try {
    await launchNextWorker(null);

    while (!stopRequested) {
      const activeWorkers = tabWorkers.filter((w) => w.state !== 'done').length;
      const hasPending = jobs.some((j) => j.status === 'pending');

      if (activeWorkers === 0 && !hasPending) break;
      if (activeWorkers === 0 && hasPending) {
        await launchNextWorker();
      }

      await delay(1000);
    }
  } catch (err) {
    addLog('error', `Erro na aplicacao: ${err}`);
  } finally {
    state = 'idle';
    stopTabUrlMonitor();
    addLog('info', `Aplicacao finalizada. Applied: ${appliedCount}, Skipped: ${skippedCount}`);
    broadcastStatus();
  }
}

export function stopBot(): void {
  stopRequested = true;
  state = 'idle';
  stopTabUrlMonitor();
  for (const job of jobs) {
    if (job.status === 'in_progress') job.status = 'pending';
  }
  for (const worker of tabWorkers) {
    closeTab(worker.tabId).catch(() => {});
  }
  tabWorkers = [];
  addLog('info', 'Bot stopped by user');
  broadcastStatus();
}

export function pauseBot(): void {
  if (state === 'applying') {
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

function getNextPendingJob(): JobEntry | null {
  return jobs.find((j) => j.status === 'pending') || null;
}

async function launchNextWorker(reuseTabId: number | null = null): Promise<void> {
  if (stopRequested || !settings || state === 'paused') return;

  if (settings.maxApplies > 0 && appliedCount >= settings.maxApplies) {
    addLog('info', `Reached max applies limit (${settings.maxApplies})`);
    return;
  }

  const job = getNextPendingJob();
  if (!job) return;

  job.status = 'in_progress';

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
    if (isConnected()) {
      sendJobFailed(job.jobKey, String(err));
    }
    await finishWorkerAndReuseTab(worker);
  }
}

async function finishWorkerAndReuseTab(worker: TabWorker): Promise<void> {
  worker.state = 'done';
  broadcastStatus();
  if (!stopRequested && state !== 'paused' && jobs.some((j) => j.status === 'pending')) {
    await delay(1000);
    await launchNextWorker(worker.tabId);
  }
}

async function prepareAndFillJob(worker: TabWorker): Promise<void> {
  if (!settings) return;
  const job = worker.job;

  let tabId = worker.tabId;
  if (tabId > 0) {
    await navigateTab(tabId, job.url);
    addLog('info', `Reutilizando aba ${tabId}`);
  } else {
    const result = await createTab(job.url);
    tabId = result.tabId;
    worker.tabId = tabId;
  }

  await waitForTabLoad(tabId, TIMING.tabLoadTimeout);
  await delay(TIMING.pageLoadDelay);

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.includes(URL_PATTERNS.indeedDomain)) {
    job.status = 'skipped';
    job.skipReason = 'redirected_external';
    skippedCount++;
    await finishWorkerAndReuseTab(worker);
    return;
  }

  const scrapeResponse = await sendToTab(tabId, { type: 'SCRAPE_JOB' });
  const jobInfo = scrapeResponse?.payload || {};
  job.title = jobInfo.title;
  job.company = jobInfo.company;

  addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] ${job.title} at ${job.company}`);
  broadcastStatus();

  let cvPdfData: ArrayBuffer | undefined;
  let cvOnlyPdfData: ArrayBuffer | undefined;
  let cvFilename: string | undefined;
  let coverPdfData: ArrayBuffer | undefined;
  let coverFilename: string | undefined;

  if (generateCvForBatch && settings.personalization.enabled && settings.backendUrl && jobInfo.description) {
    const safeTitle = (jobInfo.title || 'job')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .substring(0, 60);

    const cached = pdfCache.get(safeTitle);
    if (cached) {
      addLog('info', `Reusing cached CVs for: ${jobInfo.title}`);
      cvPdfData = cached.cvPdfData;
      cvOnlyPdfData = cached.cvOnlyPdfData;
      coverPdfData = cached.coverPdfData;
      cvFilename = cached.cvFilename;
      coverFilename = cached.coverFilename;
    } else {
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

  const cvRequired = generateCvForBatch && settings.personalization.enabled;
  if (cvRequired && !cvPdfData) {
    addLog('error', 'Dynamic CV required but generation failed. Skipping job.');
    job.status = 'skipped';
    job.skipReason = 'cv_generation_failed';
    skippedCount++;
    await finishWorkerAndReuseTab(worker);
    return;
  }

  const applyResponse = await sendToTab(tabId, { type: 'CLICK_APPLY' });
  const applyResult = applyResponse?.payload;

  if (applyResult === 'already_applied') {
    job.status = 'skipped';
    job.skipReason = 'already_applied';
    skippedCount++;
    addLog('info', `Vaga ja aplicada, pulando: ${job.title}`);
    sendJobFailed(job.jobKey, 'already_applied');
    await finishWorkerAndReuseTab(worker);
    return;
  }

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
    } catch {}
  }

  if (!wizardReady) {
    addLog('warning', 'Wizard did not load');
    job.status = 'failed';
    failedCount++;
    await finishWorkerAndReuseTab(worker);
    return;
  }

  let baseProfile = settings?.personalization?.baseProfile || '';
  try {
    const res = await fetch(`${settings.backendUrl}/api/settings/profile`);
    if (res.ok) {
      const data = await res.json();
      if (data.value) baseProfile = data.value;
    }
  } catch {}

  worker.cvPayload = {
    cvData: cvPdfData ? Array.from(new Uint8Array(cvPdfData)) : undefined,
    cvOnlyData: cvOnlyPdfData ? Array.from(new Uint8Array(cvOnlyPdfData)) : undefined,
    cvFilename,
    coverData: coverPdfData ? Array.from(new Uint8Array(coverPdfData)) : undefined,
    coverFilename,
    jobTitle: job.title || '',
    baseProfile,
  };

  worker.state = 'filling';
  await sendFillCommand(worker);
}

const MAX_FILL_DEPTH = LIMITS.maxFillDepth;

async function sendFillCommand(worker: TabWorker, depth = 0): Promise<void> {
  if (depth >= MAX_FILL_DEPTH) {
    addLog(
      'warning',
      `[Tab ${tabWorkers.indexOf(worker) + 1}] Max fill depth reached (${MAX_FILL_DEPTH}), waiting for user`
    );
    worker.state = 'waiting_review';
    return;
  }
  const stepResponse = await sendToTab(worker.tabId, {
    type: 'FILL_AND_ADVANCE',
    payload: worker.cvPayload
  });

  const action = stepResponse?.payload?.action;
  addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] Fill result: ${action || 'no response'}`);

  if (action === 'filled') {
    if (applyMode === 'full-auto') {
      addLog('info', `Auto-submit: ${worker.job.title}`);
      const submitResp = await sendToTab(worker.tabId, { type: 'FILL_AND_ADVANCE', payload: worker.cvPayload });
      if (submitResp?.payload?.action === 'submitted') {
        worker.job.status = 'applied';
        appliedCount++;
        sendJobApplied(worker.job.jobKey, worker.job.title || '', worker.job.company || '');
        addLog('info', `Aplicado automaticamente: ${worker.job.title}`);
        worker.state = 'done';
        await finishWorkerAndReuseTab(worker);
      } else {
        worker.state = 'waiting_review';
        addLog('info', `Auto-submit inconclusivo, aguardando revisao: ${worker.job.title}`);
      }
    } else {
      worker.state = 'waiting_review';
      addLog('info', `Aguardando revisao: ${worker.job.title}`);
    }
  } else if (action === 'needs_input') {
    worker.state = 'waiting_review';
    addLog(
      'warning',
      `[Tab ${tabWorkers.indexOf(worker) + 1}] Needs user input: ${stepResponse?.payload?.fieldLabel}`
    );
  } else if (action === 'continued') {
    await delay(1500);
    await sendFillCommand(worker, depth + 1);
  } else {
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

export async function onStepAdvanced(senderTabId: number): Promise<void> {
  const worker = tabWorkers.find((w) => w.tabId === senderTabId);
  if (!worker || worker.state === 'done') return;

  addLog('info', `[Tab ${tabWorkers.indexOf(worker) + 1}] User advanced — filling next step`);
  reportScreenshot(senderTabId).catch(() => {});
  worker.state = 'filling';
  broadcastStatus();

  await delay(1500);
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
  if (isConnected()) {
    sendJobApplied(job.jobKey, job.title || '', job.company || '');
  }
  reportScreenshot(senderTabId).catch(() => {});

  await finishWorkerAndReuseTab(worker);
}

export async function onTabSkipped(senderTabId: number): Promise<void> {
  const worker = tabWorkers.find((w) => w.tabId === senderTabId);
  if (!worker || worker.state === 'done') return;

  const job = worker.job;
  job.status = 'skipped';
  job.skipReason = 'user_skipped';
  skippedCount++;
  await registry.markSkipped(job.jobKey, 'user_skipped');
  addLog('info', `Skipped by user: ${job.title || job.url}`);

  await finishWorkerAndReuseTab(worker);
}
