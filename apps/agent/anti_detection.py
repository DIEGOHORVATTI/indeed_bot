"""Anti-detection utilities: rate limiting, delays, and randomization."""

from __future__ import annotations

import random
import time

import sqlite3

# Delay ranges in seconds
DELAY_APPLY = (45, 90)
DELAY_PAGE = (2, 5)
DELAY_DISCOVER = (3, 8)

# Rate limits
MAX_HOUR = 8
MAX_DAY = 50

_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
]

_VIEWPORTS = [
    (1366, 768),
    (1440, 900),
    (1280, 720),
    (1536, 864),
    (1920, 1080),
]


def random_delay(min_s: float, max_s: float) -> None:
    time.sleep(random.uniform(min_s, max_s))


def check_rate_limit(db: sqlite3.Connection) -> bool:
    """Return True if we can apply (under rate limits), False if throttled."""
    row = db.execute(
        "SELECT COUNT(*) as cnt FROM jobs WHERE status = 'applied' AND updated_at >= datetime('now', '-1 hour')"
    ).fetchone()
    if row["cnt"] >= MAX_HOUR:
        return False

    row = db.execute(
        "SELECT COUNT(*) as cnt FROM jobs WHERE status = 'applied' AND updated_at >= datetime('now', '-1 day')"
    ).fetchone()
    if row["cnt"] >= MAX_DAY:
        return False

    return True


def random_user_agent() -> str:
    return random.choice(_USER_AGENTS)


def random_viewport() -> tuple[int, int]:
    return random.choice(_VIEWPORTS)
