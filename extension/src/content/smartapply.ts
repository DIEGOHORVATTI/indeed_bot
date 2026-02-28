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
  getInputConstraints, validateAnswer, detectValidationError,
  InputConstraints,
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

function log(msg: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  console.log(`[smartapply] ${msg}`);
  // Send to Activity Log in the popup UI (fire-and-forget)
  chrome.runtime.sendMessage({
    type: 'ADD_LOG',
    payload: { level, message: `[wizard] ${msg}` },
  }).catch(() => {});
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Ask Claude (via service worker → backend) ──

async function askClaude(
  question: string,
  options?: string[],
  constraints?: Partial<InputConstraints>,
  errorContext?: string
): Promise<string | null> {
  log(`🤖 AI Question: "${question}"${options ? ` [options: ${options.join(', ')}]` : ''}${constraints ? ` [constraints: ${JSON.stringify(constraints)}]` : ''}${errorContext ? ` [retry: ${errorContext}]` : ''}`);

  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        type: 'ASK_CLAUDE',
        payload: {
          question,
          options,
          jobTitle: currentJobTitle,
          baseProfile: currentBaseProfile,
          constraints: constraints ? {
            type: constraints.type,
            maxLength: constraints.maxLength,
            minLength: constraints.minLength,
            min: constraints.min,
            max: constraints.max,
            pattern: constraints.pattern,
            placeholder: constraints.placeholder,
          } : undefined,
          errorContext,
        },
      },
      (response) => {
        const answer = response?.payload?.answer || null;
        log(`🤖 AI Answer: "${answer}" (for: "${question}")`);
        resolve(answer);
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

/** Find the resume file input (tries both new and old data-testid patterns). */
function findResumeFileInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    '[data-testid="resume-selection-file-resume-upload-radio-card-file-input"], ' +
    '[data-testid="resume-selection-file-resume-radio-card-file-input"]'
  );
}

/** Check if there's already a CV loaded (ResumeOptionsMenu visible = existing CV). */
function hasExistingResume(): boolean {
  return !!document.querySelector('[data-testid="ResumeOptionsMenu"]');
}

/**
 * When a CV is already loaded, reset the component via "Opções de currículo" → "Carregar um arquivo diferente".
 * This transitions the UI from "file loaded" state back to "upload" state with an active file input.
 * Returns the fresh file input element, or null if reset failed.
 */
async function resetResumeForNewUpload(): Promise<HTMLInputElement | null> {
  const optionsMenuBtn = document.querySelector<HTMLButtonElement>(
    '[data-testid="ResumeOptionsMenu"]'
  );
  if (!optionsMenuBtn) return null;

  log('Resume: existing CV detected, clicking ResumeOptionsMenu to replace');
  optionsMenuBtn.click();
  await waitMs(800);

  const uploadMenuBtn = document.querySelector<HTMLButtonElement>(
    '[data-testid="ResumeOptionsMenu-upload"]'
  );
  if (!uploadMenuBtn) {
    log('Resume: ResumeOptionsMenu-upload button not found');
    return null;
  }

  // Intercept file input click to prevent native file dialog from opening
  const existingInput = findResumeFileInput();
  if (existingInput) {
    const interceptClick = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    existingInput.addEventListener('click', interceptClick, { once: true, capture: true });

    log('Resume: clicking "Carregar um arquivo diferente" (with click interceptor)');
    uploadMenuBtn.click();
    await waitMs(1000);

    existingInput.removeEventListener('click', interceptClick, { capture: true } as any);
  } else {
    uploadMenuBtn.click();
    await waitMs(1000);
  }

  // After reset, the component re-renders with a fresh file input (possibly new testid).
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const freshInput = findResumeFileInput();
    if (freshInput) {
      log('Resume: component reset, fresh file input ready');
      return freshInput;
    }
    await waitMs(300);
  }

  log('Resume: no file input found after reset');
  return null;
}

