/**
 * Content script for smartapply.indeed.com (wizard iframe).
 * Handles: form filling, resume upload, wizard navigation, questionnaire.
 *
 * All form answers are resolved by Claude using the user's baseProfile markdown.
 */

import { Message } from '../types';
import {
  findFirst, findAll, clickFirst, isVisible, isDisabled,
  fillInput, selectOption, setInputFiles, getLabelForInput, verifyUploadAccepted,
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

async function tryResumeSelectionUpload(file: File): Promise<boolean> {
  // Step 1: Ensure the "file resume" radio card is selected
  const fileRadio = document.querySelector<HTMLInputElement>(
    '[data-testid="resume-selection-file-resume-radio-card-input"]'
  );
  if (fileRadio && !fileRadio.checked) {
    log('Resume selection: selecting file resume radio card');
    fileRadio.click();
    await waitMs(500);
  }

  // Step 2: Find the file input
  const fileInput = document.querySelector<HTMLInputElement>(
    '[data-testid="resume-selection-file-resume-radio-card-file-input"]'
  );

  if (!fileInput) {
    log('Resume selection: file input not found via data-testid');
    return false;
  }

  log(`Resume selection: found file input, attempting upload of "${file.name}" (${file.size} bytes)`);

  // Step 3: Intercept native file dialog and set files programmatically
  // The React component listens for 'change' on this input.
  // We prevent the native dialog from opening by intercepting the click,
  // then set files and dispatch the change event.

  // First, try the direct approach: set files and dispatch change
  setInputFiles(fileInput, file);
  await waitMs(1000);
  if (await verifyUploadAccepted(3000, file.name)) {
    log('Resume selection: direct setInputFiles worked');
    return true;
  }

  // Step 4: Try clicking "Opções de currículo" → "Carregar um arquivo diferente"
  // This resets the form and opens a new file picker.
  // We intercept the click on the file input to prevent the native dialog.
  const optionsMenuBtn = document.querySelector<HTMLButtonElement>(
    '[data-testid="ResumeOptionsMenu"]'
  );
  if (optionsMenuBtn) {
    log('Resume selection: opening ResumeOptionsMenu');
    optionsMenuBtn.click();
    await waitMs(800);

    const uploadMenuBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="ResumeOptionsMenu-upload"]'
    );
    if (uploadMenuBtn) {
      // Intercept the file input click to prevent native dialog from opening
      const interceptClick = (e: Event) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      fileInput.addEventListener('click', interceptClick, { once: true, capture: true });

      log('Resume selection: clicking ResumeOptionsMenu-upload (with click interceptor)');
      uploadMenuBtn.click();
      await waitMs(500);

      // Remove interceptor in case it wasn't triggered
      fileInput.removeEventListener('click', interceptClick, { capture: true } as any);

      // Now set the files on the (possibly reset) input
      // Re-query in case the DOM changed
      const freshInput = document.querySelector<HTMLInputElement>(
        '[data-testid="resume-selection-file-resume-radio-card-file-input"]'
      ) || fileInput;

      setInputFiles(freshInput, file);
      await waitMs(1000);
      if (await verifyUploadAccepted(5000, file.name)) {
        log('Resume selection: upload via menu approach worked');
        return true;
      }
    }
  }

  // Step 5: Try "Selecionar arquivo" button with click intercept
  const selectFileBtn = document.querySelector<HTMLButtonElement>(
    '[data-testid="resume-selection-file-resume-radio-card-button"]'
  );
  if (selectFileBtn) {
    const interceptClick2 = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    fileInput.addEventListener('click', interceptClick2, { once: true, capture: true });

    log('Resume selection: clicking "Selecionar arquivo" with click interceptor');
    selectFileBtn.click();
    await waitMs(500);

    fileInput.removeEventListener('click', interceptClick2, { capture: true } as any);

    const freshInput2 = document.querySelector<HTMLInputElement>(
      '[data-testid="resume-selection-file-resume-radio-card-file-input"]'
    ) || fileInput;
    setInputFiles(freshInput2, file);
    await waitMs(1000);
    if (await verifyUploadAccepted(5000, file.name)) {
      log('Resume selection: upload via select file button worked');
      return true;
    }
  }

  // Step 6: API upload as last resort
  log('Resume selection: trying API upload');
  const apiResult = await uploadResumeViaApi(file);
  if (apiResult) {
    log('Resume selection: API upload succeeded, reloading page');
    window.location.reload();
    await waitMs(3000);
    return true;
  }

  // Step 7: Fallback — find any non-image file input on the page
  const allFileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const fi of allFileInputs) {
    if (fi === fileInput) continue;
    const accept = (fi.getAttribute('accept') || '').toLowerCase();
    if (accept.includes('image')) continue;
    log('Resume selection: fallback — setting files on other file input');
    setInputFiles(fi, file);
    if (await verifyUploadAccepted(3000, file.name)) return true;
  }

  return false;
}

