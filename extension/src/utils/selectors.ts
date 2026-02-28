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
  // Snapshot the current label BEFORE waiting, so we can detect a change
  const labelBefore = document.querySelector(
    '[data-testid="resume-selection-file-resume-upload-radio-card-label"], [data-testid="resume-selection-file-resume-radio-card-label"]'
  )?.textContent?.trim() || '';

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Check 1: File input has files set with the expected filename
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    for (const fi of inputs) {
      if (fi.files && fi.files.length > 0) {
        if (!expectedFilename) return true;
        if (fi.files[0].name === expectedFilename) return true;
      }
    }
    // Check 2: Indeed resume-selection label CHANGED to show the new filename
    const resumeLabel = document.querySelector(
      '[data-testid="resume-selection-file-resume-upload-radio-card-label"], [data-testid="resume-selection-file-resume-radio-card-label"]'
    )?.textContent?.trim() || '';
    if (expectedFilename && resumeLabel.includes(expectedFilename.replace('.pdf', ''))) return true;
    if (!expectedFilename && resumeLabel !== labelBefore && resumeLabel.length > 0) return true;

    await new Promise(r => setTimeout(r, 300));
  }
  return false;
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
