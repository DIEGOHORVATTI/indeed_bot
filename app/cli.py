from __future__ import annotations

import argparse
from typing import Optional

from app.models import AppConfig
from app.bot import IndeedBot


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        prog="indeed-bot",
        description="Indeed Auto-Apply Bot",
    )
    parser.add_argument(
        "--mode",
        choices=["full", "minimal"],
        default="full",
        help="Run mode: 'full' for two-pass paginated, 'minimal' for single-pass (default: full)",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=None,
        dest="max_applies",
        help="Max number of jobs to apply to (default: unlimited)",
    )
    parser.add_argument(
        "--config",
        default="config.yaml",
        help="Path to config.yaml (default: config.yaml)",
    )

    args = parser.parse_args(argv)
    config = AppConfig.load(args.config)
    bot = IndeedBot(config=config, max_applies=args.max_applies)
    bot.run(mode=args.mode)
