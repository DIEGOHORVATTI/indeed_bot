import { Message, JobInfo } from '../types';
import { findAll, clickFirst, isVisible } from '../utils/selectors';
import {
  APPLY_BUTTON_SELECTORS,
  APPLY_HEURISTIC_KEYWORDS,
  EXTERNAL_APPLY_KEYWORDS
} from '../utils/i18n';
import { JOB_SCRAPING } from '../utils/constants';

function isExternalApplyButton(btn: Element): boolean {
  const text = (btn.textContent || '').toLowerCase();
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  const combined = `${text} ${label}`;
  return EXTERNAL_APPLY_KEYWORDS.some((kw) => combined.includes(kw));
}

function findAndClickApply(): 'clicked' | 'external' | 'not_found' | 'already_applied' {
  const appliedWidget = document.querySelector('.indeed-apply-status-applied');
  if (appliedWidget) return 'already_applied';

  const applyBtn = document.querySelector('#indeedApplyButton') as HTMLButtonElement | null;
  if (applyBtn?.disabled) return 'already_applied';

  const btnText = applyBtn?.textContent?.toLowerCase() || '';
  if (btnText.includes('enviado') || btnText.includes('applied')) return 'already_applied';

  const allBtns = findAll('button', document);
  for (const btn of allBtns) {
    if (isVisible(btn) && isExternalApplyButton(btn)) {
      return 'external';
    }
  }

  if (clickFirst(APPLY_BUTTON_SELECTORS)) {
    return 'clicked';
  }

  const visibleBtns = allBtns.filter(isVisible);
  for (const btn of visibleBtns) {
    if (isExternalApplyButton(btn)) continue;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = (btn.textContent || '').toLowerCase();
    if (['close', 'cancel', 'fermer', 'annuler', 'fechar'].some((x) => label.includes(x))) {
      continue;
    }
    if (APPLY_HEURISTIC_KEYWORDS.some((kw) => text.includes(kw))) {
      (btn as HTMLElement).click();
      return 'clicked';
    }
  }

  return 'not_found';
}

function scrapeJobDescription(): JobInfo {
  const titleSelectors = JOB_SCRAPING.title;
  const companySelectors = JOB_SCRAPING.company;
  const descSelectors = JOB_SCRAPING.description;

  function getText(selectors: string[]): string {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.textContent?.trim() || '';
    }
    return '';
  }

  return {
    title: getText(titleSelectors),
    company: getText(companySelectors),
    description: getText(descSelectors),
    url: window.location.href
  };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'COLLECT_LINKS': {
      sendResponse({
        type: 'LINKS_COLLECTED',
        payload: [],
        stats: {
          totalCards: 0,
          externalApply: 0
        }
      });
      return true;
    }
    case 'CLICK_APPLY': {
      const result = findAndClickApply();
      sendResponse({ type: 'APPLY_RESULT', payload: result });
      return true;
    }
    case 'SCRAPE_JOB': {
      const info = scrapeJobDescription();
      sendResponse({ type: 'JOB_SCRAPED', payload: info });
      return true;
    }
    case 'GET_STATE': {
      sendResponse({
        type: 'STATUS_UPDATE',
        payload: { ready: true, url: window.location.href }
      });
      return true;
    }
    default:
      return false;
  }
});

chrome.runtime.sendMessage({
  type: 'STATUS_UPDATE',
  payload: { contentScript: 'indeed', url: window.location.href }
});
