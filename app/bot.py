from __future__ import annotations

import time
from typing import List, Literal, Optional

from app.models import AppConfig
from app.services.browser import create_browser
from app.services.cv_generator import scrape_job_description
from app.services.pdf import generate_pdfs_for_job
from app.utils.logger import setup_logger
from app.utils.indeed import (
    domain_for_language,
    collect_indeed_apply_links,
    apply_to_job,
)
from app.utils.login import ensure_ppid_cookie
from app.utils.pagination import paginate_urls


class IndeedBot:
    def __init__(self, config: AppConfig, max_applies: Optional[int] = None) -> None:
        self.config = config
        self.max_applies = max_applies
        self.logger = setup_logger()
        self.applied_count = 0

    def run(self, mode: Literal["full", "minimal"] = "full") -> None:
        language = self.config.camoufox.language

        if self.max_applies is not None:
            self.logger.info(f"Limit: applying to at most {self.max_applies} jobs.")

        with create_browser(self.config.camoufox) as browser:
            page = browser.new_page()
            try:
                page.set_default_timeout(30_000)
                page.set_default_navigation_timeout(45_000)
            except Exception:
                pass

            base_domain = domain_for_language(language)
            page.goto(f"https://{base_domain}")

            if not ensure_ppid_cookie(page, language, wait_seconds=180):
                self.logger.error("Login not detected in time. Please run again after logging in.")
                return

            self.logger.info("Token found, proceeding with job search...")
            urls = self._build_urls()

            try:
                if mode == "minimal":
                    self._run_minimal(browser, page, urls)
                else:
                    self._run_full(browser, page, urls)

                self.logger.info(f"Done! Applied to {self.applied_count} jobs total.")
            except KeyboardInterrupt:
                self.logger.info(f"Interrupted by user. Applied to {self.applied_count} jobs.")

    def _build_urls(self) -> List[str]:
        search = self.config.search
        if search.base_urls:
            return list(search.base_urls)
        return paginate_urls(search.base_url, search.start, search.end, step=10)

    def _run_full(self, browser, page, urls: List[str]) -> None:
        """Two-pass paginated mode."""
        job_links = self._collect_jobs(page, urls)
        self.logger.info(f"Total Indeed Apply jobs found: {len(job_links)}")
        self._apply_batch(browser, job_links)

        if self.max_applies is None or self.applied_count < self.max_applies:
            job_links = self._collect_jobs(page, urls)
            self.logger.info(f"Total Indeed Apply jobs found (pass 2): {len(job_links)}")
            self._apply_batch(browser, job_links)

    def _run_minimal(self, browser, page, urls: List[str]) -> None:
        """Single-pass mode without pagination."""
        for url in urls:
            self.logger.info(f"Visiting URL: {url}")
            try:
                page.goto(url)
                page.wait_for_load_state("domcontentloaded")
            except Exception as e:
                self.logger.warning(f"Failed to load page, skipping: {e}")
                continue

            self.logger.info("Waiting for page to settle...")
            time.sleep(10)

            try:
                links = collect_indeed_apply_links(page, self.config.camoufox.language)
                self.logger.info(f"Found {len(links)} Indeed Apply jobs on this page.")
            except Exception as e:
                self.logger.error(f"Error extracting jobs: {e}")
                links = []

            self._apply_batch(browser, links)

            if self.max_applies is not None and self.applied_count >= self.max_applies:
                break

    def _collect_jobs(self, page, urls: List[str]) -> List[str]:
        language = self.config.camoufox.language
        all_job_links: List[str] = []
        for url in urls:
            self.logger.info(f"Visiting URL: {url}")
            try:
                page.goto(url)
                page.wait_for_load_state("domcontentloaded")
            except Exception as e:
                self.logger.warning(f"Failed to load page, skipping: {e}")
                continue
            self.logger.info("Waiting for page to settle...")
            time.sleep(10)
            try:
                links = collect_indeed_apply_links(page, language)
                all_job_links.extend(links)
                self.logger.info(f"Found {len(links)} Indeed Apply jobs on this page.")
            except Exception as e:
                self.logger.error(f"Error extracting jobs: {e}")
            time.sleep(5)
        return all_job_links

    def _apply_batch(self, browser, job_links: List[str]) -> None:
        language = self.config.camoufox.language
        personalization = self.config.personalization
        profile = self.config.profile

        for job_url in job_links:
            if self.max_applies is not None and self.applied_count >= self.max_applies:
                self.logger.info(f"Reached limit of {self.max_applies} applications. Stopping.")
                return

            progress = f"[{self.applied_count + 1}"
            if self.max_applies:
                progress += f"/{self.max_applies}"
            progress += f"] Applying to: {job_url}"
            self.logger.info(progress)

            success = apply_to_job(browser, job_url, language, self.logger, personalization_config=personalization, profile_config=profile)
            if success:
                self.applied_count += 1
            else:
                self.logger.error(f"Failed to apply to {job_url}")
            time.sleep(5)
