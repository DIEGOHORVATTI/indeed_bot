/**
 * Content script for smartapply.indeed.com (wizard iframe).
 * Handles: form filling, resume upload, wizard navigation, questionnaire.
 *
 * All form answers are resolved by Claude using the user's baseProfile markdown.
 */

import { Message } from '../types';
import {
  findFirst, findAll, clickFirst, isVisible, isDisabled,
  fillInput, selectOption, setInputFiles, getLabelForInput,
} from '../utils/selectors';
import {
  SUBMIT_SELECTORS, CONTINUE_SELECTORS,
  SUBMIT_KEYWORDS, CONTINUE_KEYWORDS, SKIP_KEYWORDS,
  RESUME_OPTIONS_SELECTORS, UPLOAD_BUTTON_SELECTORS,
  COVER_LETTER_SELECTORS, RESUME_CARD_SELECTORS,
} from '../utils/i18n';

// ── State ──

let currentJobTitle = '';
let currentBaseProfile = '';

// ── Helpers ──

function log(msg: string): void {
  console.log(`[smartapply] ${msg}`);
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Ask Claude (via service worker → backend) ──

async function askClaude(question: string, options?: string[]): Promise<string | null> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        type: 'ASK_CLAUDE',
        payload: { question, options, jobTitle: currentJobTitle, baseProfile: currentBaseProfile },
      },
      (response) => {
        resolve(response?.payload?.answer || null);
      }
    );
  });
}

// ── Resume Upload ──

async function waitForFileInput(timeoutMs = 3000): Promise<HTMLInputElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    for (const fi of inputs) {
      const accept = (fi.getAttribute('accept') || '').toLowerCase();
      if (accept.includes('image')) continue;
      return fi;
    }
    await waitMs(300);
  }
  return null;
}

async function handleResumeStep(pdfData?: ArrayBuffer, pdfFilename?: string): Promise<void> {
  if (!pdfData || !pdfFilename) return;

  const file = new File([pdfData], pdfFilename, { type: 'application/pdf' });

  // Strategy 1: Direct file input already visible
  const existingInput = await waitForFileInput(500);
  if (existingInput) {
    log('Strategy 1: found existing file input');
    setInputFiles(existingInput, file);
    return;
  }

  // Strategy 2: Click "Resume options" → "Upload" → file input
  const optionsBtn = findFirst(RESUME_OPTIONS_SELECTORS);
  if (optionsBtn) {
    log(`Strategy 2: clicking options: "${(optionsBtn as HTMLElement).textContent?.trim()}"`);
    (optionsBtn as HTMLElement).click();
    await waitMs(800);

    const uploadBtn = findFirst(UPLOAD_BUTTON_SELECTORS);
    if (uploadBtn) {
      log(`Strategy 2: clicking upload: "${(uploadBtn as HTMLElement).textContent?.trim()}"`);
      (uploadBtn as HTMLElement).click();
      const fi = await waitForFileInput(3000);
      if (fi) {
        log('Strategy 2: file input found');
        setInputFiles(fi, file);
        return;
      }
    }
  }

  // Strategy 3: Direct upload button
  const directUploadBtn = findFirst(UPLOAD_BUTTON_SELECTORS);
  if (directUploadBtn) {
    log(`Strategy 3: clicking upload: "${(directUploadBtn as HTMLElement).textContent?.trim()}"`);
    (directUploadBtn as HTMLElement).click();
    const fi = await waitForFileInput(3000);
    if (fi) {
      log('Strategy 3: file input found');
      setInputFiles(fi, file);
      return;
    }
  }

  // Strategy 4: Scan ALL clickables for upload-related text
  const allClickables = [...document.querySelectorAll('button, a, [role="button"]')];
  const uploadKeywords = ['upload', 'carregar', 'enviar arquivo', 'escolher arquivo', 'choose file', 'select file', 'alterar currículo', 'change resume'];
  for (const el of allClickables) {
    if (!isVisible(el as Element)) continue;
    const text = (el.textContent || '').toLowerCase().trim();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (uploadKeywords.some(kw => text.includes(kw) || ariaLabel.includes(kw))) {
      log(`Strategy 4: clicking: "${text || ariaLabel}"`);
      (el as HTMLElement).click();
      const fi = await waitForFileInput(3000);
      if (fi) {
        log('Strategy 4: file input found');
        setInputFiles(fi, file);
        return;
      }
    }
  }

  // Strategy 5: API-based upload
  log('Strategy 5: trying API upload');
  const apiResult = await uploadResumeViaApi(file);
  if (apiResult) {
    log('Strategy 5: API upload succeeded');
    return;
  }

  // Strategy 6: Select existing resume card
  const card = findFirst(RESUME_CARD_SELECTORS);
  if (card) {
    log(`Strategy 6: clicking existing card`);
    (card as HTMLElement).click();
    return;
  }

  log('WARNING: No resume upload strategy worked');
}

