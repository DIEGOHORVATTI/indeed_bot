# Resume Upload Fix - SmartApply Indeed

## Status: WORKING (2026-02-28)

## Root Cause Found
The `data-testid` values on Indeed SmartApply changed. The "upload" variant was added:

| Component | OLD testid | NEW testid |
|-----------|-----------|------------|
| Radio card | `resume-selection-file-resume-radio-card` | `resume-selection-file-resume-upload-radio-card` |
| File input | `resume-selection-file-resume-radio-card-file-input` | `resume-selection-file-resume-upload-radio-card-file-input` |
| Radio input | `resume-selection-file-resume-radio-card-input` | `resume-selection-file-resume-upload-radio-card-input` |
| Label | `resume-selection-file-resume-radio-card-label` | `resume-selection-file-resume-upload-radio-card-label` |
| Button | `resume-selection-file-resume-radio-card-button` | `resume-selection-file-resume-upload-radio-card-button` |
| Error | (new) | `resume-selection-file-resume-upload-radio-card-error` |
| Error dismiss | (new) | `resume-selection-file-resume-upload-radio-card-error-dismiss-button` |

**Note**: Both patterns may coexist (new user vs returning user). Selectors now use CSS multi-selector: `[data-testid="...upload..."], [data-testid="...old..."]`

## Working Upload Method (verified via CDP)

The **direct React onChange** approach works:

```js
var input = document.querySelector('[data-testid="resume-selection-file-resume-upload-radio-card-file-input"]');
var pk = Object.keys(input).find(k => k.startsWith('__reactProps'));

var dt = new DataTransfer();
var file = new File([pdfData], 'cv.pdf', {type: 'application/pdf'});
dt.items.add(file);

// Set files via native setter
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(input, dt.files);
if (input._valueTracker) input._valueTracker.setValue('');

// Call React onChange directly
input[pk].onChange({
  target: input, currentTarget: input, type: 'change', bubbles: true,
  preventDefault(){}, stopPropagation(){},
  isPropagationStopped() { return false; },
  isDefaultPrevented() { return false; },
  nativeEvent: new Event('change', {bubbles: true}),
  persist(){}
});
```

**Key requirements:**
- File must be >= 1KB (Indeed validates minimum size)
- `type: 'application/pdf'` must match the accept attribute
- Must run in **MAIN world** to access `__reactProps$<hash>`
- React hash suffix is dynamic (e.g., `$hzinvxfxnvh`) — always discover at runtime

## React Fiber Tree Structure (depth from input)
- **depth 0**: `<input>` — has `onChange` (this is what we call)
- **depth 7**: RadioCard component — has `onChange`
- **depth 8**: FileUploadRadioCard — has `onChange`, `onSelect`, `onError`, `onDismissError`
- **depth 12**: FileResumeComponent — has `onChange`, `onSelectFile`, `onDownloadFile`, `onUploadError`
- **depth 19**: `<form>` — has `onSubmit`

## All data-testids on resume-selection page (Feb 2026)
```
logo-aurora
ia-JobHeader-headerContainer
ExitLinkWithModalComponent-exitButton
root-route
resume-selection-form
resume-selection-radio-card-group
resume-selection-build-resume-radio-card
resume-selection-build-resume-radio-card-input
document-icon-create
resume-selection-build-resume-radio-card-label
resume-selection-build-resume-radio-card-helper-text
resume-selection-build-resume-radio-card-indicator
resume-selection-build-resume-radio-card-body
resume-selection-build-resume-radio-card-build-button
resume-selection-file-resume-upload-radio-card
resume-selection-file-resume-upload-radio-card-input
resume-selection-file-resume-upload-radio-card-icon-upload
resume-selection-file-resume-upload-radio-card-label
resume-selection-file-resume-upload-radio-card-helper-text
resume-selection-file-resume-upload-radio-card-indicator
resume-selection-file-resume-upload-radio-card-body
resume-selection-file-resume-upload-radio-card-button
resume-selection-file-resume-upload-radio-card-file-input
resume-selection-file-resume-upload-radio-card-error
resume-selection-file-resume-upload-radio-card-error-dismiss-button
resume-selection-footer
hp-continue-button-0
hp-continue-button-1
continue-button
ia-MidApplyFeedback-text
midApplyFeedbackButton
pdfjs-script
```

## Files Changed
- `extension/src/content/smartapply.ts` — Updated all `data-testid` selectors to use both old and new patterns
- `extension/src/utils/i18n.ts` — Added new `data-testid` patterns to UPLOAD_BUTTON_SELECTORS and RESUME_CARD_SELECTORS
- `extension/src/utils/selectors.ts` — Updated `verifyUploadAccepted()` label selectors

## Testing Steps
1. Start Chrome with remote debugging: `open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug-profile`
2. Load extension from `extension/dist/`
3. Navigate to Indeed, find a job with "Candidatura simplificada"
4. Click "Candidatar-se" — SmartApply popup opens
5. Verify the file input appears and upload works
6. Check console for `[smartapply-main]` logs confirming MAIN world script loaded

## CDP Testing (without extension)
```bash
# Navigate to SmartApply tab
python3 /tmp/cdp.py navigate_and_wait "https://smartapply.indeed.com/..."
# NOTE: SmartApply requires sessionStorage set by Indeed, can't navigate directly.
# Must initiate from a real job application flow.
```
