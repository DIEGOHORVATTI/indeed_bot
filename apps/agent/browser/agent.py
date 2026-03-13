"""AI-driven browser agent — reads page, asks AI for next action, executes."""

from __future__ import annotations

import json
import logging
import time

from apps.agent.browser.sandbox import BrowserSandbox
from apps.agent.config import MODEL_FAST
from apps.agent.dashboard.events import EventBus
from apps.backend.ai_provider import get_provider

logger = logging.getLogger(__name__)

MAX_STEPS = 30


def _build_prompt(
    job: dict,
    profile: dict,
    page_context: str,
    step: int,
    history: list[dict],
    cv_path: str,
    cover_path: str,
    dry_run: bool,
) -> str:
    submit = (
        "DO NOT click the final submit button. Stop before submission."
        if dry_run
        else "Click the submit/apply button when all fields are filled."
    )

    hist = ""
    if history:
        lines = [
            f"  {h['step']}: {h['action']} {h.get('selector','')} {h.get('value','')}"
            for h in history[-8:]
        ]
        hist = "\n\nPREVIOUS ACTIONS:\n" + "\n".join(lines)

    return f"""You are a browser agent applying to a job. Decide the next action based on the page state.

JOB: {job.get('title','')} at {job.get('company','')}
URL: {job.get('url','')}

CANDIDATE:
  Name: {profile.get('name','')}
  Email: {profile.get('email','')}
  Phone: {profile.get('phone','')}
  Location: {profile.get('location','')}
  LinkedIn: {profile.get('linkedin','')}
  GitHub: {profile.get('github','')}

CV_PDF: {cv_path}
COVER_PDF: {cover_path}

PAGE STATE (step {step}/{MAX_STEPS}):
{page_context}{hist}

RULES:
- Use EXACT candidate data above for form fields
- For skill/technology questions → always YES, 3-5 years experience
- For salary → leave blank or "negotiable"
- Upload CV_PDF to resume/CV file inputs
- Upload COVER_PDF to cover letter file inputs
- {submit}
- If CAPTCHA detected → action "captcha"
- If login/signup required → action "login_required"
- If page has no apply form and no next step → action "failed"

RESPOND WITH ONLY JSON:
{{"thought":"what you see & plan","action":"click|fill|select|upload|wait|done|captcha|login_required|failed","selector":"CSS selector","value":"text or file path","reason":"brief"}}"""


def _parse_action(raw: str) -> dict | None:
    text = raw.strip()
    if text.startswith("```"):
        text = "\n".join(l for l in text.split("\n") if not l.startswith("```"))
    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return None


def run_agent(
    job: dict,
    profile: dict,
    cv_pdf_path: str,
    cover_pdf_path: str,
    sandbox: BrowserSandbox,
    dry_run: bool = False,
) -> dict:
    """Drive the browser to apply to a single job. Returns {status, reason}."""
    events = EventBus()
    ai = get_provider()
    history: list[dict] = []

    events.set_current_job(
        {
            "title": job.get("title", ""),
            "company": job.get("company", ""),
            "score": job.get("score"),
            "url": job.get("url", ""),
        }
    )
    events.set_status("applying")

    # Navigate
    try:
        sandbox.navigate(job["url"])
        time.sleep(2)
    except Exception as e:
        return {"status": "failed", "reason": f"Navigation failed: {e}"}

    for step in range(MAX_STEPS):
        # Pause / skip
        while events.is_paused():
            events.set_status("paused")
            time.sleep(0.5)
        events.set_status("applying")

        if events.should_skip():
            events.emit("completed", {"status": "skipped", "reason": "User skip"})
            return {"status": "skipped", "reason": "Skipped by user"}

        # Read page
        try:
            ctx = sandbox.get_page_context()
        except Exception as e:
            ctx = f"Error reading page: {e}"

        events.emit("ai_thinking", {"step": step})

        # Ask AI
        prompt = _build_prompt(
            job, profile, ctx, step, history,
            cv_pdf_path, cover_pdf_path, dry_run,
        )

        try:
            raw = ai.complete(prompt, model=MODEL_FAST)
        except Exception as e:
            logger.error("AI call failed at step %d: %s", step, e)
            events.emit("error", {"message": f"AI error: {e}"})
            continue

        action = _parse_action(raw)
        if not action:
            logger.warning("Unparseable AI response: %s", raw[:200])
            events.emit("error", {"message": "Unparseable AI response"})
            continue

        act = action.get("action", "")
        sel = action.get("selector", "")
        val = action.get("value", "")
        thought = action.get("thought", "")
        reason = action.get("reason", "")

        events.emit("ai_action", {
            "step": step, "action": act, "thought": thought,
            "selector": sel, "value": val, "reason": reason,
        })
        history.append({"step": step, "action": act, "selector": sel, "value": val})

        # Terminal actions
        if act in ("done", "applied"):
            events.emit("completed", {"status": "applied", "reason": reason})
            return {"status": "applied", "reason": reason}

        if act in ("captcha", "login_required", "antibot", "failed"):
            events.emit("completed", {"status": act, "reason": reason})
            return {"status": act, "reason": reason}

        # Execute browser action
        try:
            if act == "click":
                sandbox.click(sel)
            elif act == "fill":
                sandbox.fill(sel, val)
            elif act == "select":
                sandbox.select_option(sel, val)
            elif act == "upload":
                # Determine which PDF based on context
                lower = (sel + val + reason).lower()
                path = (
                    cover_pdf_path
                    if any(k in lower for k in ("cover", "carta", "letter"))
                    else cv_pdf_path
                )
                sandbox.upload_file(sel, path)
            elif act == "wait":
                sandbox.wait(2000)
            else:
                events.emit("error", {"message": f"Unknown action: {act}"})
        except Exception as e:
            logger.warning("Action %s on %s failed: %s", act, sel, e)
            events.emit("action_error", {
                "action": act, "selector": sel, "error": str(e),
            })

        time.sleep(1)

    return {"status": "failed", "reason": "Max steps exceeded"}
