/**
 * Options page — backend URL configuration only.
 * All other settings are managed by the Dashboard.
 */

import { DEFAULT_SETTINGS } from '../types';

const backendUrlInput = document.getElementById('backend-url') as HTMLInputElement;
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const savedMsg = document.getElementById('saved-msg')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;

async function loadSettings(): Promise<void> {
  const data = await chrome.storage.local.get('settings');
  const backendUrl = data.settings?.backendUrl || DEFAULT_SETTINGS.backendUrl;
  backendUrlInput.value = backendUrl;
  checkConnection(backendUrl);
}

async function saveSettings(): Promise<void> {
  const existing = await chrome.storage.local.get('settings');
  const prev = existing.settings || {};

  await chrome.storage.local.set({
    settings: {
      ...prev,
      backendUrl: backendUrlInput.value.trim() || DEFAULT_SETTINGS.backendUrl,
    },
  });

  savedMsg.classList.add('show');
  setTimeout(() => savedMsg.classList.remove('show'), 2000);

  checkConnection(backendUrlInput.value.trim());
}

async function checkConnection(url: string): Promise<void> {
  statusDot.className = 'status-dot disconnected';
  statusText.textContent = 'Verificando conexão...';

  try {
    const healthUrl = `${url.replace(/\/$/, '')}/api/health`;
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });

    if (response.ok) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Conectado ao backend';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = `Erro: ${response.status}`;
    }
  } catch {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Backend não encontrado';
  }
}

loadSettings();
btnSave.addEventListener('click', saveSettings);
