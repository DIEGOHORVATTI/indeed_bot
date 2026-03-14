import { BotStatus } from '../types';

const $ = (id: string) => document.getElementById(id)!;

const btnPause = $('btn-pause') as HTMLButtonElement;
const btnResume = $('btn-resume') as HTMLButtonElement;
const btnStop = $('btn-stop') as HTMLButtonElement;
const statusBadge = $('status-badge');
const appliedCount = $('applied-count');
const pendingCountEl = $('pending-count');
const totalCount = $('total-count');
const progressSection = $('progress-section');
const linkInfo = $('link-info');
const progressFill = $('progress-fill');
const currentJob = $('current-job');
const currentJobText = $('current-job-text');
const logContainer = $('log');

btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'PAUSE_BOT' });
});

btnResume.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESUME_BOT' });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_BOT' });
});

const STATE_LABELS: Record<string, string> = {
  idle: 'Aguardando',
  applying: 'Aplicando',
  paused: 'Pausado',
  waiting_user: 'Aguardando revisao',
};

function updateUI(status: BotStatus): void {
  statusBadge.textContent = STATE_LABELS[status.state] || status.state;
  statusBadge.className = `badge ${status.state}`;

  appliedCount.textContent = String(status.appliedCount);
  pendingCountEl.textContent = String(status.pendingJobs);
  totalCount.textContent = String(status.totalJobs);

  const isActive = status.state !== 'idle';
  if (isActive && status.totalJobs > 0) {
    progressSection.style.display = 'block';
    const processed = status.appliedCount + status.skippedCount + status.failedCount;
    const pct = status.totalJobs > 0 ? Math.round((processed / status.totalJobs) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    linkInfo.textContent = `${processed}/${status.totalJobs} processadas (${pct}%)`;
  } else {
    progressSection.style.display = 'none';
  }

  if (status.currentJob && isActive) {
    currentJob.style.display = 'block';
    currentJobText.textContent = status.currentJob;
  } else {
    currentJob.style.display = 'none';
  }

  const isIdle = status.state === 'idle';
  const isPaused = status.state === 'paused';
  const isRunning = ['applying', 'waiting_user'].includes(status.state);

  btnPause.style.display = isRunning ? 'block' : 'none';
  btnResume.style.display = isPaused ? 'block' : 'none';
  btnStop.style.display = !isIdle ? 'block' : 'none';

  logContainer.innerHTML = '';
  for (const entry of status.log.slice(-30)) {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.level}`;
    const time = new Date(entry.timestamp).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);
    div.appendChild(document.createTextNode(entry.message));
    logContainer.appendChild(div);
  }
  logContainer.scrollTop = logContainer.scrollHeight;
}

chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (response?.payload) {
    updateUI(response.payload);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_UPDATE' && message.payload?.state) {
    updateUI(message.payload);
  }
});
