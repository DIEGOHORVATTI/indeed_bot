import { Message, JobInfo } from '../types';
import {
  clickFirst,
  fillInput,
  findAll,
  findFirst,
  getLabelForInput,
  isDisabled,
  isVisible,
  selectOption,
  setInputFiles
} from '../utils/selectors';

type GenericFormMessage =
  | { type: 'DETECT_FORM' }
  | { type: 'FILL_FORM'; payload: { fields: Array<{ selector: string; value: string }> } }
  | {
      type: 'FILL_AND_SUBMIT';
      payload: { fields: Array<{ selector: string; value: string }>; submitSelector?: string };
    }
  | {
      type: 'UPLOAD_FILE';
      payload: { selector: string; fileData: number[]; fileName: string; fileType: string };
    }
  | { type: 'SCRAPE_JOB' }
  | { type: 'GET_STATE' }
  | { type: 'CLICK_ELEMENT'; payload: { selector: string } }
  | { type: 'GET_PAGE_CONTEXT' };

interface DetectedField {
  selector: string;
  type:
    | 'text'
    | 'email'
    | 'tel'
    | 'number'
    | 'date'
    | 'textarea'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'file';
  label: string;
  category: string;
  required: boolean;
  value: string;
  options?: string[];
  placeholder?: string;
}

const FIELD_KEYWORDS: Record<string, string[]> = {
  first_name: ['first name', 'primeiro nome', 'nombre', 'given name', 'vorname'],
  last_name: ['last name', 'sobrenome', 'apellido', 'family name', 'nachname', 'surname'],
  full_name: ['full name', 'nome completo', 'nombre completo', 'your name'],
  email: ['email', 'e-mail', 'correo'],
  phone: ['phone', 'telefone', 'celular', 'teléfono', 'mobile', 'tel'],
  address: ['address', 'endereço', 'dirección', 'street', 'rua'],
  city: ['city', 'cidade', 'ciudad'],
  state: ['state', 'estado', 'province', 'região'],
  zip: ['zip', 'cep', 'postal', 'código postal'],
  country: ['country', 'país', 'pais'],
  linkedin: ['linkedin'],
  github: ['github'],
  portfolio: ['portfolio', 'website', 'site', 'url'],
  salary: ['salary', 'salário', 'pretensão', 'compensation', 'remuneração'],
  start_date: ['start date', 'data de início', 'disponibilidade', 'when can you start', 'available'],
  experience_years: ['years of experience', 'anos de experiência', 'experience', 'experiência'],
  education: ['education', 'formação', 'degree', 'escolaridade'],
  resume: ['resume', 'currículo', 'cv', 'curriculum'],
  cover_letter: ['cover letter', 'carta de apresentação', 'carta']
};

const SUBMIT_KEYWORDS = [
  'submit',
  'apply',
  'enviar',
  'candidatar',
  'next',
  'continue',
  'próximo',
  'proximo',
  'continuar'
];

const AVOID_SUBMIT_KEYWORDS = ['cancel', 'back', 'voltar', 'cancelar'];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function buildSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const dataTestId = el.getAttribute('data-testid');
  if (dataTestId) return `[data-testid="${cssEscape(dataTestId)}"]`;

  const name = el.getAttribute('name');
  const tag = el.tagName.toLowerCase();
  if (name && tag === 'input') {
    const type = (el as HTMLInputElement).type || 'text';
    return `input[name="${cssEscape(name)}"][type="${cssEscape(type)}"]`;
  }
  if (name && (tag === 'textarea' || tag === 'select')) {
    return `${tag}[name="${cssEscape(name)}"]`;
  }

  const classes = Array.from(el.classList).filter((c) => !/^css-|^sc-|^jsx-|^__[a-z]/i.test(c));
  if (classes.length > 0) return `${tag}.${classes.slice(0, 2).map(cssEscape).join('.')}`;

  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
  const index = siblings.indexOf(el) + 1;
  return `${parent.tagName.toLowerCase()} > ${tag}:nth-of-type(${Math.max(index, 1)})`;
}

function getFieldType(el: Element): DetectedField['type'] | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'select';
  if (!(el instanceof HTMLInputElement)) return null;

  switch (el.type) {
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'radio':
      return 'radio';
    case 'checkbox':
      return 'checkbox';
    case 'file':
      return 'file';
    default:
      return 'text';
  }
}

