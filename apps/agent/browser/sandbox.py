"""Playwright browser sandbox — headed Chrome with monitoring hooks."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from apps.agent.dashboard.events import EventBus

logger = logging.getLogger(__name__)


class BrowserSandbox:
    """Visible Playwright browser that broadcasts state to the dashboard."""

    def __init__(self, user_data_dir: str | None = None):
        self._pw = None
        self._context = None
        self._page = None
        self._user_data_dir = user_data_dir
        self._events = EventBus()

    # ── Lifecycle ──

    def start(self) -> None:
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()

        if self._user_data_dir:
            Path(self._user_data_dir).mkdir(parents=True, exist_ok=True)
            self._context = self._pw.chromium.launch_persistent_context(
                self._user_data_dir,
                headless=False,
                viewport={"width": 1280, "height": 720},
                args=["--disable-blink-features=AutomationControlled"],
            )
        else:
            browser = self._pw.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
            self._context = browser.new_context(
                viewport={"width": 1280, "height": 720},
            )

        self._page = (
            self._context.pages[0]
            if self._context.pages
            else self._context.new_page()
        )
        # Show a landing page instead of about:blank
        self._page.set_content(
            "<html><body style='background:#1a1a2e;color:#e0e0e0;font-family:system-ui;"
            "display:flex;align-items:center;justify-content:center;height:100vh'>"
            "<div style='text-align:center'>"
            "<h1 style='color:#e94560;font-size:32px'>JobPilot Sandbox</h1>"
            "<p style='color:#888;margin-top:12px'>Waiting for apply stage...</p>"
            "</div></body></html>"
        )
        self._events.emit("browser_started", {"user_data_dir": self._user_data_dir})
        logger.info("Browser sandbox started (headed)")

    def stop(self) -> None:
        try:
            if self._context:
                self._context.close()
            if self._pw:
                self._pw.stop()
        except Exception:
            pass
        self._events.emit("browser_stopped")
        logger.info("Browser sandbox stopped")

    @property
    def page(self):
        return self._page

    # ── Navigation ──

    def navigate(self, url: str) -> None:
        self._page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        self._events.emit("navigate", {"url": url})
        self._sync_dashboard()

    # ── Screenshots ──

    def screenshot(self) -> bytes:
        return self._page.screenshot(type="png")

    def screenshot_b64(self) -> str:
        return base64.b64encode(self.screenshot()).decode()

    # ── DOM access ──

    def get_dom(self) -> str:
        return self._page.content()

    def get_page_context(self) -> str:
        """Extract structured page state for AI decision-making."""
        return self._page.evaluate(
            r"""() => {
            const L = [];
            L.push('URL: ' + location.href);
            L.push('Title: ' + document.title);
            L.push('');

            // ── Form elements ──
            const els = document.querySelectorAll(
                'input, select, textarea, button, [role="button"], a[href*="apply"]'
            );
            if (els.length) {
                L.push('=== INTERACTIVE ELEMENTS ===');
                els.forEach((el, i) => {
                    const tag = el.tagName.toLowerCase();
                    const vis = el.offsetParent !== null || el.type === 'hidden';
                    if (!vis) return;

                    const id    = el.id || '';
                    const name  = el.name || '';
                    const type  = el.type || '';
                    const tid   = el.getAttribute('data-testid') || '';
                    const ph    = el.placeholder || '';
                    const val   = el.value || '';
                    const text  = el.textContent?.trim().substring(0, 60) || '';
                    const label = el.labels?.[0]?.textContent?.trim() || '';
                    const req   = el.required ? ' REQUIRED' : '';
                    const ariaL = el.getAttribute('aria-label') || '';

                    let sel = '';
                    if (id)   sel = '#' + CSS.escape(id);
                    else if (tid)  sel = '[data-testid="' + tid + '"]';
                    else if (name) sel = tag + '[name="' + name + '"]';
                    else if (type === 'file') sel = 'input[type="file"]';
                    else sel = tag + ':nth-of-type(' + (i + 1) + ')';

                    let info = '[' + tag + '] sel="' + sel + '"';
                    if (type)  info += ' type=' + type;
                    if (label) info += ' label="' + label + '"';
                    if (ariaL) info += ' aria="' + ariaL + '"';
                    if (ph)    info += ' placeholder="' + ph + '"';
                    if (val)   info += ' value="' + val + '"';
                    if (text && (tag === 'button' || tag === 'a'))
                        info += ' text="' + text + '"';
                    info += req;
                    L.push(info);
                });
            }

            // ── Errors ──
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

            // ── Visible text ──
            const main = document.querySelector(
                'main, [role="main"], form, .content, article'
            ) || document.body;
            const bodyText = main.innerText?.substring(0, 3000) || '';
            L.push('');
            L.push('=== VISIBLE TEXT ===');
            L.push(bodyText);

            return L.join('\n');
        }"""
        )

    # ── Actions ──

    def click(self, selector: str) -> None:
        self._page.click(selector, timeout=5000)
        self._events.emit("click", {"selector": selector})
        self._page.wait_for_timeout(500)
        self._sync_dashboard()

    def fill(self, selector: str, value: str) -> None:
        self._page.fill(selector, value, timeout=5000)
        self._events.emit("fill", {"selector": selector, "value": value})
        self._sync_dashboard()

    def select_option(self, selector: str, value: str) -> None:
        self._page.select_option(selector, value, timeout=5000)
        self._events.emit("select", {"selector": selector, "value": value})
        self._sync_dashboard()

    def upload_file(self, selector: str, file_path: str) -> None:
        self._page.set_input_files(selector, file_path, timeout=5000)
        self._events.emit("upload", {"selector": selector, "file": file_path})
        self._sync_dashboard()

    def wait(self, ms: int = 1000) -> None:
        self._page.wait_for_timeout(ms)
        self._sync_dashboard()

    # ── Dashboard sync ──

    def _sync_dashboard(self) -> None:
        """Push current screenshot, DOM, and page context to the event bus."""
        try:
            self._events.set_screenshot(self.screenshot_b64())
            self._events.set_dom(self.get_dom())
            ctx = self.get_page_context()
            self._events.set_page_context(ctx)
            self._events.emit("page_context", {"context": ctx})
        except Exception as e:
            logger.debug("Dashboard sync failed: %s", e)
