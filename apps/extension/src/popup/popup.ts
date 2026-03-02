/**
 * Popup UI — controls and status display.
 */

import { BotStatus, BotState } from '../types';

const $ = (id: string) => document.getElementById(id)!;

const btnStart = $('btn-start') as HTMLButtonElement;
const btnPause = $('btn-pause') as HTMLButtonElement;
const btnResume = $('btn-resume') as HTMLButtonElement;
const btnStop = $('btn-stop') as HTMLButtonElement;
const btnOptions = $('btn-options') as HTMLAnchorElement;
const statusBadge = $('status-badge');
const appliedCount = $('applied-count');
const skippedCount = $('skipped-count');
const failedCountEl = $('failed-count');
const pendingCountEl = $('pending-count');
const totalCount = $('total-count');
const progressSection = $('progress-section');
const linkInfo = $('link-info');
const progressFill = $('progress-fill');
const currentJob = $('current-job');
const currentJobText = $('current-job-text');
const logContainer = $('log');

// ── Button Handlers ──

btnStart.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_BOT' }, (response) => {
    if (response?.error) {
      alert(response.error);
    }
  });
});

btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'PAUSE_BOT' });
});

btnResume.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESUME_BOT' });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_BOT' });
});

btnOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ── Status Updates ──

function updateUI(status: BotStatus): void {
  // Badge
  statusBadge.textContent = status.state.replace('_', ' ');
  statusBadge.className = `badge ${status.state}`;

  // Stats
  appliedCount.textContent = String(status.appliedCount);
  skippedCount.textContent = String(status.skippedCount);
  failedCountEl.textContent = String(status.failedCount);
  pendingCountEl.textContent = String(status.pendingJobs);
  totalCount.textContent = String(status.totalJobs);

  // Progress bar & link info
  const isActive = status.state !== 'idle';
  if (isActive && (status.totalJobs > 0 || status.state === 'collecting')) {
    progressSection.style.display = 'block';

    if (status.state === 'collecting') {
      // Collection phase: show page progress and jobs found
      const pageInfo = status.totalPages
        ? `Page ${status.currentPage || 1}/${status.totalPages}`
        : `Page ${status.currentPage || 1}`;
      const jobInfo = status.estimatedTotalJobs
        ? `${status.totalJobs}/${status.estimatedTotalJobs} jobs`
        : `${status.totalJobs} jobs`;
      linkInfo.innerHTML = `<strong>Collecting:</strong> ${pageInfo} — ${jobInfo} found`;

      const pct = status.estimatedTotalJobs
        ? Math.round((status.totalJobs / status.estimatedTotalJobs) * 100)
        : 0;
      progressFill.style.width = `${pct}%`;
    } else {
      // Applying phase: show application progress + active workers
      const processed = status.appliedCount + status.skippedCount + status.failedCount;
      const pct = status.totalJobs > 0 ? Math.round((processed / status.totalJobs) * 100) : 0;
      progressFill.style.width = `${pct}%`;

      const workers = status.activeWorkers || 0;
      const maxTabs = status.concurrentTabs || 1;
      const workerInfo = `<strong>Active: ${workers}/${maxTabs} tabs</strong> — ${status.pendingJobs} pending`;
      linkInfo.innerHTML = workerInfo;
    }
  } else {
    progressSection.style.display = 'none';
  }

  // Current job
  if (status.currentJob && isActive) {
    currentJob.style.display = 'block';
    currentJobText.textContent = status.currentJob;
  } else {
    currentJob.style.display = 'none';
  }

  // Buttons
  const isIdle = status.state === 'idle';
  const isPaused = status.state === 'paused';
  const isRunning = ['collecting', 'applying', 'waiting_user'].includes(status.state);

  btnStart.style.display = isIdle ? 'block' : 'none';
  btnPause.style.display = isRunning ? 'block' : 'none';
  btnResume.style.display = isPaused ? 'block' : 'none';
  btnStop.style.display = !isIdle ? 'block' : 'none';

  // Log
  logContainer.innerHTML = '';
  for (const entry of status.log.slice(-30)) {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.level}`;
    const time = new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);
    div.appendChild(document.createTextNode(entry.message));
    logContainer.appendChild(div);
  }
  logContainer.scrollTop = logContainer.scrollHeight;
}

// ── Init ──

// Get current state
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (response?.payload) {
    updateUI(response.payload);
  }
});

// Listen for status updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_UPDATE' && message.payload?.state) {
    updateUI(message.payload);
  }
});
