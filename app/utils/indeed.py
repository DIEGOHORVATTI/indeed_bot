from __future__ import annotations

import base64
import os
import time
from urllib.parse import urlparse, parse_qs
from typing import List, Optional
from .selectors import find_first, find_all, click_first


def _is_indeed_url(url: str) -> bool:
    """Check if a URL belongs to the Indeed platform."""
    try:
        host = urlparse(url).hostname or ""
        return host.endswith("indeed.com")
    except Exception:
        return False


def domain_for_language(lang: Optional[str]) -> str:
    """Return the appropriate Indeed domain for a given language/locale code."""
    if not lang:
        return "www.indeed.com"
    lang = str(lang).lower()
    if lang in ("en", "us"):
        return "www.indeed.com"
    if lang == "uk":
        return "uk.indeed.com"
    return f"{lang}.indeed.com"


def collect_indeed_apply_links(page, language: Optional[str]) -> List[str]:
    """Collect all 'Indeed Apply' job links from the current search result page."""
    links: List[str] = []
    job_cards = find_all(page, 'div[data-testid="slider_item"]', desc="job cards")
    for card in job_cards:
        indeed_apply = None
        try:
            indeed_apply = card.query_selector('[data-testid="indeedApply"]')
        except Exception:
            indeed_apply = None
        if indeed_apply:
            link = None
            try:
                link = card.query_selector('a.jcs-JobTitle')
            except Exception:
                link = None
            if link:
                job_url = link.get_attribute('href')
                if job_url:
                    if job_url.startswith('/'):
                        job_url = f"https://{domain_for_language(language)}{job_url}"
                    if _is_indeed_url(job_url):
                        links.append(job_url)
    return links


def _wait_for_page_ready(page, timeout_ms: int = 10000) -> None:
    """Wait for the page to be interactive using smart selectors instead of fixed sleeps."""
    try:
        page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    except Exception:
        pass
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:
        pass


def _wait_for_wizard(page, logger, timeout_ms: int = 15000) -> bool:
    """Wait for the Indeed Apply wizard to load after clicking Apply.

    The wizard loads on smartapply.indeed.com and may take time to render.
    Returns True if wizard elements are detected.
    """
    wizard_selectors = [
        'button:visible',
        'input[type="file"]',
        '[data-testid]',
        'form',
        'iframe',
    ]
    for sel in wizard_selectors:
        try:
            page.wait_for_selector(sel, timeout=timeout_ms, state="attached")
            logger.info(f"Wizard loaded, detected: '{sel}'")
            return True
        except Exception:
            continue

    # Last resort: wait a bit and check for any interactive element
    time.sleep(2)
    return len(find_all(page, 'button, input, select, textarea', desc="any interactive")) > 0


def _handle_iframe_context(page, logger):
    """Find the Indeed Apply wizard frame using Playwright's frame API.

    The wizard loads on smartapply.indeed.com inside nested iframes.
    Uses page.frames to find the correct frame by URL pattern.
    """
    # Log all available frames for debugging
    frame_urls = [(f.name or "unnamed", (f.url or "")[:100]) for f in page.frames]
    logger.info(f"Available frames ({len(frame_urls)}): {frame_urls}")

    # Primary approach: find the smartapply frame by URL
    for frame in page.frames:
        url = frame.url or ""
        if "smartapply.indeed.com" in url:
            try:
                btns = len(frame.query_selector_all('button'))
                inputs = len(frame.query_selector_all('input'))
                logger.info(f"Found smartapply frame: {url[:80]}... ({btns} buttons, {inputs} inputs)")
                return frame
            except Exception:
                logger.debug(f"smartapply frame found but not accessible: {url[:80]}")
                continue

    # Fallback: look for any frame with interactive wizard content
    best_frame = None
    best_score = 0
    for frame in page.frames:
        if frame == page.main_frame:
            continue
        try:
            btns = len(frame.query_selector_all('button'))
            inputs = len(frame.query_selector_all('input'))
            selects = len(frame.query_selector_all('select'))
            score = btns * 3 + inputs + selects
            if score > best_score:
                best_score = score
                best_frame = frame
        except Exception:
            continue

    if best_frame and best_score > 1:
        url = (best_frame.url or "")[:80]
        logger.info(f"Using fallback frame (score={best_score}): {url}")
        return best_frame

    return page


_EXTERNAL_APPLY_KEYWORDS = (
    "site da empresa", "company site", "company's site",
    "site de l'entreprise", "unternehmenswebsite",
    "sitio de la empresa", "external site",
)


def _is_external_apply_button(btn) -> bool:
    """Check if a button leads to an external (non-Indeed) application."""
    text = (btn.inner_text() or "").lower()
    label = (btn.get_attribute("aria-label") or "").lower()
    combined = f"{text} {label}"
    return any(kw in combined for kw in _EXTERNAL_APPLY_KEYWORDS)


