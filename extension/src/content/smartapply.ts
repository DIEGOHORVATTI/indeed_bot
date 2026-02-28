/**
 * Content script for smartapply.indeed.com (wizard iframe).
 * Handles: form filling, resume upload, wizard navigation, questionnaire.
 */

import { Message, CacheEntry } from '../types';
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

// ── Default Answer Logic ──

const DEFAULT_ANSWERS: [string[], string][] = [
  ['pcd', 'deficiência', 'deficiencia', 'disability', 'handicap', 'pessoa com deficiência', 'portador', 'necessidade especial', 'special need'].map(k => [k]).flat().length > 0
    ? [['pcd', 'deficiência', 'deficiencia', 'disability', 'handicap', 'pessoa com deficiência', 'portador', 'necessidade especial', 'special need'], 'Não']
    : [[], ''],
];

// Flatten to proper structure
const PCD_KEYWORDS = [
  'pcd', 'deficiência', 'deficiencia', 'disability', 'handicap',
  'pessoa com deficiência', 'portador', 'necessidade especial', 'special need',
];

const PJ_KEYWORDS = [
  'regime', 'contratação', 'modelo de contratação', 'tipo de contrato',
  'clt ou pj', 'pj ou clt',
];

const SALARY_KEYWORDS = [
  'pretensão salarial', 'salário', 'remuneração', 'salary',
  'compensation', 'expectativa salarial',
];

const LEVEL_SALARY: [string[], string][] = [
  [['junior', 'júnior', 'jr', 'trainee', 'estágio', 'estagiário', 'intern'], '3000'],
  [['pleno', 'mid', 'middle', 'intermediário', 'mid-level', 'mid level'], '9000'],
  [['sênior', 'senior', 'sr', 'lead', 'principal', 'staff', 'especialista'], '14000'],
];

const DEFAULT_SALARY = '9000';

// Fields that can be answered from job context
const JOB_TITLE_KEYWORDS = [
  'cargo pretendido', 'cargo desejado', 'vaga pretendida', 'posição desejada',
  'posição pretendida', 'função pretendida', 'função desejada',
  'desired position', 'desired job', 'job title', 'position applied',
];

const NAME_KEYWORDS = [
  'nome completo', 'nome', 'full name', 'name', 'seu nome',
];

const EMAIL_KEYWORDS = [
  'e-mail', 'email', 'endereço de email', 'email address',
];

const PHONE_KEYWORDS = [
  'telefone', 'celular', 'phone', 'mobile', 'whatsapp', 'número de telefone',
];

const CITY_KEYWORDS = [
  'cidade', 'city', 'localização', 'location', 'onde mora', 'where',
];

const LINKEDIN_KEYWORDS = [
  'linkedin', 'perfil linkedin', 'linkedin profile', 'url linkedin',
];

const GITHUB_KEYWORDS = [
  'github', 'perfil github', 'github profile', 'url github', 'repositório',
];

const PORTFOLIO_KEYWORDS = [
  'portfolio', 'portfólio', 'website', 'site pessoal', 'personal website',
];

let currentJobTitle = '';
let currentProfile: { name?: string; email?: string; phone?: string; location?: string; linkedin?: string; github?: string; portfolio?: string } = {};

function detectSalary(jobTitle: string): string {
  const lower = jobTitle.toLowerCase();
  for (const [keywords, salary] of LEVEL_SALARY) {
    if (keywords.some(kw => lower.includes(kw))) return salary;
  }
  return DEFAULT_SALARY;
}