function collectFieldText(el: Element): string {
  const attrs = ['placeholder', 'name', 'id', 'aria-label', 'autocomplete']
    .map((attr) => el.getAttribute(attr) || '')
    .join(' ');
  const label = getLabelForInput(el);
  const nearby = el.closest('label, fieldset, div, li')?.textContent || '';
  return normalizeText(`${attrs} ${label} ${nearby}`);
}

function classifyField(el: Element, fieldType: DetectedField['type']): string {
  const haystack = collectFieldText(el);

  for (const [category, keywords] of Object.entries(FIELD_KEYWORDS)) {
    if (keywords.some((kw) => haystack.includes(normalizeText(kw)))) {
      if (category === 'resume') return fieldType === 'file' ? 'resume_upload' : 'custom_question';
      if (category === 'cover_letter') {
        if (fieldType === 'file') return 'cover_letter_upload';
        if (fieldType === 'textarea') return 'cover_letter_text';
        return 'custom_question';
      }
      if (category === 'first_name' || category === 'last_name' || category === 'full_name') {
        return 'name';
      }
      return category;
    }
  }

  if (fieldType === 'file') return 'resume_upload';
  return 'custom_question';
}

function getElementValue(el: Element, type: DetectedField['type']): string {
  if (el instanceof HTMLInputElement) {
    if (type === 'checkbox' || type === 'radio') return el.checked ? 'true' : 'false';
    if (type === 'file') return el.files?.[0]?.name || '';
    return el.value || '';
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value || '';
  return '';
}

function getOptions(el: Element, type: DetectedField['type']): string[] | undefined {
  if (type === 'select' && el instanceof HTMLSelectElement) {
    return Array.from(el.options)
      .map((option) => option.textContent?.trim() || option.value)
      .filter(Boolean);
  }

  if (type === 'radio' && el instanceof HTMLInputElement && el.name) {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${cssEscape(el.name)}"]`
      )
    )
      .map((radio) => getLabelForInput(radio) || radio.value)
      .filter(Boolean);
  }

  return undefined;
}

function detectFormFields(): DetectedField[] {
  const fields: DetectedField[] = [];
  const seenRadioGroups = new Set<string>();

  const selectors = [
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="number"]',
    'input[type="date"]',
    'input[type="url"]',
    'textarea',
    'select',
    'input[type="radio"]',
    'input[type="checkbox"]',
    'input[type="file"]'
  ];

  const elements = selectors.flatMap((selector) => findAll(selector));

  for (const el of elements) {
    if (!isVisible(el)) continue;

    const type = getFieldType(el);
    if (!type) continue;

    if (type === 'radio' && el instanceof HTMLInputElement) {
      const radioName = el.name || buildSelector(el);
      if (seenRadioGroups.has(radioName)) continue;
      seenRadioGroups.add(radioName);
    }

    const selector =
      type === 'radio' && el instanceof HTMLInputElement && el.name
        ? `input[type="radio"][name="${cssEscape(el.name)}"]`
        : buildSelector(el);

    const label = getLabelForInput(el) || el.getAttribute('name') || el.getAttribute('id') || selector;
    const required =
      (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).required ||
      el.getAttribute('aria-required') === 'true';

    fields.push({
      selector,
      type,
      label,
      category: classifyField(el, type),
      required,
      value: getElementValue(el, type),
      options: getOptions(el, type),
      placeholder: el.getAttribute('placeholder') || undefined
    });
  }

  return fields;
}

function setCheckboxOrRadio(el: HTMLInputElement, value: string): boolean {
  const truthy = ['true', '1', 'yes', 'sim', 'si', 'y'];
  const shouldCheck = truthy.includes(value.toLowerCase().trim());
  if (el.checked !== shouldCheck) el.click();
  return true;
}

