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

window.addEventListener('message', (event: MessageEvent) => {
  // Only handle our messages
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'smartapply-set-files') return;

  const { selector, fileName, fileType, fileDataBase64 } = event.data as SetFilesMessage;

  try {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) {
      console.warn('[smartapply-main] input not found:', selector);
      window.postMessage({ type: 'smartapply-set-files-result', success: false, error: 'input not found' }, '*');
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

    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'files'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, dt.files);
    } else {
      input.files = dt.files;
    }

    // Invalidate React's value tracker
    const tracker = (input as any)._valueTracker;
    if (tracker) tracker.setValue('');

    console.log('[smartapply-main] files set on', selector, ':', input.files?.length, input.files?.[0]?.name);

    // Strategy 1: Find React props directly on element (__reactProps$<hash>)
    const propsKey = Object.keys(input).find(
      k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
    );
    if (propsKey && (input as any)[propsKey]?.onChange) {
      console.log('[smartapply-main] calling onChange via', propsKey);
      (input as any)[propsKey].onChange({
        target: input,
        currentTarget: input,
        type: 'change',
        bubbles: true,
        preventDefault() {},
        stopPropagation() {},
        isPropagationStopped() { return false; },
        isDefaultPrevented() { return false; },
        nativeEvent: new Event('change', { bubbles: true }),
        persist() {},
      });
      window.postMessage({ type: 'smartapply-set-files-result', success: true, method: 'reactProps' }, '*');
      return;
    }

    // Strategy 2: Walk React fiber tree to find onChange
    const fiberKey = Object.keys(input).find(
      k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
    );
    if (fiberKey) {
      let fiber = (input as any)[fiberKey];
      let depth = 0;
      while (fiber && depth < 20) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props?.onChange) {
          console.log('[smartapply-main] calling onChange via fiber at depth', depth);
          props.onChange({
            target: input,
            currentTarget: input,
            type: 'change',
            bubbles: true,
            preventDefault() {},
            stopPropagation() {},
            isPropagationStopped() { return false; },
            isDefaultPrevented() { return false; },
            nativeEvent: new Event('change', { bubbles: true }),
            persist() {},
          });
          window.postMessage({ type: 'smartapply-set-files-result', success: true, method: 'reactFiber', depth }, '*');
          return;
        }
        fiber = fiber.return;
        depth++;
      }
    }

    // Strategy 3: Dispatch native events from MAIN world
    console.log('[smartapply-main] no React handler found, dispatching native events');
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Also try DragEvent for drag-and-drop based uploaders
    try {
      const dropDt = new DataTransfer();
      dropDt.items.add(file);
      input.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dropDt }));
    } catch { /* ignore */ }

    window.postMessage({ type: 'smartapply-set-files-result', success: true, method: 'nativeEvents' }, '*');
  } catch (err) {
    console.error('[smartapply-main] error:', err);
    window.postMessage({ type: 'smartapply-set-files-result', success: false, error: String(err) }, '*');
  }
});

console.log('[smartapply-main] MAIN world helper loaded');