async function uploadResumeViaApi(file: File): Promise<boolean> {
  const cookies = document.cookie.split(';').map(c => c.trim());
  let csrfToken = '';
  for (const c of cookies) {
    if (c.startsWith('XSRF-TOKEN=') || c.startsWith('INDEED_CSRF_TOKEN=')) {
      csrfToken = c.split('=')[1] || '';
    }
  }
  if (!csrfToken) return false;

  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const resp = await fetch('/api/v1/files', {
      method: 'POST',
      headers: { 'ia-upload-category': 'resume', 'x-xsrf-token': csrfToken },
      body: fd,
      credentials: 'include',
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function handleCoverLetter(pdfData?: ArrayBuffer, pdfFilename?: string): void {
  if (!pdfData || !pdfFilename) return;

  const file = new File([pdfData], pdfFilename, { type: 'application/pdf' });

  let coverInput = document.querySelector<HTMLInputElement>(
    '[data-testid="CoverLetterInput"] input[type="file"], input[accept*="pdf"][name*="cover"]'
  );

  if (!coverInput) {
    const coverBtn = findFirst(COVER_LETTER_SELECTORS);
    if (coverBtn) {
      (coverBtn as HTMLElement).click();
      setTimeout(() => {
        coverInput = document.querySelector<HTMLInputElement>('input[type="file"]');
        if (coverInput) setInputFiles(coverInput, file);
      }, 500);
      return;
    }
  }

  if (coverInput) setInputFiles(coverInput, file);
}

// ── Questionnaire Handling (all via Claude) ──

async function handleQuestionnaire(): Promise<{ needsUserInput: boolean; fieldLabel?: string }> {
  // Text inputs
  const textInputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"]'
  );

  for (const inp of textInputs) {
    if (!isVisible(inp)) continue;
    if (inp.value.trim()) continue;

    const label = getLabelForInput(inp);
    if (!label) continue;

    const answer = await askClaude(label);
    if (answer) {
      fillInput(inp, answer);
    } else {
      const isRequired = inp.required || inp.getAttribute('aria-required') === 'true' || label.includes('*');
      if (isRequired) return { needsUserInput: true, fieldLabel: label };
    }
  }

  // Textareas
  const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
  for (const ta of textareas) {
    if (!isVisible(ta)) continue;
    if (ta.value.trim()) continue;

    const label = getLabelForInput(ta);
    if (!label) continue;

    const answer = await askClaude(label);
    if (answer) {
      fillInput(ta, answer);
    } else {
      const isRequired = ta.required || ta.getAttribute('aria-required') === 'true' || label.includes('*');
      if (isRequired) return { needsUserInput: true, fieldLabel: label };
    }
  }

  // Selects
  const selects = document.querySelectorAll<HTMLSelectElement>('select');
  for (const sel of selects) {
    if (!isVisible(sel)) continue;
    if (sel.value) continue;

    const label = getLabelForInput(sel);
    if (!label) continue;

    const opts = Array.from(sel.querySelectorAll('option'));
    const optionTexts: string[] = [];
    const optionValues: string[] = [];

    for (const opt of opts) {
      const val = opt.value;
      const text = opt.textContent?.trim() || '';
      if (val) {
        optionTexts.push(text);
        optionValues.push(val);
      }
    }

    if (optionTexts.length > 0) {
      const answer = await askClaude(label, optionTexts);
      if (answer) {
        const idx = optionTexts.indexOf(answer);
        if (idx >= 0) selectOption(sel, optionValues[idx]);
      } else {
        return { needsUserInput: true, fieldLabel: label };
      }
    } else if (optionValues.length > 0) {
      selectOption(sel, optionValues[0]);
    }
  }

  // Radio buttons
  const radioGroups = new Map<string, HTMLInputElement[]>();
  const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  for (const radio of radios) {
    if (!isVisible(radio)) continue;
    const name = radio.name;
    if (!name) continue;
    if (!radioGroups.has(name)) radioGroups.set(name, []);
    radioGroups.get(name)!.push(radio);
  }

  for (const [name, groupRadios] of radioGroups) {
    const checked = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
    if (checked) continue;

    const optionLabels = groupRadios.map(r => getLabelForInput(r));

    let groupLabel = '';
    try {
      const parent = groupRadios[0].closest('fieldset, div');
      const legendOrLabel = parent?.querySelector('legend, label, span');
      groupLabel = legendOrLabel?.textContent?.trim() || name;
    } catch {
      groupLabel = name;
    }

    if (optionLabels.length > 0) {
      const answer = await askClaude(groupLabel, optionLabels);
      if (answer) {
        const idx = optionLabels.indexOf(answer);
        if (idx >= 0) groupRadios[idx].click();
      } else {
        return { needsUserInput: true, fieldLabel: groupLabel };
      }
    } else {
      groupRadios[0].click();
    }
  }

  return { needsUserInput: false };
}

// ── Wizard Navigation ──

function clickContinueOrSubmit(): 'submitted' | 'continued' | 'none' {
  if (clickFirst(SUBMIT_SELECTORS)) return 'submitted';
  if (clickFirst(CONTINUE_SELECTORS)) return 'continued';

  const btns = findAll('button', document).filter(isVisible);

  for (const btn of btns) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (SKIP_KEYWORDS.some(kw => text.includes(kw))) continue;
    if (SUBMIT_KEYWORDS.some(kw => text.includes(kw))) {
      (btn as HTMLElement).click();
      return 'submitted';
    }
  }

  for (const btn of btns) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (SKIP_KEYWORDS.some(kw => text.includes(kw))) continue;
    if (CONTINUE_KEYWORDS.some(kw => text.includes(kw))) {
      (btn as HTMLElement).click();
      return 'continued';
    }
  }

  for (const btn of btns) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (SKIP_KEYWORDS.some(kw => text.includes(kw))) continue;
    if (!text || text.length > 50) continue;
    if (isDisabled(btn)) continue;
    (btn as HTMLElement).click();
    return 'continued';
  }

  return 'none';
}