function fillSingleField(selector: string, value: string): boolean {
  const el = document.querySelector(selector);
  if (!el) return false;

  if (el instanceof HTMLInputElement) {
    if (el.type === 'radio') {
      const radios = el.name
        ? Array.from(
            document.querySelectorAll<HTMLInputElement>(
              `input[type="radio"][name="${cssEscape(el.name)}"]`
            )
          )
        : [el];

      const normalizedValue = normalizeText(value);
      const match = radios.find((radio) => {
        const label = normalizeText(getLabelForInput(radio) || '');
        const radioValue = normalizeText(radio.value || '');
        return label === normalizedValue || radioValue === normalizedValue;
      });

      (match || radios[0])?.click();
      return true;
    }

    if (el.type === 'checkbox') return setCheckboxOrRadio(el, value);
    if (el.type === 'file') return false;
    fillInput(el, value);
    return true;
  }

  if (el instanceof HTMLTextAreaElement) {
    fillInput(el, value);
    return true;
  }

  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options);
    const direct = options.find((option) => option.value === value);
    if (direct) {
      selectOption(el, direct.value);
      return true;
    }

    const normalizedValue = normalizeText(value);
    const byText = options.find(
      (option) => normalizeText(option.textContent || '') === normalizedValue
    );
    if (byText) {
      selectOption(el, byText.value);
      return true;
    }

    if (options.length > 0) {
      selectOption(el, options[0].value);
      return true;
    }
  }

  return false;
}

function findSubmitElement(): HTMLElement | null {
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button',
    '[role="button"]',
    'a[role="button"]'
  ];

  const directSubmit = findFirst(['button[type="submit"]', 'input[type="submit"]'], document, {
    visibleOnly: true
  });
  if (directSubmit instanceof HTMLElement && !isDisabled(directSubmit)) return directSubmit;

  const candidates = submitSelectors.flatMap((selector) => findAll(selector)).filter(isVisible);
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement) || isDisabled(candidate)) continue;
    const text = normalizeText(
      `${candidate.textContent || ''} ${candidate.getAttribute('aria-label') || ''}`
    );
    if (!text) continue;
    if (AVOID_SUBMIT_KEYWORDS.some((kw) => text.includes(kw))) continue;
    if (SUBMIT_KEYWORDS.some((kw) => text.includes(kw))) return candidate;
  }

  return null;
}

function parseJobPostingFromJsonLd(): Partial<JobInfo> & { source?: string } {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'));

  for (const script of scripts) {
    const content = script.textContent?.trim();
    if (!content) continue;
    try {
      const parsed = JSON.parse(content);
      const nodes = Array.isArray(parsed)
        ? parsed
        : parsed['@graph'] && Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];

      for (const node of nodes) {
        const type = String(node?.['@type'] || '').toLowerCase();
        if (!type.includes('jobposting')) continue;
        const org = node.hiringOrganization;
        return {
          title: node.title || '',
          company: (typeof org === 'object' ? org?.name : '') || '',
          description: node.description || '',
          source: 'json-ld'
        };
      }
    } catch {}
  }

  return {};
}

function getMetaContent(selector: string): string {
  return document.querySelector(selector)?.getAttribute('content')?.trim() || '';
}

function scrapeGenericJob(): JobInfo & { source: string } {
  const jsonLd = parseJobPostingFromJsonLd();
  if (jsonLd.title || jsonLd.description) {
    return {
      title: jsonLd.title || document.querySelector('h1')?.textContent?.trim() || document.title,
      company: jsonLd.company || '',
      description: String(jsonLd.description || '').replace(/<[^>]+>/g, ' ').trim(),
      url: window.location.href,
      source: jsonLd.source || 'json-ld'
    };
  }

  const ogTitle = getMetaContent('meta[property="og:title"]');
  const ogDescription = getMetaContent('meta[property="og:description"]');
  const titleH1 = document.querySelector('h1')?.textContent?.trim() || '';

  const companySelectors = [
    '[data-testid*="company" i]',
    '.company',
    '.employer',
    '[class*="company" i]',
    '[itemprop="hiringOrganization"]',
    '.breadcrumb a:nth-last-child(2)'
  ];
  const company =
    companySelectors
      .map((selector) => document.querySelector(selector)?.textContent?.trim() || '')
      .find(Boolean) ||
    getMetaContent('meta[name="author"]') ||
    getMetaContent('meta[property="og:site_name"]') ||
    '';

  const descriptionSelectors = [
    '[data-testid*="job-description" i]',
    '[data-qa*="job-description" i]',
    '[id*="job-description" i]',
    '.job-description',
    'article',
    'main'
  ];

  const description =
    descriptionSelectors
      .map((selector) => document.querySelector(selector)?.textContent?.trim() || '')
      .sort((a, b) => b.length - a.length)[0] ||
    ogDescription ||
    '';

  const fallbackTitle = (() => {
    const pageTitle = document.title.trim();
    if (!pageTitle) return titleH1 || '';
    const tokens = pageTitle.split(/[-|·]/).map((part) => part.trim());
    return tokens[0] || pageTitle;
  })();

  return {
    title: titleH1 || ogTitle || fallbackTitle,
    company,
    description,
    url: window.location.href,
    source: ogTitle || ogDescription ? 'open-graph' : 'dom'
  };
}

