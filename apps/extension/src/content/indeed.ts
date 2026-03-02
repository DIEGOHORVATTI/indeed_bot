/**
 * Content script for Indeed pages (search results + job detail pages).
 * Handles: job link collection, apply button clicking, job scraping.
 * Does NOT run on smartapply.indeed.com (handled by smartapply.ts).
 */

import { Message, JobInfo } from '../types';
import { findFirst, findAll, clickFirst, isVisible } from '../utils/selectors';
import {
  APPLY_BUTTON_SELECTORS,
  APPLY_HEURISTIC_KEYWORDS,
  EXTERNAL_APPLY_KEYWORDS
} from '../utils/i18n';

// ── URL Validation ──

function isIndeedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('indeed.com');
  } catch {
    return false;
  }
}

function extractJobKey(url: string): string | null {
  try {
    const params = new URL(url).searchParams;
    return params.get('jk') || params.get('vjk') || null;
  } catch {
    return null;
  }
}

// ── Job Link Collection ──

function collectIndeedApplyLinks(): { url: string; jobKey: string }[] {
  const links: { url: string; jobKey: string }[] = [];
  const cards = document.querySelectorAll('div[data-testid="slider_item"]');

  console.log(
    `[indeed-cs] collectLinks: found ${cards.length} job cards on ${window.location.href}`
  );

  let noApplyBtn = 0;
  let noLink = 0;
  let notIndeed = 0;
  let noKey = 0;

  for (const card of cards) {
    const indeedApply = card.querySelector('[data-testid="indeedApply"]');
    if (!indeedApply) {
      noApplyBtn++;
      continue;
    }

    const linkEl = card.querySelector('a.jcs-JobTitle') as HTMLAnchorElement | null;
    if (!linkEl) {
      noLink++;
      continue;
    }

    let jobUrl = linkEl.getAttribute('href') || '';
    if (jobUrl.startsWith('/')) {
      jobUrl = `${window.location.origin}${jobUrl}`;
    }

    if (!isIndeedUrl(jobUrl)) {
      notIndeed++;
      continue;
    }

    const jobKey = extractJobKey(jobUrl);
    if (jobKey) {
      links.push({ url: jobUrl, jobKey });
    } else {
      noKey++;
    }
  }

  console.log(
    `[indeed-cs] collectLinks result: ${links.length} valid, skipped: ${noApplyBtn} no-apply, ${noLink} no-link, ${notIndeed} not-indeed, ${noKey} no-key`
  );
  return links;
}

// ── External Apply Detection ──

function isExternalApplyButton(btn: Element): boolean {
  const text = (btn.textContent || '').toLowerCase();
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  const combined = `${text} ${label}`;
  return EXTERNAL_APPLY_KEYWORDS.some((kw) => combined.includes(kw));
}

// ── Apply Button ──

function findAndClickApply(): 'clicked' | 'external' | 'not_found' {
  // Check for external apply buttons first
  const allBtns = findAll('button', document);
  for (const btn of allBtns) {
    if (isVisible(btn) && isExternalApplyButton(btn)) {
      return 'external';
    }
  }

  // Try specific selectors
  if (clickFirst(APPLY_BUTTON_SELECTORS)) {
    return 'clicked';
  }

  // Heuristic fallback: scan visible buttons by text
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

// ── Job Scraping ──

function scrapeJobDescription(): JobInfo {
  const titleSelectors = [
    'h1.jobsearch-JobInfoHeader-title',
    'h1[data-testid="jobsearch-JobInfoHeader-title"]',
    'h1[class*="JobInfoHeader"]',
    'h2.jobTitle'
  ];
  const companySelectors = [
    '[data-testid="inlineHeader-companyName"]',
    '[data-testid="company-name"]',
    'div[data-company-name] a',
    'span.css-1cjkto6'
  ];
  const descSelectors = [
    '#jobDescriptionText',
    'div.jobsearch-JobComponent-description',
    '[data-testid="jobDescriptionText"]'
  ];

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

// ── Job Count & Pages ──

function getTotalJobCount(): number | null {
  // Try search results count header (e.g., "74 vagas" / "74 jobs")
  const countSelectors = [
    '.jobsearch-JobCountAndSortPane-jobCount',
    '[data-testid="jobCount"]',
    '.jobsearch-ResultsList-header span'
  ];
  for (const sel of countSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const match = el.textContent?.match(/(\d[\d.,]*)/);
      if (match) return parseInt(match[1].replace(/[.,]/g, ''), 10);
    }
  }

  // Fallback: meta description (e.g., "Confira 74 vagas abertas")
  const meta = document.querySelector('meta[name="description"]');
  const content = meta?.getAttribute('content') || '';
  const metaMatch = content.match(/(\d+)\s*vagas|(\d+)\s*jobs/i);
  if (metaMatch) return parseInt(metaMatch[1] || metaMatch[2], 10);

  return null;
}

function getTotalPages(): number {
  const pageLinks = document.querySelectorAll(
    'nav[role="navigation"] a[data-testid^="pagination-page-"]'
  );
  // Subtract 1 for the "next" link (pagination-page-next)
  const count = Array.from(pageLinks).filter(
    (el) => el.getAttribute('data-testid') !== 'pagination-page-next'
  ).length;
  return Math.max(1, count);
}

// ── Smart Wait ──

async function waitForJobCards(timeoutMs = 10000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cards = document.querySelectorAll('div[data-testid="slider_item"]');
    if (cards.length > 0) return cards.length;
    await new Promise((r) => setTimeout(r, 500));
  }
  return 0;
}

// ── Message Listener ──

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  // Only handle messages meant for the main Indeed page content script.
  // Return false for unknown messages so smartapply.js (in iframe) can handle them.
  switch (message.type) {
    case 'COLLECT_LINKS': {
      // Wait for cards to render before collecting
      waitForJobCards().then((cardCount) => {
        console.log(`[indeed-cs] waitForJobCards: ${cardCount} cards found`);
        const links = collectIndeedApplyLinks();
        sendResponse({ type: 'LINKS_COLLECTED', payload: links });
      });
      return true; // async response
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
    case 'GET_TOTAL_COUNT': {
      sendResponse({
        type: 'TOTAL_COUNT',
        payload: {
          totalJobs: getTotalJobCount(),
          totalPages: getTotalPages()
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
      // Don't handle — let other content scripts (smartapply.js) respond
      return false;
  }
});

// Announce to service worker that content script is ready
chrome.runtime.sendMessage({
  type: 'STATUS_UPDATE',
  payload: { contentScript: 'indeed', url: window.location.href }
});