// ── Cover Letter Detection ──

function hasCoverLetterField(): boolean {
  const selectors = [
    '[data-testid="CoverLetterInput"]',
    '[data-testid*="coverLetter" i]',
    '[data-testid*="cover-letter" i]',
    '[class*="CoverLetter"]',
    '[class*="cover-letter"]',
    'input[type="file"][name*="cover" i]',
    'input[type="file"][aria-label*="cover" i]',
    'input[type="file"][aria-label*="carta" i]',
  ];
  for (const sel of selectors) {
    if (document.querySelector(sel)) return true;
  }
  const keywords = ['cover letter', 'carta de apresentação', 'carta de apresentacao'];
  const textEls = document.querySelectorAll('label, span, h3, button, a');
  for (const el of textEls) {
    const text = (el.textContent || '').toLowerCase();
    if (keywords.some(kw => text.includes(kw))) return true;
  }
  return false;
}

// ── Message Listener ──

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'FILL_AND_ADVANCE': {
      const { cvData, cvFilename, coverData, coverFilename, jobTitle, baseProfile } = message.payload || {};
      currentJobTitle = jobTitle || '';
      currentBaseProfile = baseProfile || '';

      (async () => {
        await handleResumeStep(cvData, cvFilename);

        if (hasCoverLetterField()) {
          handleCoverLetter(coverData, coverFilename);
          await waitMs(500);
        }

        const result = await handleQuestionnaire();
        if (result.needsUserInput) {
          sendResponse({
            type: 'STEP_RESULT',
            payload: { action: 'needs_input', fieldLabel: result.fieldLabel },
          });
          return;
        }

        await waitMs(500);
        const navResult = clickContinueOrSubmit();
        sendResponse({ type: 'STEP_RESULT', payload: { action: navResult } });
      })();

      return true;
    }

    case 'WIZARD_READY': {
      const buttons = document.querySelectorAll('button');
      const inputs = document.querySelectorAll('input');
      sendResponse({
        type: 'STATUS_UPDATE',
        payload: {
          ready: buttons.length > 0 || inputs.length > 0,
          buttons: buttons.length,
          inputs: inputs.length,
          url: window.location.href,
        },
      });
      break;
    }
  }
  return true;
});

// Announce to service worker
chrome.runtime.sendMessage({
  type: 'STATUS_UPDATE',
  payload: { contentScript: 'smartapply', url: window.location.href },
});