async function tryResumeSelectionUpload(file: File): Promise<boolean> {
  // Step 1: Ensure the "file resume" radio card is selected
  const fileRadio = document.querySelector<HTMLInputElement>(
    '[data-testid="resume-selection-file-resume-upload-radio-card-input"], [data-testid="resume-selection-file-resume-radio-card-input"]'
  );
  if (fileRadio && !fileRadio.checked) {
    log('Resume: selecting file resume radio card');
    fileRadio.click();
    await waitMs(500);
  }

  log(`Resume: attempting upload of "${file.name}" (${file.size} bytes)`);

  // Step 2: If there's already a CV loaded, we MUST reset the component first.
  // BUG FIX: Direct setInputFiles on a hidden input sets input.files on the DOM
  // but React ignores the change — verifyUploadAccepted falsely returns true
  // (because it checks input.files) while Indeed keeps the OLD CV.
  if (hasExistingResume()) {
    log('Resume: existing CV loaded, must reset before uploading new one');
    const freshInput = await resetResumeForNewUpload();
    if (freshInput) {
      setInputFiles(freshInput, file);
      await waitMs(1500);
      if (await verifyUploadAccepted(5000, file.name)) {
        log('Resume: upload via reset+setInputFiles worked');
        return true;
      }
    }
    // If reset approach didn't work, try the select-file button below
  } else {
    // No existing CV — direct upload on the visible file input
    const fileInput = findResumeFileInput();
    if (fileInput) {
      setInputFiles(fileInput, file);
      await waitMs(1000);
      if (await verifyUploadAccepted(3000, file.name)) {
        log('Resume: direct setInputFiles worked');
        return true;
      }
    }
  }

  // Step 3: Try "Selecionar arquivo" button with click intercept
  const selectFileBtn = document.querySelector<HTMLButtonElement>(
    '[data-testid="resume-selection-file-resume-upload-radio-card-button"], [data-testid="resume-selection-file-resume-radio-card-button"]'
  );
  if (selectFileBtn) {
    const currentInput = findResumeFileInput();
    if (currentInput) {
      const interceptClick = (e: Event) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      currentInput.addEventListener('click', interceptClick, { once: true, capture: true });

      log('Resume: clicking "Selecionar arquivo" with click interceptor');
      selectFileBtn.click();
      await waitMs(500);

      currentInput.removeEventListener('click', interceptClick, { capture: true } as any);

      const freshInput = findResumeFileInput() || currentInput;
      setInputFiles(freshInput, file);
      await waitMs(1000);
      if (await verifyUploadAccepted(5000, file.name)) {
        log('Resume: upload via select file button worked');
        return true;
      }
    }
  }

  // Step 4: API upload as last resort
  log('Resume: trying API upload');
  const apiResult = await uploadResumeViaApi(file);
  if (apiResult) {
    log('Resume: API upload succeeded, reloading page');
    window.location.reload();
    await waitMs(3000);
    return true;
  }

  // Step 5: Fallback — find any non-image file input on the page
  const allFileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const fi of allFileInputs) {
    const accept = (fi.getAttribute('accept') || '').toLowerCase();
    if (accept.includes('image')) continue;
    log('Resume: fallback — setting files on other file input');
    setInputFiles(fi, file);
    if (await verifyUploadAccepted(3000, file.name)) return true;
  }

  return false;
}

/** Returns true if the new CV was uploaded and confirmed, false otherwise. */
async function handleResumeStep(pdfData?: ArrayBuffer, pdfFilename?: string): Promise<boolean> {
  if (!pdfData || !pdfFilename) return false;

  const file = new File([pdfData], pdfFilename, { type: 'application/pdf' });
  log(`handleResumeStep: file="${pdfFilename}" size=${file.size} bytes (pdfData.byteLength=${pdfData.byteLength})`);

  // Detect resume-selection page and use targeted approach first
  const isResumeSelectionPage =
    window.location.href.includes('resume-selection') ||
    !!document.querySelector('[data-testid*="resume-selection"], [class*="resume-selection"], [id*="resume-selection"]');

  if (isResumeSelectionPage) {
    log('Detected resume-selection page, using targeted approach');
    const uploaded = await tryResumeSelectionUpload(file);
    if (uploaded) return true;
    log('Targeted approach failed, falling through to generic strategies');
  }

  // Strategy 1: Direct file input already visible
  const existingInput = await waitForFileInput(500);
  if (existingInput) {
    log('Strategy 1: found existing file input');
    setInputFiles(existingInput, file);
    if (await verifyUploadAccepted(2000, pdfFilename)) return true;
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
        if (await verifyUploadAccepted(2000, pdfFilename)) return true;
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
      if (await verifyUploadAccepted(2000, pdfFilename)) return true;
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
        if (await verifyUploadAccepted(2000, pdfFilename)) return true;
      }
    }
  }

  // Strategy 5: API-based upload
  log('Strategy 5: trying API upload');
  const apiResult = await uploadResumeViaApi(file);
  if (apiResult) {
    log('Strategy 5: API upload succeeded');
    return true;
  }

  // Strategy 6: Select existing resume card (last resort — uses old CV, not new)
  const card = findFirst(RESUME_CARD_SELECTORS);
  if (card) {
    log('Strategy 6: clicking existing card (WARNING: using old CV, not the new dynamic one)', 'warning');
    (card as HTMLElement).click();
    return false;
  }

  log('WARNING: No resume upload strategy worked', 'warning');
  return false;
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

    log(`API upload failed: ${resp.status} ${resp.statusText}`, 'warning');
    return false;
  } catch (err) {
    log(`API upload error: ${err}`, 'error');
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

  log('WARNING: No cover letter upload strategy worked', 'warning');
}

// ── Special Page Handling ──

