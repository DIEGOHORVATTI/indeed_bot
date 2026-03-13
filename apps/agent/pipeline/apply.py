"""Stage 6: Apply to jobs — via sandbox (visual) or Claude CLI (headless)."""

from __future__ import annotations

import logging
import sqlite3

from apps.agent.anti_detection import check_rate_limit, random_delay, DELAY_APPLY
from apps.agent.db import get_jobs, update_job, log_event
from apps.agent.notifications import notify

logger = logging.getLogger(__name__)


def _apply_one_sandbox(job, profile, sandbox, dry_run) -> dict:
    """Apply using the visual browser agent."""
    from apps.agent.browser.agent import run_agent

    return run_agent(
        job=dict(job),
        profile=profile,
        cv_pdf_path=job["cv_pdf_path"],
        cover_pdf_path=job["cover_pdf_path"],
        sandbox=sandbox,
        dry_run=dry_run,
    )


def _apply_one_cli(job, profile, dry_run) -> dict:
    """Apply using Claude CLI + Playwright MCP (headless)."""
    from apps.agent.browser.claude_runner import run_apply
    from apps.agent.browser.mcp import write_mcp_config
    from apps.agent.browser.prompts import build_apply_prompt
    from apps.agent.config import CHROME_PROFILE_DIR

    mcp_config_path = write_mcp_config(str(CHROME_PROFILE_DIR))
    prompt = build_apply_prompt(
        job=dict(job),
        profile=profile,
        cv_pdf_path=job["cv_pdf_path"],
        cover_pdf_path=job["cover_pdf_path"],
        dry_run=dry_run,
    )
    return run_apply(prompt, mcp_config_path)


def run(
    db: sqlite3.Connection,
    profile: dict,
    dry_run: bool = False,
    sandbox=None,
) -> int:
    """Apply to ready jobs. Returns count of successfully applied jobs."""
    jobs = get_jobs(db, status="ready")
    applied = 0

    for job in jobs:
        if not check_rate_limit(db):
            logger.warning("Rate limit reached, stopping apply stage")
            notify("JobPilot", "Rate limit reached", sound="Basso")
            break

        logger.info("Applying to: %s at %s", job["title"], job["company"])
        log_event(db, job["id"], "apply", "info", f"Starting (dry_run={dry_run}, sandbox={sandbox is not None})")

        try:
            if sandbox is not None:
                result = _apply_one_sandbox(job, profile, sandbox, dry_run)
            else:
                result = _apply_one_cli(job, profile, dry_run)

            status = result.get("status", "failed")
            reason = result.get("reason", "")

            if status == "applied":
                update_job(db, job["id"], status="applied")
                log_event(db, job["id"], "apply", "info", f"Applied: {reason}")
                notify("JobPilot", f"Applied to {job['title']} at {job['company']}", sound="Glass")
                applied += 1
            elif status == "skipped":
                log_event(db, job["id"], "apply", "info", f"Skipped: {reason}")
            elif status in ("captcha", "antibot", "login_required"):
                update_job(db, job["id"], status="failed", fail_reason=f"{status}: {reason}")
                log_event(db, job["id"], "apply", "warning", f"{status}: {reason}")
                notify("JobPilot", f"{status.upper()} at {job['company']}", sound="Basso")
            else:
                update_job(db, job["id"], status="failed", fail_reason=reason)
                log_event(db, job["id"], "apply", "error", f"Failed: {reason}")

        except Exception as e:
            logger.error("Apply failed for job %d: %s", job["id"], e)
            log_event(db, job["id"], "apply", "error", f"Exception: {e}")
            update_job(db, job["id"], status="failed", fail_reason=str(e))

        random_delay(*DELAY_APPLY)

    return applied
