import { Message, JobInfo } from '../types';
import { findAll, findFirst, isDisabled, isVisible } from '../utils/selectors';

interface LinkedInCollectedJob {
  url: string;
  jobKey: string;
  title?: string;
  company?: string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAbsoluteUrl(href: string): string {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return `${window.location.origin}${href}`;
  return `${window.location.origin}/${href.replace(/^\//, '')}`;
}

function extractJobId(url: string): string | null {
  const viewMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) return viewMatch[1];
  const currentMatch = url.match(/currentJobId=(\d+)/);
  if (currentMatch) return currentMatch[1];
  return null;
}

function collectLinkedInJobLinks(): LinkedInCollectedJob[] {
  const root =
    (document.querySelector('.jobs-search-results-list') as Element | null) ||
    (document.querySelector('ul.scaffold-layout__list-container') as Element | null) ||
    document;

  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/view/"]'));
  const seen = new Set<string>();
  const collected: LinkedInCollectedJob[] = [];

  for (const anchor of links) {
    const url = toAbsoluteUrl(anchor.href || anchor.getAttribute('href') || '');
    const jobKey = extractJobId(url);
    if (!url || !jobKey || seen.has(jobKey)) continue;

    seen.add(jobKey);
    const card = anchor.closest('li, .job-card-container, .jobs-search-results__list-item, .artdeco-list__item');

    const title =
      anchor.textContent?.trim() ||
      card?.querySelector('.job-card-list__title, .artdeco-entity-lockup__title')?.textContent?.trim() ||
      '';
    const company =
      card
        ?.querySelector('.job-card-container__company-name, .artdeco-entity-lockup__subtitle, h4')
        ?.textContent?.trim() || '';

    collected.push({ url, jobKey, title, company });
  }

  return collected;
}

function scrapeLinkedInJob(): JobInfo & { location?: string } {
  const title =
    document
      .querySelector('.job-details-jobs-unified-top-card__job-title, h1')
      ?.textContent?.trim() || '';
  const company =
    document
      .querySelector('.job-details-jobs-unified-top-card__company-name, a[href*="/company/"]')
      ?.textContent?.trim() || '';
  const description =
    document.querySelector('.jobs-description__content, #job-details')?.textContent?.trim() || '';
  const location =
    document.querySelector('.job-details-jobs-unified-top-card__bullet')?.textContent?.trim() || '';

  return {
    title,
    company,
    description,
    url: window.location.href,
    location
  };
}

function findEasyApplyButton(): HTMLElement | null {
  const direct = document.querySelector('.jobs-apply-button--top-card') as HTMLElement | null;
  if (direct && isVisible(direct) && !isDisabled(direct)) {
    const text = normalizeText(`${direct.textContent || ''} ${direct.getAttribute('aria-label') || ''}`);
    if (text.includes('easy apply') || text.includes('candidatura simplificada')) return direct;
  }

  const buttons = findAll('button, [role="button"]').filter(isVisible);
  for (const el of buttons) {
    if (!(el instanceof HTMLElement) || isDisabled(el)) continue;
    const text = normalizeText(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`);
    if (text.includes('easy apply') || text.includes('candidatura simplificada')) return el;
  }

  return null;
}

function advanceEasyApplyModal(): 'clicked' | 'not_found' {
  const stepSelectors = [
    'button[aria-label*="Continue" i]',
    'button[aria-label*="Next" i]',
    'button[aria-label*="Review" i]',
    'button[aria-label*="Submit" i]',
    '.jobs-easy-apply-content button',
    '[role="dialog"] button'
  ];

  for (const selector of stepSelectors) {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
      (button) => isVisible(button) && !isDisabled(button)
    );
    for (const button of buttons) {
      const text = normalizeText(`${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`);
      if (
        text.includes('continue') ||
        text.includes('next') ||
        text.includes('review') ||
        text.includes('submit') ||
        text.includes('enviar') ||
        text.includes('continuar')
      ) {
        button.click();
        return 'clicked';
      }
    }
  }

  return 'not_found';
}

function clickApply(): 'clicked' | 'not_found' {
  const easyApply = findEasyApplyButton();
  if (easyApply) {
    easyApply.click();
    return 'clicked';
  }

  const modalAdvanced = advanceEasyApplyModal();
  if (modalAdvanced === 'clicked') return 'clicked';

  const fallbackApply = findFirst(
    [
      'button[aria-label*="Apply" i]',
      'button[aria-label*="Candidate" i]',
      'button.jobs-apply-button',
      '[data-control-name*="jobdetails_topcard_inapply"]'
    ],
    document,
    { visibleOnly: true }
  );

  if (fallbackApply instanceof HTMLElement && !isDisabled(fallbackApply)) {
    fallbackApply.click();
    return 'clicked';
  }

  return 'not_found';
}

function getTotalJobCount(): number | null {
  const selectors = [
    '.jobs-search-results-list__subtitle',
    '.jobs-search-results-list__text',
    '.display-flex.t-12.t-black--light.t-normal',
    '[data-test-search-results-count]'
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent || '';
    const match = text.match(/(\d[\d.,]*)/);
    if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
  }

  return null;
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'COLLECT_LINKS': {
      sendResponse({ type: 'LINKS_COLLECTED', payload: collectLinkedInJobLinks() });
      return true;
    }

    case 'CLICK_APPLY': {
      sendResponse({ type: 'APPLY_RESULT', payload: clickApply() });
      return true;
    }

    case 'SCRAPE_JOB': {
      sendResponse({ type: 'JOB_SCRAPED', payload: scrapeLinkedInJob() });
      return true;
    }

    case 'GET_TOTAL_COUNT': {
      sendResponse({
        type: 'TOTAL_COUNT',
        payload: {
          totalJobs: getTotalJobCount(),
          totalPages: 1
        }
      });
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
  payload: { contentScript: 'linkedin', url: window.location.href }
});