/** Handle known Indeed wizard pages that don't have standard form fields. */
async function handleSpecialPages(): Promise<boolean> {
  // Privacy settings: "Quer permitir que as empresas encontrem você?"
  const privacyForm = document.querySelector('[data-testid="privacy-settings-form"]');
  if (privacyForm) {
    log('🔒 Special page: privacy-settings detected');
    const optinRadio = document.querySelector<HTMLInputElement>('[data-testid="privacy-settings-optin-input"]');
    if (optinRadio && !optinRadio.checked) {
      optinRadio.click();
      log('🔒 Clicked optin radio');
      await waitMs(300);
    }
    const continueBtn = privacyForm.querySelector<HTMLButtonElement>('[data-testid="continue-button"]');
    if (continueBtn) {
      continueBtn.click();
      log('🔒 Clicked continue on privacy-settings');
      return true;
    }
  }

  // Auto-check unchecked checkboxes that look like consent/agreement/opt-in
  const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  for (const cb of checkboxes) {
    if (!isVisible(cb) || cb.checked) continue;
    const label = getLabelForInput(cb);
    if (!label) continue;
    const lower = label.toLowerCase();
    // Auto-check consent, agreement, terms, notifications, privacy, allow
    const autoCheckKeywords = [
      'agree', 'aceito', 'concordo', 'consent', 'autorizo',
      'allow', 'permitir', 'terms', 'termos', 'privacy',
      'notification', 'notificaç', 'comunicaç',
    ];
    if (autoCheckKeywords.some(kw => lower.includes(kw))) {
      cb.click();
      log(`☑️ Auto-checked: "${label}"`);
      await waitMs(200);
    }
  }

  return false;
}

// ── DOM-based AI Fallback ──

/** Extract a simplified version of the DOM for AI analysis. */
function getSimplifiedDom(): string {
  const MAX_LENGTH = 3000;
  const parts: string[] = [];

  // Page title/heading
  const h1 = document.querySelector('h1');
  if (h1) parts.push(`<h1>${h1.textContent?.trim()}</h1>`);

  // Forms
  const forms = document.querySelectorAll('form');
  for (const form of forms) {
    const testId = form.getAttribute('data-testid') || '';
    parts.push(`<form data-testid="${testId}">`);

    // Fieldsets with labels
    const fieldsets = form.querySelectorAll('fieldset');
    for (const fs of fieldsets) {
      const role = fs.getAttribute('role') || '';
      const fsTestId = fs.getAttribute('data-testid') || '';
      parts.push(`  <fieldset role="${role}" data-testid="${fsTestId}">`);

      const inputs = fs.querySelectorAll('input');
      for (const inp of inputs) {
        const type = inp.type;
        const val = inp.value;
        const checked = inp.checked ? ' checked' : '';
        const tid = inp.getAttribute('data-testid') || '';
        const lbl = getLabelForInput(inp);
        parts.push(`    <input type="${type}" value="${val}"${checked} data-testid="${tid}" label="${lbl}"/>`);
      }
      parts.push('  </fieldset>');
    }

    // Standalone inputs
    const standaloneInputs = form.querySelectorAll(':scope > input, :scope > div input');
    for (const inp of standaloneInputs) {
      if (inp.closest('fieldset')) continue;
      const htmlInp = inp as HTMLInputElement;
      const lbl = getLabelForInput(htmlInp);
      parts.push(`  <input type="${htmlInp.type}" value="${htmlInp.value}" label="${lbl}"/>`);
    }

    parts.push('</form>');
  }

  // Visible buttons
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (!isVisible(btn)) continue;
    const text = btn.textContent?.trim() || '';
    const testId = btn.getAttribute('data-testid') || '';
    const disabled = (btn as HTMLButtonElement).disabled ? ' disabled' : '';
    parts.push(`<button data-testid="${testId}"${disabled}>${text}</button>`);
  }

  let dom = parts.join('\n');
  if (dom.length > MAX_LENGTH) dom = dom.substring(0, MAX_LENGTH) + '\n... (truncated)';
  return dom;
}

/** When stuck, ask Claude to analyze the DOM and tell us what to do. */
async function askClaudeForDomAction(): Promise<'continued' | 'submitted' | 'none'> {
  const simplifiedDom = getSimplifiedDom();
  log(`🧠 DOM Fallback: sending simplified DOM (${simplifiedDom.length} chars) to AI`);

  const question = `You are automating an Indeed job application wizard. The bot is stuck on this page and doesn't know what to do.

Analyze the DOM below and respond with EXACTLY one of:
1. "CLICK:<data-testid>" — if a button should be clicked (e.g. "CLICK:continue-button")
2. "CLICK_TEXT:<button text>" — if button has no testid (e.g. "CLICK_TEXT:Continuar")
3. "SELECT:<data-testid>" — if a radio/checkbox should be selected first
4. "SKIP" — if this page should be skipped/is informational

RULES:
- Always opt-in to allow companies to find you
- Always accept terms, notifications, agreements
- Always click continue/next when possible
- Prefer the most positive/permissive option

Page DOM:
${simplifiedDom}`;

  const answer = await askClaude(question);
  if (!answer) return 'none';

  log(`🧠 DOM Fallback AI response: "${answer}"`);

  if (answer.startsWith('CLICK:')) {
    const testId = answer.substring(6).trim();
    const btn = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (btn) {
      btn.click();
      log(`🧠 DOM Fallback: clicked [data-testid="${testId}"]`);
      return 'continued';
    }
  }

  if (answer.startsWith('CLICK_TEXT:')) {
    const text = answer.substring(11).trim().toLowerCase();
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      if ((btn.textContent || '').toLowerCase().trim().includes(text)) {
        (btn as HTMLElement).click();
        log(`🧠 DOM Fallback: clicked button with text "${text}"`);
        return 'continued';
      }
    }
  }

  if (answer.startsWith('SELECT:')) {
    const testId = answer.substring(7).trim();
    const el = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (el) {
      el.click();
      log(`🧠 DOM Fallback: selected [data-testid="${testId}"]`);
      await waitMs(300);
      // After selecting, try to click continue
      if (clickFirst(CONTINUE_SELECTORS)) return 'continued';
    }
  }

  return 'none';
}

