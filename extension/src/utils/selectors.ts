/**
 * DOM selector helpers — replaces Playwright's query_selector API.
 * Supports custom :has-text() and :visible pseudo-selectors.
 */

/** Check if an element is visible (has layout and not hidden) */
export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Check if an element is disabled */
export function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

/**
 * Parse and query a selector that may contain :has-text("...") and :visible pseudo-selectors.
 * These are Playwright-specific and not part of CSS, so we handle them manually.
 *
 * Examples:
 *   'button:visible:has-text("Apply")'
 *   'a:has-text("Upload")'
 *   'input[type="file"]'  (standard CSS, passed through)
 */
function parseAndQuery(root: Element | Document, selector: string): Element[] {
  // Extract :has-text("...") if present
  const hasTextMatch = selector.match(/:has-text\("([^"]+)"\)/);
  const visibleFlag = selector.includes(':visible');

  // Remove custom pseudo-selectors for the actual CSS query
  let cssSelector = selector
    .replace(/:has-text\("[^"]+"\)/, '')
    .replace(/:visible/g, '')
    .trim();

  if (!cssSelector) cssSelector = '*';

  let elements: Element[];
  try {
    elements = Array.from(root.querySelectorAll(cssSelector));
  } catch {
    return [];
  }

  // Filter by :has-text()
  if (hasTextMatch) {
    const searchText = hasTextMatch[1].toLowerCase();
    elements = elements.filter(el => (el.textContent || '').toLowerCase().includes(searchText));
  }

  // Filter by :visible
  if (visibleFlag) {
    elements = elements.filter(isVisible);
  }

  return elements;
}

/** Try a list of selectors and return the first matching element. */
export function findFirst(
  selectors: string[],
  root: Element | Document = document,
  options: { visibleOnly?: boolean } = {}
): Element | null {
  for (const sel of selectors) {
    const matches = parseAndQuery(root, sel);
    for (const el of matches) {
      if (options.visibleOnly && !isVisible(el)) continue;
      return el;
    }
  }
  return null;
}

/** Return all matches for a selector. */
export function findAll(
  selector: string,
  root: Element | Document = document
): Element[] {
  return parseAndQuery(root, selector);
}

/** Find first element using selectors and click it. Returns true if clicked. */
export function clickFirst(
  selectors: string[],
  root: Element | Document = document
): boolean {
  const el = findFirst(selectors, root);
  if (!el || !(el instanceof HTMLElement)) return false;
  try {
    el.click();
    return true;
  } catch {
    return false;
  }
}

/** Wait for a selector to appear in the DOM, with polling. */
export function waitForSelector(
  selector: string,
  root: Element | Document = document,
  timeoutMs: number = 10000,
  intervalMs: number = 300
): Promise<Element | null> {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const matches = parseAndQuery(root, selector);
      if (matches.length > 0) return resolve(matches[0]);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/** Set value on an input element and dispatch events to trigger framework reactivity. */
export function fillInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // Use native setter to bypass React/Vue controlled components
  const nativeSetter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Select an option in a <select> element by value. */
export function selectOption(sel: HTMLSelectElement, value: string): void {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Build a unique CSS selector for an input element.
 */
function buildInputSelector(input: HTMLInputElement): string {
  const testId = input.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  const inputId = input.getAttribute('id');
  if (inputId) return `#${inputId}`;
  const inputName = input.getAttribute('name');
  if (inputName) return `input[name="${inputName}"]`;
  return `input[type="file"]`;
}

/**
 * Set files on an input[type="file"] using DataTransfer API with React compatibility.
 *
 * Uses a dual approach:
 * 1. Set files from ISOLATED world (content script) — works for vanilla JS, Vue, etc.
 * 2. Send a CustomEvent to the MAIN world content script (mainworld.ts) which
 *    finds React's __reactProps$/__reactFiber$ and calls onChange directly.
 *
 * The MAIN world approach is necessary because:
 * - Content scripts run in ISOLATED world and can't see React internals
 * - React 18 stores event handlers on __reactProps$<hash> on DOM elements
 * - Only code in the MAIN world can access these properties
 */
export function setInputFiles(input: HTMLInputElement, file: File): void {
  // Step 1: Set files from ISOLATED world (works for non-React frameworks)
  const dt = new DataTransfer();
  dt.items.add(file);

  const nativeFilesSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'files'
  )?.set;

  if (nativeFilesSetter) {
    nativeFilesSetter.call(input, dt.files);
  } else {
    input.files = dt.files;
  }

  // Invalidate React's value tracker from isolated world
  const tracker = (input as any)._valueTracker;
  if (tracker) tracker.setValue('');

  // Dispatch events from isolated world (may trigger non-React handlers)
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Step 2: Send file data to MAIN world content script via postMessage.
  // The MAIN world script (mainworld.ts) listens for 'smartapply-set-files'
  // and calls React's onChange directly. Using postMessage instead of
  // CustomEvent because postMessage properly serializes data across worlds.
  const selector = buildInputSelector(input);
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = (reader.result as string).split(',')[1] || '';
    window.postMessage({
      type: 'smartapply-set-files',
      selector,
      fileName: file.name,
      fileType: file.type,
      fileDataBase64: base64,
    }, '*');
  };
  reader.readAsDataURL(file);
}

/**
 * Check if a file upload was accepted by the UI.
 * @param expectedFilename - If provided, checks that the new filename matches (not just any file present)
 * @param timeoutMs - How long to poll for changes
 */
export async function verifyUploadAccepted(timeoutMs = 3000, expectedFilename?: string): Promise<boolean> {
  // Snapshot the current label BEFORE waiting, so we can detect a change.
  // The label is the source of truth — NOT input.files, which can be set on the DOM
  // without React actually processing the change (false positive when input is hidden).
  const labelBefore = document.querySelector(
    '[data-testid="resume-selection-file-resume-upload-radio-card-label"], [data-testid="resume-selection-file-resume-radio-card-label"]'
  )?.textContent?.trim() || '';

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Primary check: Indeed resume-selection label shows the new filename.
    // This is the only reliable indicator that React actually processed the upload.
    const resumeLabel = document.querySelector(
      '[data-testid="resume-selection-file-resume-upload-radio-card-label"], [data-testid="resume-selection-file-resume-radio-card-label"]'
    )?.textContent?.trim() || '';
    if (expectedFilename && resumeLabel.includes(expectedFilename.replace('.pdf', ''))) return true;
    if (!expectedFilename && resumeLabel !== labelBefore && resumeLabel.length > 0) return true;

    // Secondary check: "Carregado agora" / "Uploaded just now" text appeared
    // (indicates a fresh upload was processed by React)
    const bodyText = document.body?.innerText || '';
    if (expectedFilename && bodyText.includes(expectedFilename.replace('.pdf', ''))
        && (bodyText.includes('Carregado agora') || bodyText.includes('Uploaded just now') || bodyText.includes('just now'))) {
      return true;
    }

    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// ── Input Constraints & Validation ──

export interface InputConstraints {
  type: string;
  maxLength?: number;
  minLength?: number;
  min?: string;
  max?: string;
  pattern?: string;
  step?: string;
  placeholder?: string;
  required: boolean;
}

/** Extract HTML validation constraints from an input element. */
export function getInputConstraints(el: HTMLInputElement | HTMLTextAreaElement): InputConstraints {
  const constraints: InputConstraints = {
    type: (el as HTMLInputElement).type || 'text',
    required: el.required || el.getAttribute('aria-required') === 'true',
  };

  // Extract placeholder (useful for format hints like DD/MM/YYYY)
  const placeholder = el.getAttribute('placeholder')?.trim();
  if (placeholder) constraints.placeholder = placeholder;

  if (el instanceof HTMLInputElement) {
    if (el.maxLength > 0 && el.maxLength < 524288) constraints.maxLength = el.maxLength;
    if (el.minLength > 0) constraints.minLength = el.minLength;
    if (el.min) constraints.min = el.min;
    if (el.max) constraints.max = el.max;
    if (el.pattern) constraints.pattern = el.pattern;
    if (el.step && el.step !== 'any') constraints.step = el.step;
  }

  if (el instanceof HTMLTextAreaElement) {
    if (el.maxLength > 0 && el.maxLength < 524288) constraints.maxLength = el.maxLength;
    if (el.minLength > 0) constraints.minLength = el.minLength;
  }

  return constraints;
}

/** Validate an answer string against input constraints. */
export function validateAnswer(
  answer: string,
  constraints: InputConstraints
): { valid: boolean; error?: string } {
  if (!answer && constraints.required) {
    return { valid: false, error: 'Field is required' };
  }
  if (!answer) return { valid: true };

  if (constraints.type === 'number') {
    if (isNaN(Number(answer))) {
      return { valid: false, error: `Value must be a number, got "${answer}"` };
    }
    const num = Number(answer);
    if (constraints.min !== undefined && num < Number(constraints.min)) {
      return { valid: false, error: `Value must be >= ${constraints.min}` };
    }
    if (constraints.max !== undefined && num > Number(constraints.max)) {
      return { valid: false, error: `Value must be <= ${constraints.max}` };
    }
  }

  // Date validation: check format matches placeholder (e.g., DD/MM/YYYY)
  if (constraints.type === 'date' || constraints.placeholder?.match(/[DMY]{2,4}/i)) {
    const ph = constraints.placeholder || '';
    if (ph.includes('DD/MM/YYYY') || ph.includes('dd/mm/yyyy')) {
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(answer)) {
        return { valid: false, error: `Date must be in DD/MM/YYYY format, got "${answer}"` };
      }
    } else if (ph.includes('MM/DD/YYYY') || ph.includes('mm/dd/yyyy')) {
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(answer)) {
        return { valid: false, error: `Date must be in MM/DD/YYYY format, got "${answer}"` };
      }
    } else if (ph.includes('YYYY-MM-DD') || ph.includes('yyyy-mm-dd')) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(answer)) {
        return { valid: false, error: `Date must be in YYYY-MM-DD format, got "${answer}"` };
      }
    }
    if (constraints.min && answer < constraints.min) {
      return { valid: false, error: `Date must be >= ${constraints.min}` };
    }
    if (constraints.max && answer > constraints.max) {
      return { valid: false, error: `Date must be <= ${constraints.max}` };
    }
  }

  if (constraints.maxLength && answer.length > constraints.maxLength) {
    return { valid: false, error: `Max length is ${constraints.maxLength}, got ${answer.length}` };
  }

  if (constraints.minLength && answer.length < constraints.minLength) {
    return { valid: false, error: `Min length is ${constraints.minLength}, got ${answer.length}` };
  }

  if (constraints.pattern) {
    try {
      if (!new RegExp(constraints.pattern).test(answer)) {
        return { valid: false, error: `Value doesn't match pattern: ${constraints.pattern}` };
      }
    } catch { /* invalid regex, skip */ }
  }

  return { valid: true };
}

