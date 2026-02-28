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
const totalCount = $('total-count');
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
  totalCount.textContent = String(status.totalJobs);

  // Current job
  if (status.currentJob && status.state !== 'idle') {
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
    div.innerHTML = `<span class="time">${time}</span>${entry.message}`;
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
