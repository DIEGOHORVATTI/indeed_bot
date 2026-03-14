/**
 * Lightweight i18n utility for the extension UI.
 * Loads locale JSON files and provides t() for translation.
 */

import ptBR from '../locales/pt-BR.json';

// Lazy-loaded locale modules
const localeLoaders: Record<string, () => Promise<Record<string, string>>> = {
  'pt-BR': async () => ptBR,
  en: async () => (await import('../locales/en.json')).default,
  es: async () => (await import('../locales/es.json')).default
};

// Maps the extension's language setting to a locale code
const settingToLocale: Record<string, string> = {
  br: 'pt-BR',
  us: 'en',
  uk: 'en',
  fr: 'en', // fallback until fr locale exists
  de: 'en', // fallback until de locale exists
  es: 'es'
};

let currentLocale = 'pt-BR';
let strings: Record<string, string> = ptBR;

/** Detect locale from extension settings, then browser language */
async function detectLocale(): Promise<string> {
  try {
    const data = await chrome.storage.local.get('settings');
    const lang = data?.settings?.language;
    if (lang && settingToLocale[lang]) {
      return settingToLocale[lang];
    }
  } catch {
    // storage not available (e.g. in tests)
  }

  const browserLang = navigator.language;
  if (browserLang.startsWith('pt')) return 'pt-BR';
  if (browserLang.startsWith('es')) return 'es';
  return 'en';
}

/** Initialize i18n — call once on page load */
export async function initI18n(): Promise<void> {
  const locale = await detectLocale();
  await setLocale(locale);
}

/** Switch to a specific locale */
export async function setLocale(locale: string): Promise<void> {
  const loader = localeLoaders[locale];
  if (loader) {
    strings = await loader();
    currentLocale = locale;
  } else {
    // Fallback to pt-BR
    strings = ptBR;
    currentLocale = 'pt-BR';
  }
}

/** Get translated string by key. Falls back to pt-BR, then returns key. */
export function t(key: string): string {
  return strings[key] ?? ptBR[key as keyof typeof ptBR] ?? key;
}

/** Get the current locale code */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Translate all elements with data-i18n attribute.
 * - `data-i18n="key"` → sets textContent
 * - `data-i18n-placeholder="key"` → sets placeholder
 * - `data-i18n-title="key"` → sets title
 */
export function translatePage(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!;
    const text = t(key);
    if (text !== key) el.textContent = text;
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')!;
    const text = t(key);
    if (text !== key) (el as HTMLInputElement | HTMLTextAreaElement).placeholder = text;
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')!;
    const text = t(key);
    if (text !== key) el.title = text;
  });
}
