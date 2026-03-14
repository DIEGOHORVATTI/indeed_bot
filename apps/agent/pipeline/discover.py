"""Stage 1: Discover jobs using python-jobspy."""

from __future__ import annotations

import logging
import sqlite3

from jobspy import scrape_jobs

from apps.agent.anti_detection import random_delay, DELAY_DISCOVER
from apps.agent.db import insert_job, log_event

logger = logging.getLogger(__name__)


def run(searches_config: dict, db: sqlite3.Connection) -> int:
    """Scrape jobs from configured sources. Returns count of new jobs inserted."""
    searches = searches_config.get("searches", [])
    total_new = 0

    for search in searches:
        query = search["query"]
        location = search.get("location", "")
        sites = search.get("sites", ["indeed"])
        hours_old = search.get("hours_old", 72)
        results_wanted = search.get("results_wanted", 30)
        country = search.get("country", "Brazil")

        logger.info("Searching: '%s' in %s on %s", query, location, sites)
        log_event(db, None, "discover", "info", f"Searching: '{query}' in {location}")

        try:
            df = scrape_jobs(
                site_name=sites,
                search_term=query,
                location=location,
                hours_old=hours_old,
                results_wanted=results_wanted,
                country_indeed=country,
            )
        except Exception as e:
            logger.error("Search failed for '%s': %s", query, e)
            log_event(db, None, "discover", "error", f"Search failed: {e}")
            continue

        if df is None or df.empty:
            logger.info("No results for '%s'", query)
            continue

        new_count = 0
        for _, row in df.iterrows():
            url = str(row.get("job_url", ""))
            if not url:
                continue

            # Build salary string from min/max amounts
            salary = None
            min_amt = row.get("min_amount")
            max_amt = row.get("max_amount")
            if min_amt and max_amt:
                salary = f"{min_amt}-{max_amt}"
            elif min_amt:
                salary = str(min_amt)
            elif max_amt:
                salary = str(max_amt)

            date_posted = str(row.get("date_posted", "")) or None

            job_id = insert_job(
                db,
                url=url,
                source=str(row.get("site", "")),
                title=str(row.get("title", "")),
                company=str(row.get("company", "")),
                location=str(row.get("location", "")),
                salary=salary,
                date_posted=date_posted,
                search_query=query,
                description=str(row.get("description", "")) or None,
            )
            if job_id:
                new_count += 1

        logger.info("Inserted %d new jobs for '%s'", new_count, query)
        log_event(db, None, "discover", "info", f"Inserted {new_count} new jobs for '{query}'")
        total_new += new_count

        random_delay(*DELAY_DISCOVER)

    return total_new