// ── Questionnaire Handling (all via Claude) ──

async function handleQuestionnaire(): Promise<{ needsUserInput: boolean; fieldLabel?: string }> {
  const MAX_RETRIES = 2;

  // Text inputs + textareas (unified with retry logic)
  const textInputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], textarea'
  );

  for (const inp of textInputs) {
    if (!isVisible(inp)) continue;
    if (inp.value.trim()) continue;

    const label = getLabelForInput(inp);
    if (!label) continue;

    const constraints = getInputConstraints(inp);
    log(`📝 Field: "${label}" [type=${constraints.type}, required=${constraints.required}${constraints.placeholder ? `, placeholder=${constraints.placeholder}` : ''}${constraints.maxLength ? `, maxLen=${constraints.maxLength}` : ''}${constraints.min ? `, min=${constraints.min}` : ''}${constraints.max ? `, max=${constraints.max}` : ''}${constraints.pattern ? `, pattern=${constraints.pattern}` : ''}]`);

    // Detect if this is actually a date field (Indeed uses type="text" for dates)
    const isDateField = constraints.type === 'date'
      || !!constraints.placeholder?.match(/[DMY]{2,4}/i)
      || !!(inp.getAttribute('aria-label') || '').match(/dat[ae]/i)
      || !!label.match(/\b(data|date|when|quando|início|start|término|end|from|until|até)\b/i);

    // If we detected it's a date but have no format hint, check error messages on page
    if (isDateField && !constraints.placeholder?.match(/[DMY]{2,4}/i)) {
      const pageText = document.body?.innerText || '';
      const formatMatch = pageText.match(/(DD\/MM\/YYYY|MM\/DD\/YYYY|YYYY-MM-DD)/i);
      if (formatMatch) {
        constraints.placeholder = formatMatch[1];
        log(`📅 Detected date format from page text: ${formatMatch[1]}`);
      } else {
        // Default to DD/MM/YYYY for br.indeed.com
        const isBrazil = window.location.hostname.includes('br.indeed');
        constraints.placeholder = isBrazil ? 'DD/MM/YYYY' : 'MM/DD/YYYY';
        log(`📅 No date format found, defaulting to: ${constraints.placeholder}`);
      }
    }

    // Enrich the question with format/type hints so AI knows what to produce
    let enrichedLabel = label;
    if (isDateField && constraints.placeholder) {
      enrichedLabel = `${label} (MUST answer in exact format: ${constraints.placeholder}, example: ${
        constraints.placeholder === 'DD/MM/YYYY' ? '15/03/2024' :
        constraints.placeholder === 'MM/DD/YYYY' ? '03/15/2024' : '2024-03-15'
      })`;
    } else if (constraints.placeholder) {
      if (!label.toLowerCase().includes(constraints.placeholder.toLowerCase())) {
        enrichedLabel = `${label} (${constraints.placeholder})`;
      }
    }
    if (constraints.type === 'number') {
      enrichedLabel = `${enrichedLabel} (answer must be a number only, no text)`;
    } else if (constraints.type === 'tel') {
      enrichedLabel = `${enrichedLabel} (phone number, digits only)`;
    } else if (constraints.type === 'email') {
      enrichedLabel = `${enrichedLabel} (email address)`;
    } else if (isDateField) {
      // Override type in constraints to signal date to the backend
      constraints.type = 'date';
    }

    let filled = false;
    let errorContext: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const answer = await askClaude(enrichedLabel, undefined, constraints, errorContext);
      if (!answer) {
        const isRequired = constraints.required || label.includes('*');
        if (isRequired) return { needsUserInput: true, fieldLabel: label };
        break;
      }

      // Pre-fill validation
      const validation = validateAnswer(answer, constraints);
      if (!validation.valid) {
        log(`⚠️ Pre-validation failed for "${label}": ${validation.error} (answer="${answer}", attempt ${attempt + 1}/${MAX_RETRIES + 1})`, 'warning');
        if (attempt < MAX_RETRIES) {
          errorContext = `Previous answer "${answer}" was rejected: ${validation.error}. Generate a valid answer.`;
          continue;
        }
        // Last attempt: truncate if maxLength issue, or use as-is
        if (constraints.maxLength && answer.length > constraints.maxLength) {
          fillInput(inp, answer.substring(0, constraints.maxLength));
          filled = true;
        }
        break;
      }

      // Fill the input
      fillInput(inp, answer);
      await waitMs(300);

      // Post-fill validation (check browser/UI errors)
      const domError = detectValidationError(inp);
      if (domError) {
        log(`⚠️ Post-fill error for "${label}": ${domError} (answer="${answer}", attempt ${attempt + 1}/${MAX_RETRIES + 1})`, 'warning');
        if (attempt < MAX_RETRIES) {
          fillInput(inp, ''); // Clear field for retry
          errorContext = `Previous answer "${answer}" triggered error: "${domError}". Generate a different answer.`;
          continue;
        }
      }

      filled = true;
      break;
    }

    if (!filled) {
      const isRequired = constraints.required || label.includes('*');
      if (isRequired) return { needsUserInput: true, fieldLabel: label };
    }
  }

  // Selects (skip visibility check — Indeed often hides native selects with CSS but they're still interactive)
  const selects = document.querySelectorAll<HTMLSelectElement>('select');
  for (const sel of selects) {
    // Process if: empty value, OR aria-invalid (form tried to submit but select wasn't filled)
    const needsFilling = !sel.value || sel.getAttribute('aria-invalid') === 'true';
    if (!needsFilling) continue;

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

    log(`📝 Select: "${label}" [options: ${optionTexts.join(', ')}]`);

    if (optionTexts.length > 0) {
      const answer = await askClaude(label, optionTexts);
      if (answer) {
        const idx = optionTexts.indexOf(answer);
        if (idx >= 0) {
          selectOption(sel, optionValues[idx]);
          log(`✅ Selected: "${answer}" for "${label}"`);
        }
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
      // Walk up to find the question container (not the individual radio wrapper)
      const questionContainer = groupRadios[0].closest('[data-testid*="input-q_"], .ia-Questions-item, fieldset');
      if (questionContainer) {
        // Look for the label/heading of the question group (not individual radio labels)
        const labelEl = questionContainer.querySelector('[data-testid*="-label"] [data-testid="safe-markup"], legend, [class*="label"]');
        groupLabel = labelEl?.textContent?.trim() || '';
      }
      if (!groupLabel) {
        // Fallback: find the closest parent with a label that's NOT one of the radio options
        const parent = groupRadios[0].closest('fieldset, [class*="Questions-item"], [id^="q_"]');
        const allLabels = parent?.querySelectorAll('label, legend, span') || [];
        for (const lbl of allLabels) {
          const text = lbl.textContent?.trim() || '';
          // Skip if it's one of the radio option labels
          if (optionLabels.includes(text)) continue;
          if (text.length > 5 && text.length < 500) {
            groupLabel = text;
            break;
          }
        }
      }
      if (!groupLabel) groupLabel = name;
    } catch {
      groupLabel = name;
    }

    log(`📝 Radio: "${groupLabel}" [options: ${optionLabels.join(', ')}]`);

    if (optionLabels.length > 0) {
      const answer = await askClaude(groupLabel, optionLabels);
      if (answer) {
        const idx = optionLabels.indexOf(answer);
        if (idx >= 0) {
          groupRadios[idx].click();
          log(`✅ Selected radio: "${answer}" for "${groupLabel}"`);
        }
      } else {
        return { needsUserInput: true, fieldLabel: groupLabel };
      }
    } else {
      groupRadios[0].click();
    }
  }

  return { needsUserInput: false };
}

