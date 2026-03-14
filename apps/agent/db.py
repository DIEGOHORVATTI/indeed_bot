"""SQLite database for job tracking."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from apps.agent.config import DB_PATH, ensure_dirs

_conn: sqlite3.Connection | None = None


def get_db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        ensure_dirs()
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
        _conn.row_factory = sqlite3.Row
    return _conn


def init_db() -> None:
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            source TEXT,
            title TEXT,
            company TEXT,
            location TEXT,
            salary TEXT,
            date_posted TEXT,
            search_query TEXT,
            description TEXT,
            score INTEGER,
            score_reason TEXT,
            tailored_cv TEXT,
            cv_pdf_path TEXT,
            cover_pdf_path TEXT,
            status TEXT NOT NULL DEFAULT 'discovered',
            fail_reason TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(score);
        CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(url);

        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER REFERENCES jobs(id),
            stage TEXT NOT NULL,
            level TEXT NOT NULL DEFAULT 'info',
            message TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_logs_job ON logs(job_id);
    """)
    db.commit()


def insert_job(
    db: sqlite3.Connection,
    url: str,
    source: str,
    title: str,
    company: str,
    location: str | None = None,
    salary: str | None = None,
    date_posted: str | None = None,
    search_query: str | None = None,
    description: str | None = None,
) -> int | None:
    """Insert a job, returning its id. Returns None if URL already exists."""
    status = "enriched" if description else "discovered"
    try:
        cur = db.execute(
            """INSERT OR IGNORE INTO jobs
               (url, source, title, company, location, salary, date_posted, search_query, description, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (url, source, title, company, location, salary, date_posted, search_query, description, status),
        )
        db.commit()
        return cur.lastrowid if cur.rowcount > 0 else None
    except sqlite3.Error:
        return None


def get_jobs(db: sqlite3.Connection, status: str | None = None, limit: int = 100) -> list[sqlite3.Row]:
    if status:
        return db.execute(
            "SELECT * FROM jobs WHERE status = ? ORDER BY score DESC NULLS LAST LIMIT ?",
            (status, limit),
        ).fetchall()
    return db.execute("SELECT * FROM jobs ORDER BY score DESC NULLS LAST LIMIT ?", (limit,)).fetchall()


def update_job(db: sqlite3.Connection, job_id: int, **fields) -> None:
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [job_id]
    db.execute(f"UPDATE jobs SET {sets} WHERE id = ?", vals)
    db.commit()


def log_event(db: sqlite3.Connection, job_id: int | None, stage: str, level: str, message: str) -> None:
    db.execute(
        "INSERT INTO logs (job_id, stage, level, message) VALUES (?, ?, ?, ?)",
        (job_id, stage, level, message),
    )
    db.commit()


def get_stats(db: sqlite3.Connection) -> list[tuple[str, int]]:
    rows = db.execute("SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status ORDER BY cnt DESC").fetchall()
    return [(r["status"], r["cnt"]) for r in rows]


def reset_failed(db: sqlite3.Connection) -> int:
    cur = db.execute("UPDATE jobs SET status = 'discovered', fail_reason = NULL, updated_at = datetime('now') WHERE status = 'failed'")
    db.commit()
    return cur.rowcount


def export_jobs(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return db.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
