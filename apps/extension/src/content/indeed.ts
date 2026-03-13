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
import { TESTIDS, JOB_SCRAPING, URL_PATTERNS } from '../utils/constants';

// ── URL Validation ──

function isIndeedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(URL_PATTERNS.indeedDomain);
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

interface CollectedJob {
  url: string;
  jobKey: string;
  title: string;
  company: string;
  location: string;
  salary: string;
}

interface CollectResult {
  links: CollectedJob[];
  totalCards: number;
  externalApply: number;
}

function collectIndeedApplyLinks(): CollectResult {
  const links: CollectedJob[] = [];
  const cards = document.querySelectorAll(TESTIDS.jobCard);

  console.log(
    `[indeed-cs] collectLinks: found ${cards.length} job cards on ${window.location.href}`
  );

  let noApplyBtn = 0;
  let noLink = 0;
  let notIndeed = 0;
  let noKey = 0;

  for (const card of cards) {
    const indeedApply = card.querySelector(TESTIDS.indeedApply);
    if (!indeedApply) {
      noApplyBtn++;
      continue;
    }

    const linkEl = card.querySelector(TESTIDS.jobTitleLink) as HTMLAnchorElement | null;
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

    const jobKey = linkEl.getAttribute('data-jk') || extractJobKey(jobUrl);
    if (!jobKey) {
      noKey++;
      continue;
    }

    const titleSpan = card.querySelector('h2.jobTitle span[title]') || card.querySelector('h2.jobTitle span');
    const companyEl = card.querySelector('[data-testid="company-name"]');
    const locationEl = card.querySelector('[data-testid="text-location"]');
    const salaryEl = card.querySelector('.salary-snippet-container span');

    links.push({
      url: jobUrl,
      jobKey,
      title: titleSpan ? (titleSpan.getAttribute('title') || titleSpan.textContent || '').trim() : '',
      company: companyEl?.textContent?.trim() || '',
      location: locationEl?.textContent?.trim() || '',
      salary: salaryEl?.textContent?.trim() || '',
    });
  }

  console.log(
    `[indeed-cs] collectLinks result: ${links.length} valid, skipped: ${noApplyBtn} no-apply, ${noLink} no-link, ${notIndeed} not-indeed, ${noKey} no-key`
  );
  return { links, totalCards: cards.length, externalApply: noApplyBtn };
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

// ── Job Count & Pages ──

function getTotalJobCount(): number | null {
  // Try search results count header (e.g., "74 vagas" / "74 jobs")
  const countSelectors = JOB_SCRAPING.jobCount;
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
  const pageLinks = document.querySelectorAll(JOB_SCRAPING.pagination);
  // Subtract 1 for the "next" link (pagination-page-next)
  const count = Array.from(pageLinks).filter(
    (el) => el.getAttribute('data-testid') !== JOB_SCRAPING.paginationNext
  ).length;
  return Math.max(1, count);
}

// ── Smart Wait ──

async function waitForJobCards(timeoutMs = 10000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cards = document.querySelectorAll(TESTIDS.jobCard);
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
        const result = collectIndeedApplyLinks();
        sendResponse({
          type: 'LINKS_COLLECTED',
          payload: result.links,
          stats: {
            totalCards: result.totalCards,
            externalApply: result.externalApply
          }
        });
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