// ── Post-Click Error Detection ──

/** Scan the page for visible validation/error messages after clicking Continue/Submit. */
function detectPageErrors(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  // 1. Check all inputs/selects with aria-invalid="true" or validationMessage
  const allInputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select'
  );
  for (const inp of allInputs) {
    const hasAriaInvalid = inp.getAttribute('aria-invalid') === 'true';
    const hasValidationMsg = 'validationMessage' in inp && inp.validationMessage;

    if (!hasAriaInvalid && !hasValidationMsg) continue;

    const label = getLabelForInput(inp);
    const errText = detectValidationError(inp);

    if (errText && !seen.has(errText)) {
      const msg = label ? `${label}: ${errText}` : errText;
      errors.push(msg);
      seen.add(errText);
    } else if (hasAriaInvalid && label) {
      const msg = `${label}: campo inválido`;
      if (!seen.has(msg)) {
        errors.push(msg);
        seen.add(msg);
      }
    }
  }

  // 2. Visible error elements on the page (role=alert, .error, etc.)
  const errorSelectors = [
    '[role="alert"]',
    '.error', '.field-error', '.input-error',
    '[class*="error" i]:not(script):not(style):not(input):not(select):not(textarea)',
    '[data-testid*="error" i]',
  ];
  for (const sel of errorSelectors) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!isVisible(el)) continue;
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 300 && !seen.has(text)) {
          errors.push(text);
          seen.add(text);
        }
      }
    } catch { /* invalid selector */ }
  }

  return errors;
}

/**
 * Try to fix form errors detected after clicking Continue/Submit.
 * For each input with an error, ask Claude for a corrected answer.
 */
