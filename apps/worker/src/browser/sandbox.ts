import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { CHROME_PROFILE_DIR, REDIS_URL, PROXY_URL } from '@jobpilot/config'
import { randomViewport } from '@jobpilot/anti-detection'
import { Redis } from 'ioredis'

chromium.use(StealthPlugin())

// Page context extraction JS — runs in the browser, not in Node
const PAGE_CONTEXT_JS = /* js */ `() => {
  const L = [];
  L.push('URL: ' + location.href);
  L.push('Title: ' + document.title);
  L.push('');

  const els = document.querySelectorAll(
    'input, select, textarea, button, [role="button"], a[href*="apply"]'
  );
  if (els.length) {
    L.push('=== INTERACTIVE ELEMENTS ===');
    els.forEach((el, i) => {
      const tag = el.tagName.toLowerCase();
      if (el.offsetParent === null && el.type !== 'hidden') return;

      const id = el.id || '';
      const name = el.getAttribute('name') || '';
      const type = el.type || '';
      const tid = el.getAttribute('data-testid') || '';
      const ph = el.placeholder || '';
      const val = el.value || '';
      const text = el.textContent?.trim().substring(0, 60) || '';
      const label = el.labels?.[0]?.textContent?.trim() || '';
      const req = el.required ? ' REQUIRED' : '';
      const ariaL = el.getAttribute('aria-label') || '';

      let sel = '';
      if (id) sel = '#' + CSS.escape(id);
      else if (tid) sel = '[data-testid="' + tid + '"]';
      else if (name) sel = tag + '[name="' + name + '"]';
      else if (type === 'file') sel = 'input[type="file"]';
      else sel = tag + ':nth-of-type(' + (i + 1) + ')';

      let info = '[' + tag + '] sel="' + sel + '"';
      if (type) info += ' type=' + type;
      if (label) info += ' label="' + label + '"';
      if (ariaL) info += ' aria="' + ariaL + '"';
      if (ph) info += ' placeholder="' + ph + '"';
      if (val) info += ' value="' + val + '"';
      if (text && (tag === 'button' || tag === 'a')) info += ' text="' + text + '"';
      info += req;
      L.push(info);
    });
  }

  const errs = document.querySelectorAll(
    '[class*="error"], [role="alert"], [class*="Error"], .validation-error'
  );
  if (errs.length) {
    L.push('');
    L.push('=== ERRORS ===');
    errs.forEach(e => {
      const t = e.textContent?.trim();
      if (t && t.length > 3) L.push('ERROR: ' + t.substring(0, 200));
    });
  }

  const main = document.querySelector('main, [role="main"], form, .content, article') || document.body;
  const bodyText = main.innerText?.substring(0, 3000) || '';
  L.push('');
  L.push('=== VISIBLE TEXT ===');
  L.push(bodyText);

  return L.join('\\n');
}`

export interface BrowserSandbox {
  page: unknown
  navigate(url: string): Promise<void>
  screenshot(): Promise<Buffer>
  screenshotB64(): Promise<string>
  getPageContext(): Promise<string>
  click(selector: string): Promise<void>
  fill(selector: string, value: string): Promise<void>
  selectOption(selector: string, value: string): Promise<void>
  uploadFile(selector: string, filePath: string): Promise<void>
  wait(ms?: number): Promise<void>
  close(): Promise<void>
}

export async function createSandbox(userDataDir?: string): Promise<BrowserSandbox> {
  const viewport = randomViewport()
  const dir = userDataDir || CHROME_PROFILE_DIR

  const launchOptions: Record<string, unknown> = {
    headless: process.env.HEADLESS !== 'false',
    viewport,
    args: ['--disable-blink-features=AutomationControlled'],
  }

  if (PROXY_URL) {
    const url = new URL(PROXY_URL)
    launchOptions.proxy = {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      ...(url.username && { username: url.username }),
      ...(url.password && { password: url.password }),
    }
  }

  const context = await chromium.launchPersistentContext(dir, launchOptions)

  const pages = context.pages()
  const page = pages[0] || (await context.newPage())
  const redis = new Redis(REDIS_URL)

  async function publishState(): Promise<void> {
    try {
      const buf = await page.screenshot({ type: 'png' })
      const b64 = Buffer.from(buf).toString('base64')
      const ctx = await getPageContext()
      await redis.publish(
        'sandbox:state',
        JSON.stringify({
          screenshot: b64,
          pageContext: ctx,
          url: page.url(),
          timestamp: Date.now(),
        })
      )
    } catch {
      // ignore publish errors
    }
  }

  async function getPageContext(): Promise<string> {
    return page.evaluate(PAGE_CONTEXT_JS) as Promise<string>
  }

  const sandbox: BrowserSandbox = {
    page,

    async navigate(url: string) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await publishState()
    },

    async screenshot() {
      return Buffer.from(await page.screenshot({ type: 'png' }))
    },

    async screenshotB64() {
      const buf = await page.screenshot({ type: 'png' })
      return Buffer.from(buf).toString('base64')
    },

    getPageContext,

    async click(selector: string) {
      await page.click(selector, { timeout: 5000 })
      await page.waitForTimeout(500)
      await publishState()
    },

    async fill(selector: string, value: string) {
      await page.fill(selector, value, { timeout: 5000 })
      await publishState()
    },

    async selectOption(selector: string, value: string) {
      await page.selectOption(selector, value, { timeout: 5000 })
      await publishState()
    },

    async uploadFile(selector: string, filePath: string) {
      await page.setInputFiles(selector, filePath, { timeout: 5000 })
      await publishState()
    },

    async wait(ms = 1000) {
      await page.waitForTimeout(ms)
      await publishState()
    },

    async close() {
      redis.quit()
      await context.close()
    },
  }

  return sandbox
}