function matchDefaultAnswer(label: string, options?: string[]): string | null {
  const lower = label.toLowerCase();

  // PCD / Disability → "Não"
  if (PCD_KEYWORDS.some(kw => lower.includes(kw))) {
    if (options) {
      const noKeywords = ['não', 'nao', 'no', 'none', 'nenhuma', 'nenhum'];
      for (const opt of options) {
        if (noKeywords.some(nk => opt.toLowerCase().includes(nk))) return opt;
      }
    }
    return 'Não';
  }

  // Employment model → PJ
  if (PJ_KEYWORDS.some(kw => lower.includes(kw))) {
    if (options) {
      for (const opt of options) {
        if (opt.toLowerCase().includes('pj')) return opt;
      }
    }
    return 'PJ';
  }

  // Salary → based on job level
  if (SALARY_KEYWORDS.some(kw => lower.includes(kw))) {
    return detectSalary(currentJobTitle);
  }

  // Job title / desired position → use the current job title
  if (JOB_TITLE_KEYWORDS.some(kw => lower.includes(kw)) && currentJobTitle) {
    return currentJobTitle;
  }

  // Profile-based fields
  if (NAME_KEYWORDS.some(kw => lower.includes(kw)) && currentProfile.name) {
    return currentProfile.name;
  }
  if (EMAIL_KEYWORDS.some(kw => lower === kw || lower.includes(kw)) && currentProfile.email) {
    return currentProfile.email;
  }
  if (PHONE_KEYWORDS.some(kw => lower.includes(kw)) && currentProfile.phone) {
    return currentProfile.phone;
  }
  if (CITY_KEYWORDS.some(kw => lower.includes(kw)) && currentProfile.location) {
    return currentProfile.location;
  }
  if (LINKEDIN_KEYWORDS.some(kw => lower.includes(kw)) && currentProfile.linkedin) {
    return currentProfile.linkedin;
  }
  if (GITHUB_KEYWORDS.some(kw => lower.includes(kw)) && currentProfile.github) {
    return currentProfile.github;
  }
  if (PORTFOLIO_KEYWORDS.some(kw => lower.includes(kw)) && currentProfile.portfolio) {
    return currentProfile.portfolio;
  }

  return null;
}

// ── Ask Claude (via service worker) ──

async function askClaude(question: string, options?: string[]): Promise<string | null> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { type: 'ASK_CLAUDE', payload: { question, options, jobTitle: currentJobTitle } },
      (response) => {
        resolve(response?.payload?.answer || null);
      }
    );
  });
}

// ── Answer Cache (via service worker) ──

async function cacheLookup(label: string, inputType: string, options?: string[]): Promise<string | null> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { type: 'ASK_CLAUDE', payload: { cacheOnly: true, label, inputType, options } },
      (response) => {
        resolve(response?.payload?.answer || null);
      }
    );
  });
}

async function cacheStore(label: string, inputType: string, answer: string, options?: string[]): Promise<void> {
  chrome.runtime.sendMessage({
    type: 'ASK_CLAUDE',
    payload: { storeCache: true, label, inputType, answer, options },
  });
}

// ── Resume Upload ──