async function handlePostClickErrors(pageErrors: string[]): Promise<'fixed' | 'failed'> {
  let anyFixed = false;

  // Find inputs with validation errors
  const allInputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea'
  );

  for (const inp of allInputs) {
    if (!isVisible(inp)) continue;

    const domError = detectValidationError(inp);
    if (!domError) continue;

    const label = getLabelForInput(inp);
    if (!label) continue;

    const constraints = getInputConstraints(inp);
    const currentValue = inp.value;

    // Detect date fields and extract format from error message or page
    const isDateField = constraints.type === 'date'
      || !!constraints.placeholder?.match(/[DMY]{2,4}/i)
      || !!domError.match(/[DMY]{2,4}/i)
      || !!label.match(/\b(data|date|when|quando|início|start|término|end)\b/i);

    if (isDateField) {
      // Extract format from error message (e.g. "Insira as datas no formato DD/MM/YYYY")
      const formatFromError = domError.match(/(DD\/MM\/YYYY|MM\/DD\/YYYY|YYYY-MM-DD)/i);
      if (formatFromError) {
        constraints.placeholder = formatFromError[1];
      } else if (!constraints.placeholder?.match(/[DMY]{2,4}/i)) {
        const pageText = document.body?.innerText || '';
        const formatFromPage = pageText.match(/(DD\/MM\/YYYY|MM\/DD\/YYYY|YYYY-MM-DD)/i);
        constraints.placeholder = formatFromPage?.[1] || 'DD/MM/YYYY';
      }
      constraints.type = 'date';
    }

    // Enrich label with format hints for retry
    let enrichedLabel = label;
    if (isDateField && constraints.placeholder) {
      const example = constraints.placeholder === 'DD/MM/YYYY' ? '15/03/2024' :
        constraints.placeholder === 'MM/DD/YYYY' ? '03/15/2024' : '2024-03-15';
      enrichedLabel = `${label} (MUST answer in exact format: ${constraints.placeholder}, example: ${example})`;
    } else if (constraints.type === 'number') {
      enrichedLabel = `${label} (answer must be a number only)`;
    } else if (constraints.type === 'tel') {
      enrichedLabel = `${label} (phone number)`;
    }

    const errorContext = `After submitting the form, field "${enrichedLabel}" has error: "${domError}". Current value: "${currentValue}". Page errors: ${pageErrors.join('; ')}. Fix the answer.`;

    log(`🔧 Fixing field "${label}" — error: "${domError}", current: "${currentValue}", isDate: ${isDateField}`);

    const answer = await askClaude(enrichedLabel, undefined, constraints, errorContext);
    if (answer) {
      fillInput(inp, answer);
      log(`🔧 Fixed "${label}" with new answer: "${answer}"`);
      anyFixed = true;
      await waitMs(300);
    }
  }

  // Also check for unfilled required fields that might have appeared
  for (const inp of allInputs) {
    if (!isVisible(inp)) continue;
    if (inp.value.trim()) continue;

    const isRequired = inp.required || inp.getAttribute('aria-required') === 'true';
    if (!isRequired) continue;

    const label = getLabelForInput(inp);
    if (!label) continue;

    const constraints = getInputConstraints(inp);
    log(`🔧 Found empty required field: "${label}"`);

    const answer = await askClaude(label, undefined, constraints);
    if (answer) {
      fillInput(inp, answer);
      log(`🔧 Filled empty required field "${label}" with: "${answer}"`);
      anyFixed = true;
      await waitMs(300);
    }
  }

  // Fix selects with aria-invalid or empty required value
  const allSelects = document.querySelectorAll<HTMLSelectElement>('select');
  for (const sel of allSelects) {
    const hasError = sel.getAttribute('aria-invalid') === 'true' || (!sel.value && sel.required);
    if (!hasError) continue;

    const label = getLabelForInput(sel);
    if (!label) continue;

    const opts = Array.from(sel.querySelectorAll('option'));
    const optionTexts: string[] = [];
    const optionValues: string[] = [];
    for (const opt of opts) {
      if (opt.value) {
        optionTexts.push(opt.textContent?.trim() || '');
        optionValues.push(opt.value);
      }
    }

    if (optionTexts.length === 0) continue;

    log(`🔧 Fixing select "${label}" — aria-invalid or empty, ${optionTexts.length} options`);

    const answer = await askClaude(
      label, optionTexts, undefined,
      `This select field has error: "Escolha uma opção para continuar". Page errors: ${pageErrors.join('; ')}. Pick the correct option.`
    );
    if (answer) {
      const idx = optionTexts.indexOf(answer);
      if (idx >= 0) {
        selectOption(sel, optionValues[idx]);
        log(`🔧 Fixed select "${label}" with: "${answer}"`);
        anyFixed = true;
        await waitMs(300);
      }
    }
  }

  return anyFixed ? 'fixed' : 'failed';
}

// ── MutationObserver-based Post-Click Error Detection ──

