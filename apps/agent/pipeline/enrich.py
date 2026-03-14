"""Stage 2: Enrich job listings with full descriptions."""

from __future__ import annotations

import logging
import sqlite3

import requests
from bs4 import BeautifulSoup

from apps.agent.anti_detection import random_delay, random_user_agent, DELAY_PAGE
from apps.agent.db import get_jobs, update_job, log_event

logger = logging.getLogger(__name__)


def _extract_description(html: str) -> str | None:
    """Extract job description from HTML using a cascade of strategies."""
    soup = BeautifulSoup(html, "html.parser")

    # Strategy 1: JSON-LD JobPosting
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            import json
            data = json.loads(script.string or "")
            if isinstance(data, list):
                data = next((d for d in data if d.get("@type") == "JobPosting"), None)
            if data and data.get("@type") == "JobPosting":
                desc = data.get("description", "")
                if desc:
                    return BeautifulSoup(desc, "html.parser").get_text(separator="\n", strip=True)
        except (json.JSONDecodeError, StopIteration):
            continue

    # Strategy 2: meta description
    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content", "").strip():
        content = meta["content"].strip()
        if len(content) > 100:
            return content

    # Strategy 3: main content heuristic — look for common job description containers
    for selector in [
        "#jobDescriptionText",
        ".jobsearch-jobDescriptionText",
        '[class*="description"]',
        '[class*="jobDescription"]',
        "article",
        "main",
    ]:
        el = soup.select_one(selector)
        if el:
            text = el.get_text(separator="\n", strip=True)
            if len(text) > 100:
                return text

    # Fallback: body text
    body = soup.find("body")
    if body:
        text = body.get_text(separator="\n", strip=True)
        if len(text) > 100:
            return text[:5000]

    return None


def run(db: sqlite3.Connection) -> int:
    """Enrich jobs that lack descriptions. Returns count of enriched jobs."""
    jobs = get_jobs(db, status="discovered")
    enriched = 0

    for job in jobs:
        url = job["url"]
        logger.info("Enriching: %s", url)

        try:
            resp = requests.get(
                url,
                headers={"User-Agent": random_user_agent()},
                timeout=15,
                allow_redirects=True,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.warning("Failed to fetch %s: %s", url, e)
            log_event(db, job["id"], "enrich", "warning", f"Fetch failed: {e}")
            continue

        description = _extract_description(resp.text)
        if description:
            update_job(db, job["id"], description=description, status="enriched")
            log_event(db, job["id"], "enrich", "info", f"Enriched ({len(description)} chars)")
            enriched += 1
        else:
            logger.warning("No description found for %s", url)
            log_event(db, job["id"], "enrich", "warning", "No description extracted")
            # Move to enriched anyway so pipeline continues
            update_job(db, job["id"], status="enriched")

        random_delay(*DELAY_PAGE)

    return enriched
