from __future__ import annotations

import argparse
import time
from typing import List, Optional

from app.models import AppConfig
from app.services.browser import create_browser
from app.utils import (
    setup_logger,
    domain_for_language,
    collect_indeed_apply_links,
    apply_to_job,
    paginate_urls,
)


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Collect Indeed Apply links and apply to them")
    p.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    p.add_argument("--single", default=None, help="Apply to a single job URL (skips search)")
    p.add_argument("--max", type=int, default=0, help="Max number of jobs to apply to (0 = all)")
    p.add_argument("--delay", type=float, default=5.0, help="Delay between job applications (seconds)")
    args = p.parse_args(argv)

    cfg = AppConfig.load(args.config)
    language = cfg.camoufox.language

    with create_browser(cfg.camoufox) as browser:
        logger = setup_logger()
        page = browser.new_page()

        page.goto("https://" + domain_for_language(language))
        cookies = page.context.cookies()
        if not any(c.get("name") == "PPID" for c in cookies):
            print("Not logged in. Please run scripts/get_token.py to login and obtain a session.")
            return 1

        job_links: List[str] = []
        if args.single:
            job_links = [args.single]
        else:
            base_url = cfg.search.base_url
            start = cfg.search.start
            end = cfg.search.end
            urls: List[str] = paginate_urls(base_url, start, end)
            for url in urls:
                logger.info(f"Visiting URL: {url}")
                page.goto(url)
                page.wait_for_load_state("domcontentloaded")
                time.sleep(10)
                try:
                    links = collect_indeed_apply_links(page, language)
                    logger.info(f"Found {len(links)} Indeed Apply jobs on this page.")
                    job_links.extend(links)
                except Exception as e:
                    logger.error(f"Error extracting jobs on {url}: {e}")
                time.sleep(2)

        count = 0
        limit = args.max or 0
        for job_url in job_links:
            logger.info(f"Applying to: {job_url}")
            ok = apply_to_job(browser, job_url, language, logger)
            if not ok:
                logger.error(f"Failed to apply to {job_url}")
            count += 1
            if limit and count >= limit:
                break
            time.sleep(max(0.0, float(args.delay)))

        logger.info(f"Completed applying to {count} job(s)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
