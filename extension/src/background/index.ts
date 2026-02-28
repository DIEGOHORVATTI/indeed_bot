/**
 * Service worker entry point for Indeed Auto Apply extension.
 * Handles message routing between popup, options, and content scripts.
 */

import { Message, Settings, DEFAULT_SETTINGS } from '../types';
import { startBot, stopBot, pauseBot, resumeBot, getStatus } from './orchestrator';
import { AnswerCache } from '../services/answer-cache';
import { askClaudeForAnswer } from '../services/claude';
import { setupNotificationListeners } from '../utils/notifications';

// Initialize notification listeners (guarded for availability)
setupNotificationListeners();

const cache = new AnswerCache();

// ── Settings Management ──

async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...data.settings };
}

// ── Message Router ──

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // async response
});

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
): Promise<void> {
  switch (message.type) {
    case 'START_BOT': {
      const settings = await getSettings();
      if (!settings.searchUrls.length) {
        sendResponse({ error: 'No search URLs configured. Go to Options to set up.' });
        return;
      }
      startBot(settings);
      sendResponse({ ok: true });
      break;
    }

    case 'STOP_BOT':
      stopBot();
      sendResponse({ ok: true });
      break;

    case 'PAUSE_BOT':
      pauseBot();
      sendResponse({ ok: true });
      break;

    case 'RESUME_BOT':
      resumeBot();
      sendResponse({ ok: true });
      break;

    case 'GET_STATE':
      sendResponse({ type: 'STATUS_UPDATE', payload: getStatus() });
      break;

    case 'ASK_CLAUDE': {
      const { question, options, jobTitle, baseProfile, cacheOnly, storeCache, label, inputType, answer } = message.payload || {};

      // Cache store request
      if (storeCache) {
        await cache.store(label, inputType, answer, options);
        sendResponse({ ok: true });
        return;
      }

      // Cache lookup request
      if (cacheOnly) {
        const cached = await cache.lookup(label, inputType, options);
        sendResponse({ payload: { answer: cached } });
        return;
      }

      // Full lookup: cache first, then Claude
      if (question) {
        // Check cache
        const cached = await cache.lookup(question, 'text', options);
        if (cached) {
          sendResponse({ payload: { answer: cached } });
          return;
        }

        // Ask Claude
        const settings = await getSettings();
        if (!settings.backendUrl) {
          sendResponse({ payload: { answer: null } });
          return;
        }

        const profileContext = baseProfile || settings.personalization?.baseProfile || '';
        const claudeAnswer = await askClaudeForAnswer(
          question, options, jobTitle || '', settings.backendUrl, profileContext
        );

        if (claudeAnswer) {
          await cache.store(question, 'text', claudeAnswer, options);
        }

        sendResponse({ payload: { answer: claudeAnswer } });
      }
      break;
    }

    case 'STATUS_UPDATE':
      // Content script announcing itself — just log it
      break;

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }
}

// ── Keep Alive ──
// MV3 service workers get killed after ~30s of inactivity.
// Use alarms to keep alive during bot operation.
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    const status = getStatus();
    if (status.state === 'idle') {
      chrome.alarms.clear('keepAlive');
    }
  }
});