/**
 * After clicking Continue/Submit, use MutationObserver to watch for:
 * - aria-invalid attribute changes (React sets this on validation failure)
 * - New error elements (role="alert", .error, etc.) inserted into DOM
 * - validationMessage changes on inputs
 * Returns collected error messages, or empty array if no errors detected within timeout.
 */
function waitForPostClickErrors(timeoutMs: number): Promise<string[]> {
  return new Promise(resolve => {
    const errors: string[] = [];
    const seen = new Set<string>();
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      // Also do a final sweep of aria-invalid elements
      const ariaInvalids = document.querySelectorAll('[aria-invalid="true"]');
      for (const el of ariaInvalids) {
        // Find associated error text
        const errId = el.getAttribute('aria-errormessage') || el.getAttribute('aria-describedby');
        if (errId) {
          const errEl = document.getElementById(errId);
          const text = errEl?.textContent?.trim();
          if (text && !seen.has(text)) {
            errors.push(text);
            seen.add(text);
          }
        }
        // Check parent for error elements
        const parent = el.closest('div, fieldset, li');
        if (parent) {
          const errorEl = parent.querySelector('[role="alert"], .error, .field-error, [class*="error" i]');
          const text = errorEl?.textContent?.trim();
          if (text && text.length > 2 && !seen.has(text)) {
            errors.push(text);
            seen.add(text);
          }
        }
        // Check native validation
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          if (el.validationMessage && !seen.has(el.validationMessage)) {
            errors.push(el.validationMessage);
            seen.add(el.validationMessage);
          }
        }
      }
      resolve(errors);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Attribute changes (aria-invalid being set to "true")
        if (mutation.type === 'attributes' && mutation.attributeName === 'aria-invalid') {
          const target = mutation.target as Element;
          if (target.getAttribute('aria-invalid') === 'true') {
            const label = getLabelForInput(target);
            const errId = target.getAttribute('aria-errormessage') || target.getAttribute('aria-describedby');
            let errText = '';
            if (errId) {
              errText = document.getElementById(errId)?.textContent?.trim() || '';
            }
            const msg = errText || `${label || 'Field'}: validation error`;
            if (!seen.has(msg)) {
              errors.push(msg);
              seen.add(msg);
            }
          }
        }

        // New nodes (error elements being inserted)
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const isError = node.matches('[role="alert"], .error, .field-error, [class*="error" i], [data-testid*="error" i]')
              || node.querySelector('[role="alert"], .error, .field-error');
            if (isError) {
              const text = node.textContent?.trim();
              if (text && text.length > 2 && text.length < 300 && !seen.has(text)) {
                errors.push(text);
                seen.add(text);
              }
            }
          }
        }
      }
    });

    // Watch entire document for attribute changes and child additions
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-invalid'],
      childList: true,
      subtree: true,
    });

    // Timeout: resolve with whatever errors we've collected
    setTimeout(finish, timeoutMs);
  });
}

// ── Wizard Navigation ──