def _find_apply_button(page, logger, max_attempts: int = 5):
    """Find and click the Indeed Apply button with retries.

    Returns:
        True       – button found and clicked.
        "external" – only an external company apply button was found.
        False      – no apply button found at all.
    """
    apply_selectors = [
        'button:has(span[class*="css-1ebo7dz"])',
        'button[id*="indeedApplyButton"]',
        '[data-testid="indeedApplyButton"]',
        'button:visible:has-text("Candidatar")',
        'button:visible:has-text("Candidatura simplificada")',
        'button:visible:has-text("Postuler")',
        'button:visible:has-text("Apply now")',
        'button:visible:has-text("Apply")',
    ]

    for attempt in range(max_attempts):
        # First check if the page only has an external apply button
        all_apply_btns = find_all(page, 'button:visible', logger=logger, desc="visible buttons")
        for btn in all_apply_btns:
            if _is_external_apply_button(btn):
                logger.warning("Detected external company apply button, skipping this job.")
                return "external"

        if click_first(page, apply_selectors, timeout_ms=5000, logger=logger, desc="apply button"):
            return True

        # Heuristic fallback: scan visible buttons
        btns = find_all(page, 'button:visible', logger=logger, desc="visible buttons")
        for btn in btns:
            if _is_external_apply_button(btn):
                continue
            label = (btn.get_attribute("aria-label") or "").lower()
            text = (btn.inner_text() or "").lower()
            if any(x in label for x in ("close", "cancel", "fermer", "annuler", "fechar")):
                continue
            if any(kw in text for kw in ("postuler", "apply", "candidat", "bewerben", "postular")):
                try:
                    btn.click(timeout=5000)
                except Exception:
                    btn.click()
                return True

        if attempt < max_attempts - 1:
            time.sleep(1)

    return False


def _extract_smartapply_context(frame, page, logger) -> dict:
    """Extract API tokens needed for smartapply API calls from frame URL and cookies."""
    context: dict = {}

    # Parse smartapply frame URL for query params (jk, apiKey, etc.)
    frame_url = frame.url or ""
    try:
        parsed = urlparse(frame_url)
        params = parse_qs(parsed.query)
        context["job_key"] = params.get("jk", params.get("jobKey", [""]))[0]
    except Exception:
        pass

    # Extract cookies
    try:
        cookies = page.context.cookies()
        for c in cookies:
            if c["name"] == "INDEED_CSRF_TOKEN":
                context["csrf_token"] = c["value"]
            elif c["name"] == "CTK":
                context["ctk"] = c["value"]
    except Exception as e:
        logger.debug(f"Failed to read cookies: {e}")

    # Try to extract the ia-api-key and application-id from the SPA's JS context
    try:
        spa_ctx = frame.evaluate("""
            () => {
                const result = {};
                // Look for API key in meta tags, data attributes, or JS globals
                const meta = document.querySelector('meta[name*="api-key"], meta[name*="apiKey"]');
                if (meta) result.apiKey = meta.getAttribute('content');

                // Try to find application ID from data attributes
                const appEl = document.querySelector('[data-application-id]');
                if (appEl) result.applicationId = appEl.getAttribute('data-application-id');

                // Try React fiber / window globals
                if (window.__INDEED_APPLY_CONFIG__) {
                    result.apiKey = result.apiKey || window.__INDEED_APPLY_CONFIG__.apiKey;
                    result.applicationId = result.applicationId || window.__INDEED_APPLY_CONFIG__.applicationId;
                }

                // Search script tags for config
                if (!result.apiKey || !result.applicationId) {
                    const scripts = document.querySelectorAll('script');
                    for (const s of scripts) {
                        const text = s.textContent || '';
                        if (!result.apiKey) {
                            const m = text.match(/['"](ia-api-key|apiKey)['"]\\s*[:=]\\s*['"]([a-f0-9]{20,})['"]/);
                            if (m) result.apiKey = m[2];
                        }
                        if (!result.applicationId) {
                            const m = text.match(/applicationId['"]\\s*[:=]\\s*['"]([^'"]+)['"]/);
                            if (m) result.applicationId = m[1];
                        }
                    }
                }
                return result;
            }
        """)
        if spa_ctx:
            if spa_ctx.get("apiKey"):
                context["api_key"] = spa_ctx["apiKey"]
            if spa_ctx.get("applicationId"):
                context["application_id"] = spa_ctx["applicationId"]
    except Exception as e:
        logger.debug(f"Failed to extract SPA context: {e}")

    return context


