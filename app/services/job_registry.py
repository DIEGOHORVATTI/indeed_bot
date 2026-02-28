"""Persistent registry of job IDs (jk) that have been processed.

Tracks two categories:
- applied: jobs where the application was successfully submitted.
- skipped: jobs that were skipped (external apply, wizard failure, etc.)
  with a reason string so we know *why* they were skipped.

Both categories are skipped in future cycles to avoid wasting time.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional, Set

_REGISTRY_FILE = Path(__file__).parent.parent.parent / "job_registry.json"


class JobRegistry:
    """Thread-unsafe, single-process job registry backed by a JSON file."""

    def __init__(self, path: Path = _REGISTRY_FILE) -> None:
        self._path = path
        self._applied: Set[str] = set()
        self._skipped: Dict[str, str] = {}  # jk -> reason
        self._load()

    # ── public API ──────────────────────────────────────────────

    def is_known(self, job_key: str) -> bool:
        """Return True if this job key has already been processed (applied or skipped)."""
        return job_key in self._applied or job_key in self._skipped

    def mark_applied(self, job_key: str) -> None:
        self._applied.add(job_key)
        # If it was previously skipped, promote to applied
        self._skipped.pop(job_key, None)
        self._save()

    def mark_skipped(self, job_key: str, reason: str) -> None:
        if job_key in self._applied:
            return  # already applied, don't demote
        self._skipped[job_key] = reason
        self._save()

    @property
    def applied_count(self) -> int:
        return len(self._applied)

    @property
    def skipped_count(self) -> int:
        return len(self._skipped)

    def status_of(self, job_key: str) -> Optional[str]:
        """Return 'applied', 'skipped:<reason>', or None."""
        if job_key in self._applied:
            return "applied"
        if job_key in self._skipped:
            return f"skipped:{self._skipped[job_key]}"
        return None

    # ── persistence ─────────────────────────────────────────────

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text())
            self._applied = set(data.get("applied", []))
            self._skipped = dict(data.get("skipped", {}))
        except Exception:
            pass

    def _save(self) -> None:
        data = {
            "applied": sorted(self._applied),
            "skipped": dict(sorted(self._skipped.items())),
        }
        self._path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
