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

/** Set files on an input[type="file"] using DataTransfer API. */
export function setInputFiles(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
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