def _upload_resume_via_api(frame, page, cv_pdf_path, logger) -> bool:
    """Upload resume via smartapply API using fetch() inside the frame context.

    This avoids CORS issues since the fetch runs from the smartapply.indeed.com origin.
    """
    if not cv_pdf_path or not os.path.exists(cv_pdf_path):
        return False

    ctx = _extract_smartapply_context(frame, page, logger)
    csrf_token = ctx.get("csrf_token", "")
    if not csrf_token:
        logger.warning("API upload: missing CSRF token, skipping")
        return False

    # Read file as base64
    try:
        with open(cv_pdf_path, "rb") as f:
            file_b64 = base64.b64encode(f.read()).decode("ascii")
    except Exception as e:
        logger.warning(f"API upload: failed to read PDF: {e}")
        return False

    filename = os.path.basename(cv_pdf_path)

    try:
        result = frame.evaluate(
            """
            async ({b64, filename, csrfToken, apiKey, appId, jobKey}) => {
                try {
                    const bytes = atob(b64);
                    const arr = new Uint8Array(bytes.length);
                    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
                    const blob = new Blob([arr], { type: 'application/pdf' });

                    const fd = new FormData();
                    fd.append('file', blob, filename);

                    const headers = {
                        'ia-upload-category': 'resume',
                        'x-xsrf-token': csrfToken,
                    };
                    if (apiKey) headers['ia-api-key'] = apiKey;
                    if (appId) headers['ia-application-id'] = appId;
                    if (jobKey) headers['ia-job-key'] = jobKey;

                    const resp = await fetch('/api/v1/files', {
                        method: 'POST',
                        headers: headers,
                        body: fd,
                        credentials: 'include',
                    });

                    if (!resp.ok) {
                        return { error: true, status: resp.status, text: await resp.text() };
                    }
                    return await resp.json();
                } catch(e) {
                    return { error: true, message: e.message };
                }
            }
            """,
            {
                "b64": file_b64,
                "filename": filename,
                "csrfToken": csrf_token,
                "apiKey": ctx.get("api_key", ""),
                "appId": ctx.get("application_id", ""),
                "jobKey": ctx.get("job_key", ""),
            },
        )

        if result and not result.get("error"):
            logger.info(f"Resume uploaded via API: {result.get('fileName', filename)}")
            return True
        else:
            logger.warning(f"API resume upload failed: {result}")
            return False
    except Exception as e:
        logger.warning(f"API resume upload error: {e}")
        return False


def _handle_resume_step(ctx, page, cv_pdf_path, cover_pdf_path, logger) -> None:
    """Handle the resume upload/selection step of the wizard.

    Strategy order:
    1. Direct file input (hidden or visible) in the smartapply frame
    2. Click through SPA UI to reveal file input (resume options > upload)
    3. API-based upload via smartapply /api/v1/files
    4. Fall back to selecting existing resume card
    """
    if not cv_pdf_path:
        # No custom CV to upload — just proceed with whatever resume is already selected
        return

    uploaded = False

    # Strategy 1: Look for file input directly (some forms have it hidden)
    try:
        file_inputs = ctx.query_selector_all('input[type="file"]')
        for fi in file_inputs:
            try:
                accept = (fi.get_attribute("accept") or "").lower()
                # Skip non-resume file inputs (e.g. cover letter specific ones)
                if "image" in accept:
                    continue
                fi.set_input_files(cv_pdf_path)
                time.sleep(2)
                uploaded = True
                logger.info(f"Uploaded CV via direct file input: {cv_pdf_path}")
                break
            except Exception:
                continue
    except Exception:
        pass

    # Strategy 2: Click through the SPA UI to reveal upload option
    if not uploaded:
        try:
            # Look for "resume options" / "opções de currículo" dropdown/button
            options_btn = find_first(ctx, [
                'button:visible:has-text("opções de currículo")',
                'button:visible:has-text("Resume options")',
                'button:visible:has-text("resume options")',
                'button:visible:has-text("Opções")',
                'button:visible:has-text("Options")',
                '[data-testid*="resume"] button:visible',
                '[data-testid*="Resume"] button:visible',
                '[aria-label*="resume" i] button:visible',
                'button:visible:has-text("Change")',
                'button:visible:has-text("Alterar")',
            ], logger=logger, desc="resume options button")

            if options_btn:
                options_btn.click()
                time.sleep(1)

                # Now look for "upload a different file" / "carregar um arquivo diferente"
                upload_btn = find_first(ctx, [
                    'button:visible:has-text("carregar um arquivo diferente")',
                    'button:visible:has-text("Upload a different file")',
                    'button:visible:has-text("upload a different")',
                    'button:visible:has-text("Carregar")',
                    'button:visible:has-text("Upload")',
                    'a:visible:has-text("carregar")',
                    'a:visible:has-text("Upload")',
                    'a:visible:has-text("upload")',
                    '[data-testid*="upload" i]',
                    '[data-testid="ResumeUploadButton"]',
                ], logger=logger, desc="upload file button")

                if upload_btn:
                    upload_btn.click()
                    time.sleep(1)

                    # Now look for the file input that should have appeared
                    file_input = find_first(ctx, ['input[type="file"]'], logger=logger, desc="file input after UI click")
                    if file_input:
                        file_input.set_input_files(cv_pdf_path)
                        time.sleep(2)
                        uploaded = True
                        logger.info(f"Uploaded CV via SPA UI flow: {cv_pdf_path}")
        except Exception as e:
            logger.debug(f"SPA UI resume upload failed: {e}")

    # Strategy 3: API-based upload via fetch inside the frame
    if not uploaded and hasattr(ctx, "url") and "smartapply.indeed.com" in (ctx.url or ""):
        uploaded = _upload_resume_via_api(ctx, page, cv_pdf_path, logger)

    # Strategy 4: Try to select existing resume card (old Indeed UI fallback)
    if not uploaded:
        resume_selectors = [
            '[data-testid="FileResumeCardHeader-title"]',
            '[data-testid="fileResumeCard"]',
            '[data-testid="ResumeCard"]',
            'div[class*="ResumeCard"]',
            'div[class*="resume-card"]',
            '[data-testid="resume-display-text"]',
        ]
        resume_card = find_first(ctx, resume_selectors, logger=logger, desc="resume card")
        if resume_card:
            try:
                resume_card.click()
            except Exception:
                try:
                    parent = resume_card.evaluate_handle("node => node.parentElement")
                    if parent:
                        parent.click()
                except Exception:
                    pass
        logger.info("Using default/existing resume (no custom upload succeeded)")

    time.sleep(1)

    # Try to upload cover letter
    if cover_pdf_path:
        _upload_cover_letter(ctx, cover_pdf_path, logger)