function clickContinueOrSubmit(): 'submitted' | 'continued' | 'none' {
  // Log all visible buttons for debugging
  const allBtns = findAll('button', document).filter(isVisible);
  const btnTexts = allBtns.map(b => (b.textContent || '').trim().substring(0, 40));
  log(`Buttons on page: [${btnTexts.join(', ')}]`);

  if (clickFirst(SUBMIT_SELECTORS)) { log('Clicked SUBMIT via selector'); return 'submitted'; }
  if (clickFirst(CONTINUE_SELECTORS)) { log('Clicked CONTINUE via selector'); return 'continued'; }

  for (const btn of allBtns) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (SKIP_KEYWORDS.some(kw => text.includes(kw))) continue;
    if (SUBMIT_KEYWORDS.some(kw => text.includes(kw))) {
      log(`Clicked SUBMIT button: "${text}"`);
      (btn as HTMLElement).click();
      return 'submitted';
    }
  }

  for (const btn of allBtns) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (SKIP_KEYWORDS.some(kw => text.includes(kw))) continue;
    if (CONTINUE_KEYWORDS.some(kw => text.includes(kw))) {
      log(`Clicked CONTINUE button: "${text}"`);
      (btn as HTMLElement).click();
      return 'continued';
    }
  }

  for (const btn of allBtns) {
    const text = (btn.textContent || '').toLowerCase().trim();
    if (SKIP_KEYWORDS.some(kw => text.includes(kw))) continue;
    if (!text || text.length > 50) continue;
    if (isDisabled(btn)) continue;
    log(`Clicked FALLBACK button: "${text}"`);
    (btn as HTMLElement).click();
    return 'continued';
  }

  log('No clickable button found!', 'warning');
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
        try {
          log(`FILL_AND_ADVANCE: url=${window.location.href.substring(0, 80)}, hasCv=${!!(cvBuffer && cvFilename)}, cvSize=${cvBuffer?.byteLength || 0}`);

          // FIRST: Handle special pages (privacy-settings, consent, etc.)
          // Must run BEFORE resume upload — sub-pages like /privacy-settings
          // are inside the resume-selection module but have no file inputs.
          const specialHandled = await handleSpecialPages();
          if (specialHandled) {
            log('Special page handled, continuing');
            sendResponse({ type: 'STEP_RESULT', payload: { action: 'continued' } });
            return;
          }

          // Check if this is actually a resume upload page (not a sub-page like privacy-settings).
          // The URL may contain "resume-selection" but the actual page could be a sub-step.
          // Only treat as resume page if there's a file input or resume card visible.
          const hasCvToUpload = !!(cvBuffer && cvFilename);
          const hasResumeUploadUI = !!(
            document.querySelector('input[type="file"]') ||
            document.querySelector('[data-testid="ResumeOptionsMenu"]') ||
            document.querySelector('[data-testid*="resume-selection-file"]') ||
            document.querySelector('[data-testid*="resume-display"]')
          );
          const isResumeSelectionPage = hasResumeUploadUI && (
            window.location.href.includes('resume-selection') ||
            !!document.querySelector('[data-testid*="resume-selection"]')
          );

          log(`Page check: isResumePage=${isResumeSelectionPage}, hasResumeUI=${hasResumeUploadUI}, hasCvToUpload=${hasCvToUpload}`);

          if (isResumeSelectionPage && hasCvToUpload) {
            log('On resume-selection page with CV data, uploading...');
            const uploadOk = await handleResumeStep(cvBuffer, cvFilename);
            log(`Upload result: ${uploadOk}`);

            if (!uploadOk) {
              log('WARNING: CV upload failed on resume-selection page, continuing anyway with existing CV', 'warning');
              // Don't block — fall through to click Continue with whatever CV is there
            }
          } else if (hasCvToUpload && hasResumeUploadUI) {
            // Not explicitly resume page but has file input — try upload anyway
            await handleResumeStep(cvBuffer, cvFilename);
          }

          if (hasCoverLetterField()) {
            log('Cover letter field detected, handling...');
            await handleCoverLetter(coverBuffer, coverFilename);
            await waitMs(300);
          }

          const result = await handleQuestionnaire();
          if (result.needsUserInput) {
            log(`Questionnaire needs input: ${result.fieldLabel}`, 'warning');
            sendResponse({
              type: 'STEP_RESULT',
              payload: { action: 'needs_input', fieldLabel: result.fieldLabel },
            });
            return;
          }

          await waitMs(500);

          // Snapshot DOM state before clicking to detect if page changed
          const urlBefore = window.location.href;
          const domSnapshotBefore = document.body?.innerHTML?.length || 0;

          let navResult = clickContinueOrSubmit();
          log(`Navigation result: ${navResult}`);

          // DOM-based AI fallback: when no button found, ask AI to analyze the page
          if (navResult === 'none') {
            log('⚠️ No navigation button found, trying DOM-based AI fallback...', 'warning');
            navResult = await askClaudeForDomAction();
            log(`DOM fallback result: ${navResult}`);
          }

          // Post-click error detection using MutationObserver
          // Watches for: aria-invalid changes, error element insertions, role=alert
          if (navResult === 'continued' || navResult === 'submitted') {
            const errorsDetected = await waitForPostClickErrors(1500);

            if (errorsDetected.length > 0) {
              log(`⚠️ Form errors detected after clicking: ${errorsDetected.join(' | ')}`, 'warning');

              const fixResult = await handlePostClickErrors(errorsDetected);
              if (fixResult === 'fixed') {
                await waitMs(500);
                navResult = clickContinueOrSubmit();
                log(`Retry navigation after fix: ${navResult}`);

                // Check again after retry
                const retryErrors = await waitForPostClickErrors(1000);
                if (retryErrors.length > 0) {
                  log('⚠️ Still errors after retry, sending DOM to AI', 'warning');
                  navResult = await askClaudeForDomAction();
                }
              } else {
                log('⚠️ Could not fix form errors, sending DOM to AI', 'warning');
                navResult = await askClaudeForDomAction();
              }
            } else {
              // No errors detected by observer — also check if page didn't change at all
              const urlAfter = window.location.href;
              const domSnapshotAfter = document.body?.innerHTML?.length || 0;
              const pageChanged = urlAfter !== urlBefore || Math.abs(domSnapshotAfter - domSnapshotBefore) > 200;

              if (!pageChanged) {
                // Page really didn't change — do a final scan
                const pageErrors = detectPageErrors();
                if (pageErrors.length > 0) {
                  log(`⚠️ Form errors found in final scan: ${pageErrors.join(' | ')}`, 'warning');
                  const fixResult = await handlePostClickErrors(pageErrors);
                  if (fixResult === 'fixed') {
                    await waitMs(500);
                    navResult = clickContinueOrSubmit();
                    log(`Retry navigation after final fix: ${navResult}`);
                  }
                }
              }
            }
          }

          sendResponse({ type: 'STEP_RESULT', payload: { action: navResult } });
        } catch (err) {
          log(`FILL_AND_ADVANCE ERROR: ${err}`, 'error');
          sendResponse({
            type: 'STEP_RESULT',
            payload: { action: 'needs_input', fieldLabel: `Internal error: ${err}` },
          });
        }
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
