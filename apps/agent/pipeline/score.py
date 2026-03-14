"""Stage 3: Score jobs against candidate profile using AI."""

from __future__ import annotations

import json
import logging
import sqlite3

from apps.backend.ai_provider import extract_json, get_provider
from apps.agent.config import MODEL_FAST
from apps.agent.db import get_jobs, update_job, log_event

logger = logging.getLogger(__name__)


def run(db: sqlite3.Connection, profile: dict, threshold: int = 40) -> int:
    """Score enriched jobs. Returns count of scored jobs."""
    jobs = get_jobs(db, status="enriched")
    scored = 0
    ai = get_provider()

    # Build a short candidate summary once
    cv_short = profile.get("base_cv", "")[:800]
    candidate = f"Name: {profile.get('name','N/A')}, Location: {profile.get('location','N/A')}\n{cv_short}"

    for job in jobs:
        desc = (job["description"] or "")[:1500]
        if not desc:
            update_job(db, job["id"], status="skipped", score=0, score_reason="No description")
            continue

        prompt = (
            f"Score 0-100 job-candidate match. Reply ONLY with JSON.\n\n"
            f"Job: {job['title']} at {job['company']} ({job['location'] or 'N/A'})\n"
            f"Description: {desc}\n\n"
            f"Candidate: {candidate}\n\n"
            f'Reply ONLY: {{"score": N, "reason": "..."}}'
        )

        try:
            raw = ai.complete(prompt, model=MODEL_FAST)
            result = extract_json(raw)
            score = int(result["score"])
            reason = result.get("reason", "")

            if score < threshold:
                update_job(db, job["id"], score=score, score_reason=reason, status="skipped")
                log_event(db, job["id"], "score", "info", f"Score {score} < {threshold}, skipped")
            else:
                update_job(db, job["id"], score=score, score_reason=reason, status="scored")
                log_event(db, job["id"], "score", "info", f"Score {score}: {reason}")
                scored += 1

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.warning("Score parse fail job %d: %s | raw=%s", job["id"], e, repr(raw[:120]) if 'raw' in dir() else '?')
            log_event(db, job["id"], "score", "error", f"Parse error: {e}")
            update_job(db, job["id"], status="skipped", score=0, score_reason=f"Parse error: {e}")
        except Exception as e:
            logger.error("AI scoring failed for job %d: %s", job["id"], e)
            log_event(db, job["id"], "score", "error", f"AI error: {e}")

    return scored