async function handleResumeStep(pdfData?: ArrayBuffer, pdfFilename?: string): Promise<void> {
  if (!pdfData || !pdfFilename) return;

  const file = new File([pdfData], pdfFilename, { type: 'application/pdf' });
  log(`handleResumeStep: file="${pdfFilename}" size=${file.size} bytes (pdfData.byteLength=${pdfData.byteLength})`);

  // Detect resume-selection page and use targeted approach first
  const isResumeSelectionPage =
    window.location.href.includes('resume-selection') ||
    !!document.querySelector('[data-testid*="resume-selection"], [class*="resume-selection"], [id*="resume-selection"]');

  if (isResumeSelectionPage) {
    log('Detected resume-selection page, using targeted approach');
    const uploaded = await tryResumeSelectionUpload(file);
    if (uploaded) return;
    log('Targeted approach failed, falling through to generic strategies');
  }

  // Strategy 1: Direct file input already visible
  const existingInput = await waitForFileInput(500);
  if (existingInput) {
    log('Strategy 1: found existing file input');
    setInputFiles(existingInput, file);
    if (await verifyUploadAccepted(2000, pdfFilename)) return;
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
        if (await verifyUploadAccepted(2000, pdfFilename)) return;
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
      if (await verifyUploadAccepted(2000, pdfFilename)) return;
    }
  }

  // Strategy 4: Scan ALL clickables for upload-related text
  const allClickables = [...document.querySelectorAll('button, a, label, [role="button"]')];
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
        if (await verifyUploadAccepted(2000, pdfFilename)) return;
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
  let csrfToken = '';

  // Source 1: Cookies
  const cookies = document.cookie.split(';').map(c => c.trim());
  for (const c of cookies) {
    if (c.startsWith('XSRF-TOKEN=') || c.startsWith('INDEED_CSRF_TOKEN=') || c.startsWith('CTK=')) {
      csrfToken = decodeURIComponent(c.split('=')[1] || '');
      if (csrfToken) break;
    }
  }

  // Source 2: Meta tags
  if (!csrfToken) {
    const metaSelectors = ['meta[name="csrf-token"]', 'meta[name="_csrf"]', 'meta[name="indeed-csrf-token"]'];
    for (const sel of metaSelectors) {
      const meta = document.querySelector(sel);
      if (meta) {
        csrfToken = meta.getAttribute('content') || '';
        if (csrfToken) break;
      }
    }
  }

  // Source 3: __NEXT_DATA__ embedded JSON
  if (!csrfToken) {
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
      try {
        const data = JSON.parse(nextDataEl.textContent || '');
        csrfToken = data?.props?.pageProps?.csrfToken || data?.props?.csrfToken || data?.csrfToken || '';
      } catch { /* ignore */ }
    }
  }

  // Source 4: Hidden input
  if (!csrfToken) {
    const hiddenInput = document.querySelector<HTMLInputElement>(
      'input[name="_csrf"], input[name="csrf_token"], input[name="csrfToken"]'
    );
    csrfToken = hiddenInput?.value || '';
  }

  if (!csrfToken) {
    log('API upload: no CSRF token found from any source');
    return false;
  }

  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const resp = await fetch('/api/v1/files', {
      method: 'POST',
      headers: {
        'ia-upload-category': 'resume',
        'x-xsrf-token': csrfToken,
        'x-csrf-token': csrfToken,
      },
      body: fd,
      credentials: 'include',
    });

    if (resp.ok) {
      log('API upload succeeded');
      return true;
    }

    log(`API upload failed: ${resp.status} ${resp.statusText}`);
    return false;
  } catch (err) {
    log(`API upload error: ${err}`);
    return false;
  }
}

async function handleCoverLetter(pdfData?: ArrayBuffer, pdfFilename?: string): Promise<void> {
  if (!pdfData || !pdfFilename) return;

  const file = new File([pdfData], pdfFilename, { type: 'application/pdf' });

  // Strategy 1: Direct file input for cover letter
  const directInput = document.querySelector<HTMLInputElement>(
    '[data-testid="CoverLetterInput"] input[type="file"], ' +
    'input[accept*="pdf"][name*="cover"], ' +
    '[data-testid*="coverLetter" i] input[type="file"], ' +
    '[data-testid*="cover-letter" i] input[type="file"]'
  );
  if (directInput) {
    log('Cover letter strategy 1: direct input found');
    setInputFiles(directInput, file);
    return;
  }

  // Strategy 2: Click cover letter button, wait for file input
  const coverBtn = findFirst(COVER_LETTER_SELECTORS);
  if (coverBtn) {
    log(`Cover letter strategy 2: clicking "${(coverBtn as HTMLElement).textContent?.trim()}"`);
    (coverBtn as HTMLElement).click();
    const fi = await waitForFileInput(3000);
    if (fi) {
      log('Cover letter strategy 2: file input appeared');
      setInputFiles(fi, file);
      return;
    }
  }

  // Strategy 3: Scan all clickables for cover letter keywords
  const allClickables = [...document.querySelectorAll('button, a, label, [role="button"]')];
  const coverKeywords = ['cover letter', 'carta de apresentação', 'carta de apresentacao',
                         'lettre de motivation', 'anschreiben', 'carta de presentación'];
  for (const el of allClickables) {
    if (!isVisible(el as Element)) continue;
    const text = (el.textContent || '').toLowerCase().trim();
    if (coverKeywords.some(kw => text.includes(kw))) {
      log(`Cover letter strategy 3: clicking "${text}"`);
      (el as HTMLElement).click();
      const fi = await waitForFileInput(3000);
      if (fi) {
        setInputFiles(fi, file);
        return;
      }
    }
  }

  log('WARNING: No cover letter upload strategy worked');
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

      // Reconstruct ArrayBuffers from number[] (Chrome message passing doesn't support ArrayBuffer)
      const cvBuffer = cvData ? new Uint8Array(cvData).buffer : undefined;
      const coverBuffer = coverData ? new Uint8Array(coverData).buffer : undefined;

      (async () => {
        await handleResumeStep(cvBuffer, cvFilename);

        if (hasCoverLetterField()) {
          await handleCoverLetter(coverBuffer, coverFilename);
          await waitMs(300);
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