/** Detect validation errors on an element after filling it. */
export function detectValidationError(el: HTMLInputElement | HTMLTextAreaElement): string | null {
  // Native browser validation
  if (el.validationMessage) return el.validationMessage;

  // Check aria-invalid
  if (el.getAttribute('aria-invalid') === 'true') {
    // Look for associated error message
    const errId = el.getAttribute('aria-errormessage') || el.getAttribute('aria-describedby');
    if (errId) {
      const errEl = document.getElementById(errId);
      if (errEl?.textContent?.trim()) return errEl.textContent.trim();
    }
  }

  // Look for nearby error elements
  const parent = el.closest('div, fieldset, li');
  if (parent) {
    const errorEl = parent.querySelector('.error, [role="alert"], .field-error, .input-error, [class*="error" i]');
    if (errorEl && isVisible(errorEl)) {
      const text = errorEl.textContent?.trim();
      if (text) return text;
    }
  }

  return null;
}

/** Get label text for an input element. */
export function getLabelForInput(inp: Element): string {
  const id = inp.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) {
      const text = label.textContent?.trim();
      if (text) return text;
    }
  }

  const aria = inp.getAttribute('aria-label')?.trim();
  if (aria) return aria;

  const placeholder = inp.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder;

  // Try parent element for label text
  const parent = inp.closest('div, fieldset, li');
  if (parent) {
    const labelEl = parent.querySelector('label, legend, span');
    if (labelEl) {
      const text = labelEl.textContent?.trim();
      if (text) return text;
    }
  }

  return '';
}