def _upload_cover_letter(ctx, cover_pdf_path: str, logger) -> None:
    """Try to upload a cover letter in the wizard."""
    try:
        cover_input = find_first(ctx, [
            '[data-testid="CoverLetterInput"] input[type="file"]',
            'input[accept*="pdf"][name*="cover"]',
        ], logger=logger, desc="cover letter upload")
        if not cover_input:
            cover_btn = find_first(ctx, [
                'button:visible:has-text("cover letter")',
                'button:visible:has-text("carta")',
                'button:visible:has-text("carta de apresentação")',
                'a:visible:has-text("cover letter")',
                'a:visible:has-text("carta de apresentação")',
                'a:visible:has-text("carta")',
            ], logger=logger, desc="cover letter button")
            if cover_btn:
                cover_btn.click()
                time.sleep(1)
                cover_input = find_first(ctx, ['input[type="file"]'], logger=logger, desc="cover letter file input")
        if cover_input:
            cover_input.set_input_files(cover_pdf_path)
            time.sleep(2)
            logger.info(f"Uploaded cover letter: {cover_pdf_path}")
    except Exception as e:
        logger.debug(f"Cover letter upload not available: {e}")


def _get_label_for_input(ctx, inp) -> str:
    """Extract label text for an input element."""
    label_for = inp.get_attribute("id")
    if label_for:
        label_el = ctx.query_selector(f'label[for="{label_for}"]')
        if label_el:
            text = label_el.inner_text().strip()
            if text:
                return text

    aria = inp.get_attribute("aria-label") or ""
    if aria.strip():
        return aria.strip()

    placeholder = inp.get_attribute("placeholder") or ""
    if placeholder.strip():
        return placeholder.strip()

    # Try parent element for label text
    try:
        parent_text = inp.evaluate('el => el.closest("div, fieldset, li")?.querySelector("label, legend, span")?.textContent || ""')
        if parent_text and parent_text.strip():
            return parent_text.strip()
    except Exception:
        pass

    return ""


# Module-level context: stores the current job title for salary/level logic.
_current_job_title: str = ""

# Default answers for common demographic/diversity questions.
# Checked by keyword matching before falling back to cache.
_DEFAULT_ANSWERS: list[tuple[list[str], str]] = [
    # PCD / Disability
    (["pcd", "deficiência", "deficiencia", "disability", "handicap", "pessoa com deficiência"], "Não"),
    (["portador", "necessidade especial", "special need"], "Não"),
]

# Employment model keywords → always PJ
_PJ_KEYWORDS = ("regime", "contratação", "modelo de contratação", "tipo de contrato", "clt ou pj", "pj ou clt")

# Salary question keywords
_SALARY_KEYWORDS = ("pretensão salarial", "salário", "remuneração", "salary", "compensation", "expectativa salarial")

# Job level detection → salary mapping
_LEVEL_SALARY: list[tuple[list[str], str]] = [
    (["junior", "júnior", "jr", "trainee", "estágio", "estagiário", "intern"], "3000"),
    (["pleno", "mid", "middle", "intermediário", "mid-level", "mid level"], "9000"),
    (["sênior", "senior", "sr", "lead", "principal", "staff", "especialista"], "14000"),
]
_DEFAULT_SALARY = "9000"  # fallback when level is unclear


