"""CLI entrypoint for JobPilot agent."""

from __future__ import annotations

import argparse
import csv
import sys

from apps.agent.db import get_db, get_stats, init_db, reset_failed, export_jobs


def cmd_run(args: argparse.Namespace) -> None:
    from apps.agent.scheduler import run_pipeline

    run_pipeline(
        stage=args.stage,
        once=args.once,
        dry_run=args.dry_run,
        sandbox=args.sandbox,
    )


def cmd_status(_args: argparse.Namespace) -> None:
    from rich.console import Console
    from rich.table import Table

    db = get_db()
    stats = get_stats(db)

    console = Console()
    table = Table(title="JobPilot Pipeline Status")
    table.add_column("Status", style="bold")
    table.add_column("Count", justify="right")

    for status, count in stats:
        table.add_row(status, str(count))

    console.print(table)

    # Top scored jobs
    cur = db.execute(
        "SELECT title, company, score FROM jobs WHERE score IS NOT NULL ORDER BY score DESC LIMIT 10"
    )
    rows = cur.fetchall()
    if rows:
        top = Table(title="Top Scored Jobs")
        top.add_column("Title")
        top.add_column("Company")
        top.add_column("Score", justify="right")
        for title, company, score in rows:
            top.add_row(title, company, str(score))
        console.print(top)


def cmd_reset(_args: argparse.Namespace) -> None:
    db = get_db()
    count = reset_failed(db)
    print(f"Reset {count} failed jobs back to 'discovered'.")


def cmd_export(_args: argparse.Namespace) -> None:
    db = get_db()
    rows = export_jobs(db)
    if not rows:
        print("No jobs found.")
        return

    writer = csv.writer(sys.stdout)
    writer.writerow(rows[0].keys())
    for row in rows:
        writer.writerow(tuple(row))


def main() -> None:
    init_db()

    parser = argparse.ArgumentParser(prog="jobpilot", description="JobPilot AI Agent")
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    p_run = sub.add_parser("run", help="Run the pipeline")
    p_run.add_argument(
        "--stage",
        choices=["discover", "enrich", "score", "tailor", "cover", "apply"],
        help="Run only a specific stage",
    )
    p_run.add_argument("--once", action="store_true", help="Run one cycle then exit")
    p_run.add_argument("--dry-run", action="store_true", help="Don't submit applications")
    p_run.add_argument("--sandbox", action="store_true", help="Visual sandbox with web dashboard at :8080")
    p_run.set_defaults(func=cmd_run)

    # status
    p_status = sub.add_parser("status", help="Show pipeline status")
    p_status.set_defaults(func=cmd_status)

    # reset
    p_reset = sub.add_parser("reset", help="Reset failed jobs to discovered")
    p_reset.set_defaults(func=cmd_reset)

    # export
    p_export = sub.add_parser("export", help="Export jobs to CSV (stdout)")
    p_export.set_defaults(func=cmd_export)

    args = parser.parse_args()
    args.func(args)
