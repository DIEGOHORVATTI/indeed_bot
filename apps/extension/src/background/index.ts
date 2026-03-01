/**
 * Service worker entry point for Indeed Auto Apply extension.
 * Handles message routing between popup, options, and content scripts.
 */

import { Message, Settings, DEFAULT_SETTINGS } from '../types';
import { startBot, stopBot, pauseBot, resumeBot, getStatus, addLog } from './orchestrator';
import { AnswerCache } from '../services/answer-cache';
import { askClaudeForAnswer } from '../services/claude';
import { setupNotificationListeners } from '../utils/notifications';

// Initialize notification listeners (guarded for availability)
setupNotificationListeners();

const cache = new AnswerCache();

// ── Settings Management ──

async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...data.settings };
}

// ── Message Router ──

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // async response
});

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
): Promise<void> {
  switch (message.type) {
    case 'START_BOT': {
      const settings = await getSettings();
      if (!settings.searchUrls.length) {
        sendResponse({ error: 'No search URLs configured. Go to Options to set up.' });
        return;
      }
      startBot(settings);
      sendResponse({ ok: true });
      break;
    }

    case 'STOP_BOT':
      stopBot();
      sendResponse({ ok: true });
      break;

    case 'PAUSE_BOT':
      pauseBot();
      sendResponse({ ok: true });
      break;

    case 'RESUME_BOT':
      resumeBot();
      sendResponse({ ok: true });
      break;

    case 'GET_STATE':
      sendResponse({ type: 'STATUS_UPDATE', payload: getStatus() });
      break;

    case 'ASK_CLAUDE': {
      const { question, options, jobTitle, baseProfile, cacheOnly, storeCache, label, inputType, answer, constraints, errorContext } = message.payload || {};

      // Cache store request
      if (storeCache) {
        await cache.store(label, inputType, answer, options);
        sendResponse({ ok: true });
        return;
      }

      // Cache lookup request
      if (cacheOnly) {
        const cached = await cache.lookup(label, inputType, options);
        sendResponse({ payload: { answer: cached } });
        return;
      }

      // Full lookup: cache first, then Claude
      if (question) {
        // Skip cache when retrying with error context (previous cached answer was wrong)
        if (!errorContext) {
          const cached = await cache.lookup(question, 'text', options);
          if (cached) {
            sendResponse({ payload: { answer: cached } });
            return;
          }
        }

        // Ask Claude
        const settings = await getSettings();
        if (!settings.backendUrl) {
          sendResponse({ payload: { answer: null } });
          return;
        }

        const profileContext = baseProfile || settings.personalization?.baseProfile || '';
        const claudeAnswer = await askClaudeForAnswer(
          question, options, jobTitle || '', settings.backendUrl, profileContext,
          constraints, errorContext
        );

        if (claudeAnswer) {
          await cache.store(question, 'text', claudeAnswer, options);
        }

        sendResponse({ payload: { answer: claudeAnswer } });
      }
      break;
    }

    case 'ADD_LOG': {
      const { level, message: msg } = message.payload || {};
      if (level && msg) {
        addLog(level, msg);
      }
      sendResponse({ ok: true });
      break;
    }

    case 'SCRAPE_LINKEDIN': {
      const { username } = message.payload || {};
      if (!username) {
        sendResponse({ error: 'No username provided' });
        return;
      }

      // Extract username from URL if needed
      let slug = username.trim().replace(/\/$/, '');
      const urlMatch = slug.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (urlMatch) slug = urlMatch[1];

      try {
        // Open LinkedIn profile in a new tab
        const tab = await chrome.tabs.create({
          url: `https://www.linkedin.com/in/${slug}/`,
          active: false,
        });

        // Wait for page to load
        await new Promise<void>((resolve) => {
          const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          // Timeout after 15s
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 15000);
        });

        // Execute scraping script in the tab
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          func: () => {
            const txt = (el: Element | null) => el?.textContent?.trim() || '';

            // ── Name & headline ──
            const name = txt(document.querySelector('h1'));
            const headline = txt(document.querySelector('.text-body-medium.break-words'))
              || txt(document.querySelector('[data-generated-suggestion-target]'));

            // ── Location ──
            const location = txt(document.querySelector('.text-body-small.inline.t-black--light.break-words'))
              || txt(document.querySelector('[class*="top-card"] [class*="location"]'));

            // ── About ──
            const aboutSection = document.querySelector('#about')?.closest('section');
            const about = aboutSection
              ? txt(aboutSection.querySelector('.display-flex .inline-show-more-text, [class*="full-width"] span[aria-hidden="true"]'))
              : '';

            // ── Experience ──
            const experienceSection = document.querySelector('#experience')?.closest('section');
            const experience: { title: string; company: string; dates: string; description: string }[] = [];
            if (experienceSection) {
              experienceSection.querySelectorAll(':scope > div > ul > li').forEach((li) => {
                const spans = li.querySelectorAll('span[aria-hidden="true"]');
                const title = txt(spans[0]);
                const company = txt(spans[1]);
                const dates = txt(spans[2]);
                const desc = txt(li.querySelector('.inline-show-more-text span[aria-hidden="true"]'));
                if (title) experience.push({ title, company, dates, description: desc });
              });
            }

            // ── Education ──
            const educationSection = document.querySelector('#education')?.closest('section');
            const education: { school: string; degree: string; dates: string }[] = [];
            if (educationSection) {
              educationSection.querySelectorAll(':scope > div > ul > li').forEach((li) => {
                const spans = li.querySelectorAll('span[aria-hidden="true"]');
                const school = txt(spans[0]);
                const degree = txt(spans[1]);
                const dates = txt(spans[2]);
                if (school) education.push({ school, degree, dates });
              });
            }

            // ── Skills ──
            const skillsSection = document.querySelector('#skills')?.closest('section');
            const skills: string[] = [];
            if (skillsSection) {
              skillsSection.querySelectorAll(':scope > div > ul > li span[aria-hidden="true"]').forEach((el) => {
                const s = txt(el);
                if (s && !skills.includes(s)) skills.push(s);
              });
            }

            // ── Languages ──
            const languagesSection = document.querySelector('#languages')?.closest('section');
            const languages: { name: string; level: string }[] = [];
            if (languagesSection) {
              languagesSection.querySelectorAll(':scope > div > ul > li').forEach((li) => {
                const spans = li.querySelectorAll('span[aria-hidden="true"]');
                const langName = txt(spans[0]);
                const level = txt(spans[1]);
                if (langName) languages.push({ name: langName, level });
              });
            }

            // ── Certifications ──
            const certsSection = document.querySelector('#licenses_and_certifications')?.closest('section');
            const certifications: { name: string; issuer: string; date: string }[] = [];
            if (certsSection) {
              certsSection.querySelectorAll(':scope > div > ul > li').forEach((li) => {
                const spans = li.querySelectorAll('span[aria-hidden="true"]');
                const certName = txt(spans[0]);
                const issuer = txt(spans[1]);
                const date = txt(spans[2]);
                if (certName) certifications.push({ name: certName, issuer, date });
              });
            }

            // ── Contact links (from contact info modal or page links) ──
            const contactLinks: string[] = [];
            document.querySelectorAll('a[href]').forEach((a) => {
              const href = (a as HTMLAnchorElement).href;
              if (href.includes('github.com') || href.includes('portfolio') || href.includes('instagram.com')) {
                if (!contactLinks.includes(href)) contactLinks.push(href);
              }
            });

            // ── JSON-LD (bonus structured data) ──
            let jsonLd: any = null;
            const ldEl = document.querySelector('script[type="application/ld+json"]');
            if (ldEl) {
              try { jsonLd = JSON.parse(ldEl.textContent || '{}'); } catch { /* ignore */ }
            }

            return {
              name, headline, location, about,
              experience, education, skills, languages, certifications,
              contactLinks, jsonLd,
            };
          },
        });

        // Close the tab
        if (tab.id) await chrome.tabs.remove(tab.id);

        const result = results?.[0]?.result;
        if (!result || (!result.name && !result.jsonLd)) {
          sendResponse({ error: 'Could not extract profile data. Make sure you are logged into LinkedIn.' });
          return;
        }

        // ── Build profile data ──
        const profileData: any = {
          linkedin: `https://www.linkedin.com/in/${slug}/`,
          name: result.name || '',
          headline: result.headline || '',
          about: result.about || '',
          experience: result.experience || [],
          education: result.education || [],
          skills: result.skills || [],
          languages: result.languages || [],
          certifications: result.certifications || [],
        };

        // Parse location
        const loc = result.location || '';
        if (loc.includes(',')) {
          const parts = loc.split(',').map((p: string) => p.trim());
          profileData.city = parts[0];
          profileData.state = parts[1] || '';
          if (parts[2]) profileData.country = parts[2];
        } else {
          profileData.city = loc;
        }

        // Extract links from JSON-LD sameAs or contactLinks
        const links = result.contactLinks || [];
        if (result.jsonLd) {
          const ld = result.jsonLd['@graph']
            ? result.jsonLd['@graph'].find((i: any) => i['@type'] === 'Person') || result.jsonLd
            : result.jsonLd;
          const sameAs = Array.isArray(ld.sameAs) ? ld.sameAs : ld.sameAs ? [ld.sameAs] : [];
          links.push(...sameAs);

          // Fill from JSON-LD if DOM didn't get it
          if (!profileData.name && ld.name) profileData.name = ld.name;
          const addr = ld.address || {};
          if (!profileData.city && addr.addressLocality) {
            const locality = addr.addressLocality;
            if (locality.includes(',')) {
              profileData.city = locality.split(',')[0].trim();
              profileData.state = locality.split(',')[1]?.trim() || addr.addressRegion || '';
            } else {
              profileData.city = locality;
              profileData.state = addr.addressRegion || '';
            }
          }
        }

        for (const link of links) {
          if (link.includes('github.com') && !profileData.github) profileData.github = link;
          else if (link.includes('instagram.com') && !profileData.instagram) profileData.instagram = link;
          else if (!link.includes('linkedin.com') && !profileData.portfolio) profileData.portfolio = link;
        }

        sendResponse({ payload: profileData });
      } catch (err: any) {
        sendResponse({ error: err.message || 'Failed to scrape LinkedIn' });
      }
      break;
    }

    case 'STATUS_UPDATE':
      // Content script announcing itself — just log it
      break;

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }
}

// ── Keep Alive ──
// MV3 service workers get killed after ~30s of inactivity.
// Use alarms to keep alive during bot operation.
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    const status = getStatus();
    if (status.state === 'idle') {
      chrome.alarms.clear('keepAlive');
    }
  }
});