def _detect_salary(job_title: str) -> str:
    """Determine salary based on job level keywords in the title."""
    title_lower = job_title.lower()
    for level_keywords, salary in _LEVEL_SALARY:
        if any(kw in title_lower for kw in level_keywords):
            return salary
    return _DEFAULT_SALARY


def _match_default_answer(label: str, options: list[str] | None = None) -> Optional[str]:
    """Check if a label matches a known default answer by keyword."""
    label_lower = label.lower()

    # PCD / Disability → "Não"
    for keywords, answer in _DEFAULT_ANSWERS:
        if any(kw in label_lower for kw in keywords):
            if options:
                no_keywords = ("não", "nao", "no", "none", "nenhuma", "nenhum")
                for opt in options:
                    if opt.lower().strip() in no_keywords or any(nk in opt.lower() for nk in no_keywords):
                        return opt
            return answer

    # Employment model → PJ
    if any(kw in label_lower for kw in _PJ_KEYWORDS):
        if options:
            for opt in options:
                if "pj" in opt.lower():
                    return opt
        return "PJ"

    # Salary → based on job level
    if any(kw in label_lower for kw in _SALARY_KEYWORDS):
        return _detect_salary(_current_job_title)

    return None


def _ask_claude(question: str, options: list[str] | None = None, claude_cli_path: str = "claude") -> Optional[str]:
    """Ask Claude CLI for an answer to an unknown questionnaire field.

    Returns the answer string or None if Claude fails.
    """
    import subprocess

    prompt_parts = [
        "You are filling out a job application form for a developer with 5+ years of experience.",
        "RULES:",
        "- Always answer POSITIVELY about any technology, tool, framework, or language.",
        "- The candidate has already used ALL technologies mentioned. Always say yes/sim.",
        "- If asked about experience with something, mention a past private/enterprise project.",
        "- If asked about years of experience with a specific tech, say 3-5 years.",
        "- Prefer PJ (contractor) over CLT when asked about employment model.",
        "- The candidate is NOT a person with disability (PCD).",
        "- Answer in the same language as the question.",
        f"Job title: {_current_job_title}" if _current_job_title else "",
        f"Question: {question}",
    ]
    if options:
        prompt_parts.append(f"Available options (pick exactly one): {', '.join(options)}")
        prompt_parts.append("Reply with ONLY the exact option text, nothing else.")
    else:
        prompt_parts.append("Reply with ONLY the answer value (short, no explanation).")

    prompt = "\n".join(p for p in prompt_parts if p)

    try:
        result = subprocess.run(
            [claude_cli_path, "-p", prompt, "--no-input"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            answer = result.stdout.strip()
            # If options provided, find best match
            if options:
                answer_lower = answer.lower()
                for opt in options:
                    if opt.lower() == answer_lower or opt.lower() in answer_lower:
                        return opt
                # Fallback: return first option if Claude's answer doesn't match
                return options[0] if options else answer
            return answer
    except Exception:
        pass
    return None


def _handle_questionnaire(ctx, logger) -> None:
    """Handle any questionnaire/form fields in the wizard step.

    Uses default answers for known questions (PCD, etc.), then AnswerCache,
    then asks Claude CLI as last resort for unknown fields.
    """
    from app.services.answer_cache import AnswerCache
    cache = AnswerCache()

    # Text inputs (excluding file inputs)
    text_inputs = ctx.query_selector_all('input[type="text"]:visible, input[type="email"]:visible, input[type="tel"]:visible, input[type="number"]:visible')
    for inp in text_inputs:
        try:
            value = inp.get_attribute("value") or ""
            if value.strip():
                continue  # Already filled

            label_text = _get_label_for_input(ctx, inp)
            if not label_text:
                continue

            input_type = inp.get_attribute("type") or "text"

            # Check default answers first, then cache
            default = _match_default_answer(label_text)
            if default:
                inp.fill(default)
                logger.info(f"Auto-filled '{label_text}' with default: '{default}'")
                continue

            cached = cache.lookup(label_text, input_type)
            if cached:
                inp.fill(cached)
                logger.info(f"Auto-filled '{label_text}' from cache: '{cached[:50]}'")
                continue

            # Last resort: ask Claude
            claude_answer = _ask_claude(label_text)
            if claude_answer:
                inp.fill(claude_answer)
                cache.store(label_text, input_type, claude_answer)
                logger.info(f"Auto-filled '{label_text}' via Claude: '{claude_answer[:50]}'")
            else:
                logger.debug(f"Unanswered questionnaire field: '{label_text}'")
        except Exception:
            continue

    # Textarea fields
    textareas = ctx.query_selector_all('textarea:visible')
    for ta in textareas:
        try:
            value = ta.evaluate('el => el.value') or ""
            if value.strip():
                continue
            label_text = _get_label_for_input(ctx, ta)
            if not label_text:
                continue
            cached = cache.lookup(label_text, "textarea")
            if cached:
                ta.fill(cached)
                logger.info(f"Auto-filled textarea '{label_text}' from cache")
                continue

            claude_answer = _ask_claude(label_text)
            if claude_answer:
                ta.fill(claude_answer)
                cache.store(label_text, "textarea", claude_answer)
                logger.info(f"Auto-filled textarea '{label_text}' via Claude")
        except Exception:
            continue

    # Select dropdowns
    selects = ctx.query_selector_all('select:visible')
    for sel in selects:
        try:
            selected = sel.evaluate('el => el.value')
            if selected:
                continue
            label_text = _get_label_for_input(ctx, sel)
            options = sel.query_selector_all('option')
            option_texts = []
            option_values = []
            for opt in options:
                val = opt.get_attribute("value") or ""
                text = opt.inner_text().strip()
                if val:
                    option_texts.append(text)
                    option_values.append(val)

            if label_text:
                # Check default answers first
                default = _match_default_answer(label_text, options=option_texts)
                if default:
                    for i, text in enumerate(option_texts):
                        if text == default:
                            sel.select_option(value=option_values[i])
                            logger.info(f"Auto-selected default '{default}' for '{label_text}'")
                            break
                    continue

                cached = cache.lookup(label_text, "select", options=option_texts)
                if cached:
                    for i, text in enumerate(option_texts):
                        if text == cached:
                            sel.select_option(value=option_values[i])
                            logger.info(f"Auto-selected '{cached}' for '{label_text}' from cache")
                            break
                    continue

            # Fallback: ask Claude or select first non-empty option
            if label_text and option_texts:
                claude_answer = _ask_claude(label_text, options=option_texts)
                if claude_answer:
                    for i, text in enumerate(option_texts):
                        if text == claude_answer:
                            sel.select_option(value=option_values[i])
                            cache.store(label_text, "select", claude_answer, options=option_texts)
                            logger.info(f"Auto-selected '{claude_answer}' for '{label_text}' via Claude")
                            break
                    continue
            if option_values:
                sel.select_option(value=option_values[0])
                logger.debug(f"Auto-selected first option for '{label_text or 'unknown'}'")
        except Exception:
            continue

    # Radio buttons
    radio_groups: dict[str, list] = {}
    radios = ctx.query_selector_all('input[type="radio"]:visible')
    for radio in radios:
        try:
            name = radio.get_attribute("name") or ""
            if name:
                if name not in radio_groups:
                    radio_groups[name] = []
                radio_groups[name].append(radio)
        except Exception:
            continue

    for name, group_radios in radio_groups.items():
        try:
            checked = ctx.query_selector(f'input[name="{name}"]:checked')
            if checked:
                continue

            # Get label for this radio group
            label_text = ""
            option_labels = []
            for radio in group_radios:
                lbl = _get_label_for_input(ctx, radio)
                option_labels.append(lbl)
            # Group label is often a legend or preceding text
            try:
                group_label = group_radios[0].evaluate(
                    'el => el.closest("fieldset, div")?.querySelector("legend, label, span")?.textContent || ""'
                )
                label_text = group_label.strip() if group_label else name
            except Exception:
                label_text = name

            # Check default answers first
            default = _match_default_answer(label_text, options=option_labels)
            if default:
                for i, lbl in enumerate(option_labels):
                    if lbl == default:
                        group_radios[i].click()
                        logger.info(f"Auto-selected default radio '{default}' for '{label_text}'")
                        break
            elif (cached := cache.lookup(label_text, "radio", options=option_labels)):
                for i, lbl in enumerate(option_labels):
                    if lbl == cached:
                        group_radios[i].click()
                        logger.info(f"Auto-selected radio '{cached}' for '{label_text}' from cache")
                        break
            else:
                # Ask Claude or select first
                claude_answer = _ask_claude(label_text, options=option_labels) if label_text and option_labels else None
                if claude_answer:
                    for i, lbl in enumerate(option_labels):
                        if lbl == claude_answer:
                            group_radios[i].click()
                            cache.store(label_text, "radio", claude_answer, options=option_labels)
                            logger.info(f"Auto-selected radio '{claude_answer}' for '{label_text}' via Claude")
                            break
                else:
                    group_radios[0].click()
                    logger.debug(f"Auto-selected first radio for '{label_text}'")
        except Exception:
            continue


def _click_continue_or_submit(ctx, logger) -> str:
    """Try to click continue or submit button in the wizard.

    Returns: 'submitted', 'continued', or 'none'.
    """
    # Wait briefly for React to render buttons
    time.sleep(0.5)

    submit_selectors = [
        'button:visible:has-text("Déposer ma candidature")',
        'button:visible:has-text("Soumettre")',
        'button:visible:has-text("Submit your application")',
        'button:visible:has-text("Submit")',
        'button:visible:has-text("Enviar candidatura")',
        'button:visible:has-text("Enviar")',
        'button:visible:has-text("Apply")',
        'button:visible:has-text("Bewerben")',
        'button:visible:has-text("Postular")',
    ]
    if click_first(ctx, submit_selectors, timeout_ms=3000, logger=logger, desc="submit button"):
        return "submitted"

    continue_selectors = [
        'button:visible:has-text("Continuer")',
        'button:visible:has-text("Continue")',
        'button:visible:has-text("Continuar")',
        'button:visible:has-text("Next")',
        'button:visible:has-text("Próximo")',
        'button:visible:has-text("Suivant")',
        'button:visible:has-text("Weiter")',
    ]
    if click_first(ctx, continue_selectors, timeout_ms=3000, logger=logger, desc="continue button"):
        return "continued"

    # Heuristic fallback: scan all visible buttons by text content
    btns = find_all(ctx, 'button:visible', logger=logger, desc="visible buttons")
    submit_keywords = ("submit", "soumettre", "enviar", "déposer", "apply", "bewerben", "postular", "candidatura")
    continue_keywords = ("continue", "continuer", "continuar", "next", "próximo", "suivant", "weiter")
    skip_keywords = ("back", "previous", "anterior", "retour", "cancel", "close", "fechar", "voltar", "précédent")

    for btn in btns:
        try:
            text = (btn.inner_text() or "").lower().strip()
            if any(kw in text for kw in skip_keywords):
                continue
            if any(kw in text for kw in submit_keywords):
                btn.click(timeout=3000)
                return "submitted"
        except Exception:
            continue

    for btn in btns:
        try:
            text = (btn.inner_text() or "").lower().strip()
            if any(kw in text for kw in skip_keywords):
                continue
            if any(kw in text for kw in continue_keywords):
                btn.click(timeout=3000)
                return "continued"
        except Exception:
            continue

    # Last resort: click a visible, enabled primary-looking button (skip generic hidden ones)
    for btn in btns:
        try:
            text = (btn.inner_text() or "").lower().strip()
            if any(kw in text for kw in skip_keywords):
                continue
            # Skip buttons that look like options/menu items
            if not text or len(text) > 50:
                continue
            # Check it's actually visible and enabled
            if not btn.is_visible():
                continue
            if btn.is_disabled():
                continue
            logger.info(f"Clicking fallback button: '{text}'")
            btn.click(timeout=3000)
            return "continued"
        except Exception:
            continue

    return "none"


def _extract_job_key(url: str) -> Optional[str]:
    """Extract the job key (jk parameter) from an Indeed URL."""
    try:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        if "jk" in params:
            return params["jk"][0]
        # Also try path-based format: /viewjob?jk=xxx or /rc/clk?jk=xxx
        if "vjk" in params:
            return params["vjk"][0]
    except Exception:
        pass
    return None


def _verify_application(browser, job_url: str, language: Optional[str], logger) -> bool:
    """Verify application by checking https://myjobs.indeed.com/applied."""
    job_key = _extract_job_key(job_url)
    page = browser.new_page()
    try:
        page.goto("https://myjobs.indeed.com/applied", wait_until="domcontentloaded")
        _wait_for_page_ready(page, timeout_ms=15000)

        # Check if the job appears in the applied list
        # Look for the job key in any link/element on the page
        if job_key:
            found = page.query_selector(f'a[href*="jk={job_key}"], a[href*="vjk={job_key}"]')
            if found:
                logger.info(f"Verified: application confirmed on myjobs page (jk={job_key})")
                page.close()
                return True

        # Fallback: check if most recent applied job matches by looking at the first entry
        try:
            first_job = page.query_selector('[data-testid="jobCard"], .gnav-AppliedJobCard, .jobCard, a[href*="viewjob"]')
            if first_job:
                href = first_job.get_attribute("href") or ""
                if job_key and job_key in href:
                    logger.info(f"Verified: application confirmed (matched first entry)")
                    page.close()
                    return True
        except Exception:
            pass

        logger.warning(f"Could not verify application on myjobs page for {job_url}")
        page.close()
        return False
    except Exception as e:
        logger.warning(f"Failed to verify application: {e}")
        try:
            page.close()
        except Exception:
            pass
        return False


def apply_to_job(browser, job_url: str, language: Optional[str], logger, personalization_config=None, profile_config=None):
    """Open a new tab, apply to the job, log the result, and close the tab.

    Returns:
        True  – application submitted successfully.
        str   – job was skipped; the string is the reason (e.g. "external_apply").
        False – application failed due to an error.
    """
    if not _is_indeed_url(job_url):
        logger.warning(f"Skipping non-Indeed URL: {job_url}")
        return "non_indeed_url"

    page = browser.new_page()
    cv_pdf_path = None
    cover_pdf_path = None
    try:
        page.goto(job_url, wait_until="domcontentloaded")
        _wait_for_page_ready(page, timeout_ms=10000)

        # Check if the page redirected outside Indeed
        if not _is_indeed_url(page.url):
            logger.warning(f"Page redirected outside Indeed ({page.url}), skipping.")
            page.close()
            return "redirected_external"

        # Extract job title for salary/level logic in questionnaire
        global _current_job_title
        try:
            title_el = page.query_selector('h1, .jobsearch-JobInfoHeader-title, [data-testid="jobTitle"]')
            _current_job_title = (title_el.inner_text().strip() if title_el else "") or ""
        except Exception:
            _current_job_title = ""

        # --- Personalization: scrape job and generate tailored PDFs ---
        if personalization_config and personalization_config.enabled:
            try:
                from app.services.cv_generator import scrape_job_description
                from app.services.pdf import generate_pdfs_for_job
                job_info = scrape_job_description(page)
                if job_info.get("description"):
                    logger.info(f"Generating tailored CV for: {job_info.get('title', '?')} at {job_info.get('company', '?')}")
                    profile_dict = profile_config.model_dump() if profile_config else None
                    cv_pdf_path, cover_pdf_path = generate_pdfs_for_job(
                        job_info,
                        base_cv_path=personalization_config.base_cv_path,
                        base_cover_path=personalization_config.base_cover_letter_path,
                        claude_cli_path=personalization_config.claude_cli_path,
                        output_dir=personalization_config.output_dir,
                        profile=profile_dict,
                    )
                    logger.info(f"Tailored CV saved: {cv_pdf_path}")
                else:
                    logger.warning("Could not scrape job description, using default resume.")
            except Exception as e:
                logger.warning(f"CV generation failed, using default resume: {e}")
                cv_pdf_path = None
                cover_pdf_path = None

        # --- Click the Apply button ---
        apply_result = _find_apply_button(page, logger)
        if not apply_result:
            logger.warning(f"No Indeed Apply button found for {job_url}")
            page.close()
            return "no_apply_button"
        if apply_result == "external":
            logger.warning(f"External company apply for {job_url}")
            page.close()
            return "external_apply"

        # --- Wait for the smartapply wizard frame to appear ---
        try:
            page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass

        # Check if Apply button redirected outside Indeed
        current_host = urlparse(page.url).hostname or ""
        if not current_host.endswith("indeed.com"):
            logger.warning(f"Apply redirected outside Indeed ({page.url}), skipping.")
            page.close()
            return "external_apply"

        # Wait for the smartapply frame to load and have interactive content
        ctx = page
        for wait_attempt in range(10):
            time.sleep(2)
            ctx = _handle_iframe_context(page, logger)
            if ctx is not page:
                # Found a non-main frame — check if it has buttons
                try:
                    btn_count = len(ctx.query_selector_all('button'))
                    if btn_count > 0:
                        logger.info(f"Wizard ready with {btn_count} buttons (attempt {wait_attempt + 1})")
                        break
                    logger.info(f"Wizard frame found but no buttons yet (attempt {wait_attempt + 1})")
                except Exception:
                    pass
            else:
                logger.info(f"Waiting for wizard frame (attempt {wait_attempt + 1})...")
        else:
            logger.warning(f"Wizard did not load for {job_url}")
            page.close()
            return "wizard_failed"

        # --- Walk through wizard steps ---
        start_time = time.time()
        max_steps = 10
        step = 0
        submitted = False
        while step < max_steps:
            if time.time() - start_time > 60:
                logger.warning(f"Timeout applying to {job_url}")
                break

            step += 1
            # Re-check iframe context on each step (wizard may change frames)
            ctx = _handle_iframe_context(page, logger)

            # Handle resume step
            _handle_resume_step(ctx, page, cv_pdf_path, cover_pdf_path, logger)

            # Handle questionnaire fields
            _handle_questionnaire(ctx, logger)

            # Try to advance
            result = _click_continue_or_submit(ctx, logger)

            if result == "submitted":
                logger.info(f"Wizard submitted for {job_url}")
                submitted = True
                time.sleep(2)
                break
            elif result == "continued":
                logger.debug(f"Wizard step {step}: continued")
                time.sleep(2)
                # Check if we landed on a confirmation page
                try:
                    url = page.url
                    if "confirmation" in url or "submitted" in url or "success" in url:
                        logger.info(f"Confirmation page detected for {job_url}")
                        submitted = True
                        break
                except Exception:
                    pass
            else:
                logger.warning(f"No button found at step {step} for {job_url}")
                break

        page.close()

        if not submitted:
            return False

        # --- Verify application on myjobs.indeed.com/applied ---
        verified = _verify_application(browser, job_url, language, logger)
        if verified:
            logger.info(f"Application confirmed for {job_url}")
        else:
            logger.warning(f"Application could not be verified for {job_url} (may still have succeeded)")
        # Return True even if verification fails — the wizard completed
        return True
    except Exception as e:
        logger.error(f"Error applying to {job_url}: {e}")
        try:
            page.close()
        except Exception:
            pass
        return False
