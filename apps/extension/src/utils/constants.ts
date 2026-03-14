/**
 * Centralized constants for the Indeed Auto Apply extension.
 * Selectors, keywords, magic numbers, and URL patterns.
 */

// ── Data Test IDs ──

export const TESTIDS = {
  // Resume
  resumeFileInput:
    '[data-testid="resume-selection-file-resume-upload-radio-card-file-input"], ' +
    '[data-testid="resume-selection-file-resume-radio-card-file-input"]',
  resumeRadioCard:
    '[data-testid="resume-selection-file-resume-upload-radio-card-input"], ' +
    '[data-testid="resume-selection-file-resume-radio-card-input"]',
  resumeSelectFileBtn:
    '[data-testid="resume-selection-file-resume-upload-radio-card-button"], ' +
    '[data-testid="resume-selection-file-resume-radio-card-button"]',
  resumeOptionsMenu: '[data-testid="ResumeOptionsMenu"]',
  resumeOptionsUpload: '[data-testid="ResumeOptionsMenu-upload"]',

  // Privacy
  privacyForm: '[data-testid="privacy-settings-form"]',
  privacyOptin: '[data-testid="privacy-settings-optin-input"]',
  continueButton: '[data-testid="continue-button"]',

  // Cover letter
  coverLetterRadio:
    '[data-testid="cover-letter-radio-card-input"], ' +
    'input[name="cover-letter"][id*="cover-letter-radio-card"]',
  noCoverLetterRadio:
    '[data-testid="no-cover-letter-radio-card-input"], ' +
    'input[name="cover-letter"][id*="no-cover-letter"]',

  // Job listing
  jobCard: 'div[data-testid="slider_item"]',
  indeedApply: '[data-testid="indeedApply"]',
  jobTitleLink: 'a.jcs-JobTitle',

  // Questionnaire
  questionContainer: '[data-testid*="input-q_"], .ia-Questions-item, fieldset',
  questionLabel:
    '[data-testid*="-label"] [data-testid="safe-markup"], legend, [class*="label"]',
  questionParent: 'fieldset, [class*="Questions-item"], [id^="q_"]'
};

// ── Form Selectors ──

export const FORM = {
  textInputs:
    'input[type="text"], input[type="email"], input[type="tel"], ' +
    'input[type="number"], input[type="date"], textarea',
  radioInputs: 'input[type="radio"]',
  checkboxInputs: 'input[type="checkbox"]',
  fileInputs: 'input[type="file"]',
  allClickables: 'button, a, label, [role="button"]',
  nativeButtons: 'button, [role="button"], a.ia-continueButton',
  resumePageIndicators:
    '[data-testid*="resume-selection"], [class*="resume-selection"], [id*="resume-selection"]',
  coverLetterInputs:
    '[data-testid="CoverLetterInput"] input[type="file"], ' +
    'input[accept*="pdf"][name*="cover"], ' +
    '[data-testid*="coverLetter" i] input[type="file"], ' +
    '[data-testid*="cover-letter" i] input[type="file"]'
};

// ── Cover Letter Detection ──

export const COVER_LETTER_DETECTION_SELECTORS = [
  '[data-testid="CoverLetterInput"]',
  '[data-testid*="coverLetter" i]',
  '[data-testid*="cover-letter" i]',
  '[class*="CoverLetter"]',
  '[class*="cover-letter"]',
  'input[type="file"][name*="cover" i]',
  'input[type="file"][aria-label*="cover" i]',
  'input[type="file"][aria-label*="carta" i]'
];

export const COVER_LETTER_KEYWORDS = [
  'cover letter',
  'carta de apresentação',
  'carta de apresentacao',
  'lettre de motivation',
  'anschreiben',
  'carta de presentación'
];

// ── Job Scraping Selectors ──

export const JOB_SCRAPING = {
  title: [
    'h1.jobsearch-JobInfoHeader-title',
    'h1[data-testid="jobsearch-JobInfoHeader-title"]',
    'h1[class*="JobInfoHeader"]',
    'h2.jobTitle'
  ],
  company: [
    '[data-testid="inlineHeader-companyName"]',
    '[data-testid="company-name"]',
    'div[data-company-name] a',
    'span.css-1cjkto6'
  ],
  description: [
    '#jobDescriptionText',
    'div.jobsearch-JobComponent-description',
    '[data-testid="jobDescriptionText"]'
  ],
  jobCount: [
    '.jobsearch-JobCountAndSortPane-jobCount',
    '[data-testid="jobCount"]',
    '.jobsearch-ResultsList-header span'
  ],
  pagination: 'nav[role="navigation"] a[data-testid^="pagination-page-"]',
  paginationNext: 'pagination-page-next'
};

// ── URL Patterns ──

export const URL_PATTERNS = {
  reviewModule: 'review-module',
  additionalDocuments: 'additional-documents',
  resumeSelection: 'resume-selection',
  indeedDomain: 'indeed.com',
  brIndeed: 'br.indeed',
  submission: ['confirmation', 'submitted', 'success', 'post-apply']
};

// ── Keywords ──

export const CONSENT_KEYWORDS = [
  'agree',
  'aceito',
  'concordo',
  'consent',
  'autorizo',
  'allow',
  'permitir',
  'terms',
  'termos',
  'privacy',
  'notification',
  'notificaç',
  'comunicaç'
];

export const ADDITIONAL_DOCS = {
  addKeywords: ['adicionar', 'add'],
  sectionKeywords: [
    'documentos de apoio',
    'supporting documents',
    'additional documents',
    'documentos adicionais',
    'cover letter',
    'carta de apresentação'
  ]
};

// ── Timing (ms) ──

export const TIMING = {
  tabLoadTimeout: 15000,
  settleMs: 3000,
  debounceMutationMs: 800,
  domChangeThreshold: 500,
  fillRetryDelay: 3000,
  pageLoadDelay: 2000,
  workerStaggerDelay: 500
};

// ── Limits ──

export const LIMITS = {
  maxFillDepth: 10,
  maxRetries: 2,
  jobsPerPage: 10,
  emptyPageStreak: 3,
  simplifiedDomMaxLength: 3000
};

// ── Floating Button ──

export const FLOATING_BUTTON = {
  containerId: 'iaa-floating-container',
  zIndex: '2147483647',
  padding: '16px',
  sizes: { small: '32px', medium: '42px', large: '54px' } as Record<string, string>,
  fonts: { small: '12px', medium: '14px', large: '16px' } as Record<string, string>,
  nextBtn: { bg: '#16213e', hover: '#1a2a4a', label: 'Next ▶' },
  skipBtn: { bg: '#6c757d', hover: '#5a6268', label: 'Skip ✕' }
};
