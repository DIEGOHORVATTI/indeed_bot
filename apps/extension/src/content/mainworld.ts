/**
 * MAIN world content script for smartapply.indeed.com.
 * Runs in the page's JavaScript context (not isolated) so it can access
 * React's internal __reactProps$ / __reactFiber$ on DOM elements.
 *
 * Communication: Uses window.postMessage (serializable) instead of CustomEvent
 * detail (which may not cross world boundaries reliably in Chrome).
 *
 * Listens for messages from the ISOLATED world content script to:
 * - Set files on input[type="file"] and trigger React's onChange
 */

interface SetFilesMessage {
  type: 'smartapply-set-files';
  selector: string;
  fileName: string;
  fileType: string;
  fileDataBase64: string;
}

interface SelectOptionMessage {
  type: 'smartapply-select-option';
  selector: string;
  value: string;
}

/**
 * Helper: create a minimal synthetic React event object.
 */
function makeSyntheticEvent(target: Element, eventType: string) {
  return {
    target,
    currentTarget: target,
    type: eventType,
    bubbles: true,
    preventDefault() {},
    stopPropagation() {},
    isPropagationStopped() {
      return false;
    },
    isDefaultPrevented() {
      return false;
    },
    nativeEvent: new Event(eventType, { bubbles: true }),
    persist() {}
  };
}

/**
 * Helper: find React onChange handler via __reactProps$ or fiber tree and call it.
 * Returns true if a React handler was found and called.
 */
function triggerReactChange(
  element: Element,
  eventType: string = 'change'
): { found: boolean; method?: string; depth?: number } {
  // Strategy 1: __reactProps$ / __reactEventHandlers$
  const propsKey = Object.keys(element).find(
    (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
  );
  if (propsKey && (element as any)[propsKey]?.onChange) {
    console.log('[smartapply-main] calling onChange via', propsKey);
    (element as any)[propsKey].onChange(makeSyntheticEvent(element, eventType));
    return { found: true, method: 'reactProps' };
  }

  // Strategy 2: walk React fiber tree
  const fiberKey = Object.keys(element).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  );
  if (fiberKey) {
    let fiber = (element as any)[fiberKey];
    let depth = 0;
    while (fiber && depth < 20) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props?.onChange) {
        console.log('[smartapply-main] calling onChange via fiber at depth', depth);
        props.onChange(makeSyntheticEvent(element, eventType));
        return { found: true, method: 'reactFiber', depth };
      }
      fiber = fiber.return;
      depth++;
    }
  }

  return { found: false };
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only handle our messages
  if (event.source !== window) return;
  if (!event.data) return;

  // ── Handle select option changes ──
  if (event.data.type === 'smartapply-select-option') {
    const { selector, value } = event.data as SelectOptionMessage;
    try {
      const select = document.querySelector<HTMLSelectElement>(selector);
      if (!select) {
        console.warn('[smartapply-main] select not found:', selector);
        window.postMessage(
          { type: 'smartapply-select-option-result', success: false, error: 'select not found' },
          '*'
        );
        return;
      }

      // Set value using native setter
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(select, value);
      } else {
        select.value = value;
      }

      // Invalidate React's value tracker
      const tracker = (select as any)._valueTracker;
      if (tracker) tracker.setValue('');

      console.log('[smartapply-main] select value set to:', value, 'actual:', select.value);

      // Try React onChange
      const result = triggerReactChange(select, 'change');
      if (result.found) {
        window.postMessage(
          { type: 'smartapply-select-option-result', success: true, ...result },
          '*'
        );
        return;
      }

      // Fallback: dispatch native events
      console.log('[smartapply-main] no React handler for select, dispatching native events');
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));

      window.postMessage(
        { type: 'smartapply-select-option-result', success: true, method: 'nativeEvents' },
        '*'
      );
    } catch (err) {
      console.error('[smartapply-main] select error:', err);
      window.postMessage(
        { type: 'smartapply-select-option-result', success: false, error: String(err) },
        '*'
      );
    }
    return;
  }

  // ── Handle file input changes ──
  if (event.data.type !== 'smartapply-set-files') return;

  const { selector, fileName, fileType, fileDataBase64 } = event.data as SetFilesMessage;

  try {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) {
      console.warn('[smartapply-main] input not found:', selector);
      window.postMessage(
        { type: 'smartapply-set-files-result', success: false, error: 'input not found' },
        '*'
      );
      return;
    }

    // Decode base64 → File object in MAIN world
    console.log('[smartapply-main] base64 length:', fileDataBase64.length);
    const binaryStr = atob(fileDataBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const file = new File([bytes], fileName, { type: fileType });
    console.log('[smartapply-main] decoded file size:', file.size, 'bytes');

    // Set files via DataTransfer in MAIN world
    const dt = new DataTransfer();
    dt.items.add(file);

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, dt.files);
    } else {
      input.files = dt.files;
    }

    // Invalidate React's value tracker
    const tracker = (input as any)._valueTracker;
    if (tracker) tracker.setValue('');

    console.log(
      '[smartapply-main] files set on',
      selector,
      ':',
      input.files?.length,
      input.files?.[0]?.name
    );

    // Try React onChange via shared helper
    const result = triggerReactChange(input, 'change');
    if (result.found) {
      window.postMessage({ type: 'smartapply-set-files-result', success: true, ...result }, '*');
      return;
    }

    // Fallback: Dispatch native events from MAIN world
    console.log('[smartapply-main] no React handler found, dispatching native events');
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Also try DragEvent for drag-and-drop based uploaders
    try {
      const dropDt = new DataTransfer();
      dropDt.items.add(file);
      input.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dropDt }));
    } catch {
      /* ignore */
    }

    window.postMessage(
      { type: 'smartapply-set-files-result', success: true, method: 'nativeEvents' },
      '*'
    );
  } catch (err) {
    console.error('[smartapply-main] error:', err);
    window.postMessage(
      { type: 'smartapply-set-files-result', success: false, error: String(err) },
      '*'
    );
  }
});

console.log('[smartapply-main] MAIN world helper loaded');