function getVisibleErrors(): string[] {
  const candidates = findAll(
    '[role="alert"], .error, .errors, .field-error, .invalid-feedback, [class*="error" i], [aria-invalid="true"]'
  );
  const seen = new Set<string>();
  const result: string[] = [];

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    let text = el.textContent?.trim() || '';
    if (!text && el instanceof HTMLInputElement) {
      const label = getLabelForInput(el);
      text = `${label || 'field'} is invalid`;
    }
    if (!text || text.length < 3 || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }

  return result.slice(0, 15);
}

function getPageContext() {
  const interactiveElements = detectFormFields().slice(0, 200);
  const visibleText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 3000);

  return {
    url: window.location.href,
    title: document.title,
    interactiveElements,
    visibleText,
    visibleErrors: getVisibleErrors()
  };
}

async function uploadFileFromMessage(payload: {
  selector: string;
  fileData: number[];
  fileName: string;
  fileType: string;
}): Promise<boolean> {
  const input = document.querySelector<HTMLInputElement>(payload.selector);
  if (!input || input.type !== 'file') return false;

  const bytes = new Uint8Array(payload.fileData);
  const file = new File([bytes], payload.fileName, { type: payload.fileType || 'application/octet-stream' });
  setInputFiles(input, file);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return true;
}

chrome.runtime.onMessage.addListener((message: Message | GenericFormMessage, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;

  switch (type) {
    case 'DETECT_FORM': {
      sendResponse({ type: 'FORM_DETECTED', payload: detectFormFields() });
      return true;
    }

    case 'FILL_FORM': {
      const payload = (message as Extract<GenericFormMessage, { type: 'FILL_FORM' }>).payload;
      const results = payload.fields.map((field) => ({
        selector: field.selector,
        success: fillSingleField(field.selector, field.value)
      }));
      sendResponse({ type: 'FORM_FILLED', payload: { results } });
      return true;
    }

    case 'FILL_AND_SUBMIT': {
      const payload = (message as Extract<GenericFormMessage, { type: 'FILL_AND_SUBMIT' }>).payload;
      const results = payload.fields.map((field) => ({
        selector: field.selector,
        success: fillSingleField(field.selector, field.value)
      }));

      const submitEl =
        (payload.submitSelector
          ? (document.querySelector(payload.submitSelector) as HTMLElement | null)
          : null) || findSubmitElement();

      if (submitEl && !isDisabled(submitEl)) submitEl.click();

      sendResponse({
        type: 'FORM_SUBMITTED',
        payload: { results, submitted: Boolean(submitEl), submitSelector: submitEl ? buildSelector(submitEl) : null }
      });
      return true;
    }

    case 'UPLOAD_FILE': {
      const payload = (message as Extract<GenericFormMessage, { type: 'UPLOAD_FILE' }>).payload;
      uploadFileFromMessage(payload).then((success) => {
        sendResponse({ type: 'FILE_UPLOADED', payload: { success } });
      });
      return true;
    }

    case 'SCRAPE_JOB': {
      const info = scrapeGenericJob();
      sendResponse({ type: 'JOB_SCRAPED', payload: info });
      return true;
    }

    case 'GET_STATE': {
      sendResponse({ type: 'STATUS_UPDATE', payload: { ready: true, url: window.location.href } });
      return true;
    }

    case 'CLICK_ELEMENT': {
      const payload = (message as Extract<GenericFormMessage, { type: 'CLICK_ELEMENT' }>).payload;
      const clicked = clickFirst([payload.selector]);
      sendResponse({ type: 'ELEMENT_CLICKED', payload: { selector: payload.selector, clicked } });
      return true;
    }

    case 'GET_PAGE_CONTEXT': {
      sendResponse({ type: 'PAGE_CONTEXT', payload: getPageContext() });
      return true;
    }

    default:
      return false;
  }
});

chrome.runtime.sendMessage({
  type: 'STATUS_UPDATE',
  payload: { contentScript: 'generic-form', url: window.location.href }
});