function log(msg: string): void {
  console.log(`[smartapply] ${msg}`);
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

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

  // Strategy 2: Click "Resume options" or "Change" button → then "Upload" button → file input
  const optionsBtn = findFirst(RESUME_OPTIONS_SELECTORS);
  if (optionsBtn) {
    log(`Strategy 2: clicking options button: "${(optionsBtn as HTMLElement).textContent?.trim()}"`);
    (optionsBtn as HTMLElement).click();
    await waitMs(800);

    const uploadBtn = findFirst(UPLOAD_BUTTON_SELECTORS);
    if (uploadBtn) {
      log(`Strategy 2: clicking upload button: "${(uploadBtn as HTMLElement).textContent?.trim()}"`);
      (uploadBtn as HTMLElement).click();
      const fi = await waitForFileInput(3000);
      if (fi) {
        log('Strategy 2: file input found after upload click');
        setInputFiles(fi, file);
        return;
      }
    }
  }

  // Strategy 3: Look for upload button directly (no options menu)
  const directUploadBtn = findFirst(UPLOAD_BUTTON_SELECTORS);
  if (directUploadBtn) {
    log(`Strategy 3: clicking direct upload button: "${(directUploadBtn as HTMLElement).textContent?.trim()}"`);
    (directUploadBtn as HTMLElement).click();
    const fi = await waitForFileInput(3000);
    if (fi) {
      log('Strategy 3: file input found');
      setInputFiles(fi, file);
      return;
    }
  }

  // Strategy 4: Scan ALL buttons/links for upload-related text
  const allClickables = [...document.querySelectorAll('button, a, [role="button"]')];
  const uploadKeywords = ['upload', 'carregar', 'enviar arquivo', 'escolher arquivo', 'choose file', 'select file', 'alterar currículo', 'change resume'];
  for (const el of allClickables) {
    if (!isVisible(el as Element)) continue;
    const text = (el.textContent || '').toLowerCase().trim();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (uploadKeywords.some(kw => text.includes(kw) || ariaLabel.includes(kw))) {
      log(`Strategy 4: clicking upload-like element: "${text || ariaLabel}"`);
      (el as HTMLElement).click();
      const fi = await waitForFileInput(3000);
      if (fi) {
        log('Strategy 4: file input found');
        setInputFiles(fi, file);
        return;
      }
    }
  }

  // Strategy 5: API-based upload (same-origin fetch from smartapply)
  log('Strategy 5: trying API upload');
  const apiResult = await uploadResumeViaApi(file);
  if (apiResult) {
    log('Strategy 5: API upload succeeded');
    return;
  }

  // Strategy 6: Select existing resume card as last resort
  const card = findFirst(RESUME_CARD_SELECTORS);
  if (card) {
    log(`Strategy 6: clicking existing resume card: "${(card as HTMLElement).textContent?.trim().substring(0, 40)}"`);
    (card as HTMLElement).click();
    return;
  }

  log('WARNING: No resume upload strategy worked');
}

