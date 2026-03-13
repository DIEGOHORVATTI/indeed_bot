"""Pipeline orchestrator — runs stages in sequence with optional looping."""

from __future__ import annotations

import logging
import time

from rich.console import Console
from rich.logging import RichHandler

from apps.agent.config import CHROME_PROFILE_DIR, load_profile, load_searches
from apps.agent.db import get_db, get_stats, init_db
from apps.agent.notifications import notify

logger = logging.getLogger(__name__)

STAGES = ["discover", "enrich", "score", "tailor", "cover", "apply"]
CYCLE_INTERVAL = 30 * 60  # 30 minutes


def _run_stage(
    stage: str, db, profile: dict, searches: dict, dry_run: bool, sandbox=None,
) -> int:
    """Run a single pipeline stage. Returns count of processed items."""
    if stage == "discover":
        from apps.agent.pipeline.discover import run
        return run(searches, db)
    elif stage == "enrich":
        from apps.agent.pipeline.enrich import run
        return run(db)
    elif stage == "score":
        from apps.agent.pipeline.score import run
        threshold = searches.get("score_threshold", 40)
        return run(db, profile, threshold=threshold)
    elif stage == "tailor":
        from apps.agent.pipeline.tailor import run
        return run(db, profile)
    elif stage == "cover":
        from apps.agent.pipeline.cover import run
        return run(db, profile)
    elif stage == "apply":
        from apps.agent.pipeline.apply import run
        return run(db, profile, dry_run=dry_run, sandbox=sandbox)
    else:
        raise ValueError(f"Unknown stage: {stage}")


def run_pipeline(
    stage: str | None = None,
    once: bool = False,
    dry_run: bool = False,
    sandbox: bool = False,
) -> None:
    """Run the full pipeline or a single stage."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(rich_tracebacks=True)],
    )

    console = Console()
    init_db()
    db = get_db()
    profile = load_profile()
    searches = load_searches()

    stages = [stage] if stage else STAGES
    sandbox_browser = None

    # ── Start sandbox if requested ──
    if sandbox:
        from apps.agent.browser.sandbox import BrowserSandbox
        from apps.agent.dashboard.server import start_dashboard

        start_dashboard()
        console.print("\n[bold green]Dashboard → http://localhost:8080[/bold green]\n")

        sandbox_browser = BrowserSandbox(str(CHROME_PROFILE_DIR))
        sandbox_browser.start()

    try:
        while True:
            console.rule("[bold blue]JobPilot Pipeline Cycle")

            for s in stages:
                console.print(f"\n[bold cyan]▶ Stage: {s}[/bold cyan]")
                try:
                    count = _run_stage(
                        s, db, profile, searches, dry_run, sandbox=sandbox_browser,
                    )
                    console.print(f"  [green]✓ {s}: processed {count} jobs[/green]")
                except Exception as e:
                    console.print(f"  [red]✗ {s}: {e}[/red]")
                    logger.exception("Stage %s failed", s)

            # Summary
            stats = get_stats(db)
            console.print("\n[bold]Pipeline Summary:[/bold]")
            for status, count in stats:
                console.print(f"  {status}: {count}")

            notify("JobPilot", f"Cycle complete — {', '.join(f'{s}: {c}' for s, c in stats)}")

            if once:
                break

            console.print(f"\n[dim]Next cycle in {CYCLE_INTERVAL // 60} minutes...[/dim]")
            time.sleep(CYCLE_INTERVAL)
    finally:
        if sandbox_browser:
            sandbox_browser.stop()