async function uploadResumeViaApi(file: File): Promise<boolean> {
  // Extract CSRF token from cookies
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
      headers: {
        'ia-upload-category': 'resume',
        'x-xsrf-token': csrfToken,
      },
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

  // Try direct cover letter input
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

// ── Questionnaire Handling ──

async function handleQuestionnaire(): Promise<{ needsUserInput: boolean; fieldLabel?: string }> {
  // Text inputs
  const textInputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="number"]'
  );

  for (const inp of textInputs) {
    if (!isVisible(inp)) continue;
    if (inp.value.trim()) continue;

    const label = getLabelForInput(inp);
    if (!label) continue;

    const inputType = inp.type || 'text';

    // Default answers
    const defaultAnswer = matchDefaultAnswer(label);
    if (defaultAnswer) {
      fillInput(inp, defaultAnswer);
      continue;
    }

    // Cache lookup
    const cached = await cacheLookup(label, inputType);
    if (cached) {
      fillInput(inp, cached);
      continue;
    }

    // Claude
    const answer = await askClaude(label);
    if (answer) {
      fillInput(inp, answer);
      await cacheStore(label, inputType, answer);
    } else {
      // Skip non-required fields instead of blocking
      const isRequired = inp.required || inp.getAttribute('aria-required') === 'true' || label.includes('*');
      if (isRequired) {
        return { needsUserInput: true, fieldLabel: label };
      }
      // Non-required: leave blank and continue
    }
  }

  // Textareas
  const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
  for (const ta of textareas) {
    if (!isVisible(ta)) continue;
    if (ta.value.trim()) continue;

    const label = getLabelForInput(ta);
    if (!label) continue;

    const cached = await cacheLookup(label, 'textarea');
    if (cached) {
      fillInput(ta, cached);
      continue;
    }

    const answer = await askClaude(label);
    if (answer) {
      fillInput(ta, answer);
      await cacheStore(label, 'textarea', answer);
    } else {
      const isRequired = ta.required || ta.getAttribute('aria-required') === 'true' || label.includes('*');
      if (isRequired) {
        return { needsUserInput: true, fieldLabel: label };
      }
    }
  }

  // Selects
  const selects = document.querySelectorAll<HTMLSelectElement>('select');
  for (const sel of selects) {
    if (!isVisible(sel)) continue;
    if (sel.value) continue;

    const label = getLabelForInput(sel);
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

    if (!label) continue;

    // Default answers
    const defaultAnswer = matchDefaultAnswer(label, optionTexts);
    if (defaultAnswer) {
      const idx = optionTexts.indexOf(defaultAnswer);
      if (idx >= 0) selectOption(sel, optionValues[idx]);
      continue;
    }

    // Cache
    const cached = await cacheLookup(label, 'select', optionTexts);
    if (cached) {
      const idx = optionTexts.indexOf(cached);
      if (idx >= 0) selectOption(sel, optionValues[idx]);
      continue;
    }

    // Claude
    if (optionTexts.length > 0) {
      const answer = await askClaude(label, optionTexts);
      if (answer) {
        const idx = optionTexts.indexOf(answer);
        if (idx >= 0) {
          selectOption(sel, optionValues[idx]);
          await cacheStore(label, 'select', answer, optionTexts);
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
    // Skip if already selected
    const checked = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
    if (checked) continue;

    // Get labels
    const optionLabels = groupRadios.map(r => getLabelForInput(r));

    // Group label
    let groupLabel = '';
    try {
      const parent = groupRadios[0].closest('fieldset, div');
      const legendOrLabel = parent?.querySelector('legend, label, span');
      groupLabel = legendOrLabel?.textContent?.trim() || name;
    } catch {
      groupLabel = name;
    }

    // Default answers
    const defaultAnswer = matchDefaultAnswer(groupLabel, optionLabels);
    if (defaultAnswer) {
      const idx = optionLabels.indexOf(defaultAnswer);
      if (idx >= 0) groupRadios[idx].click();
      continue;
    }

    // Cache
    const cached = await cacheLookup(groupLabel, 'radio', optionLabels);
    if (cached) {
      const idx = optionLabels.indexOf(cached);
      if (idx >= 0) groupRadios[idx].click();
      continue;
    }

    // Claude
    if (optionLabels.length > 0) {
      const answer = await askClaude(groupLabel, optionLabels);
      if (answer) {
        const idx = optionLabels.indexOf(answer);
        if (idx >= 0) {
          groupRadios[idx].click();
          await cacheStore(groupLabel, 'radio', answer, optionLabels);
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

// ── Wizard Navigation ──

function clickContinueOrSubmit(): 'submitted' | 'continued' | 'none' {
  // Try submit buttons first
  if (clickFirst(SUBMIT_SELECTORS)) return 'submitted';

  // Try continue buttons
  if (clickFirst(CONTINUE_SELECTORS)) return 'continued';

  // Heuristic: scan visible buttons
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

  // Last resort: click a visible, enabled button that's not a skip/back
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
      const { cvData, cvFilename, coverData, coverFilename, jobTitle, profile } = message.payload || {};
      currentJobTitle = jobTitle || '';
      if (profile) currentProfile = profile;

      // Handle all steps sequentially (async)
      (async () => {
        // Handle resume upload
        await handleResumeStep(cvData, cvFilename);

        // Handle cover letter — only upload if field exists in wizard
        if (hasCoverLetterField()) {
          handleCoverLetter(coverData, coverFilename);
          await waitMs(500);
        }

        // Handle questionnaire
        const result = await handleQuestionnaire();
        if (result.needsUserInput) {
          sendResponse({
            type: 'STEP_RESULT',
            payload: { action: 'needs_input', fieldLabel: result.fieldLabel },
          });
          return;
        }

        // Wait for form state to settle, then advance
        await waitMs(500);
        const navResult = clickContinueOrSubmit();
        sendResponse({ type: 'STEP_RESULT', payload: { action: navResult } });
      })();

      return true; // async response
    }

    case 'WIZARD_READY': {
      // Check if wizard has interactive elements
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
