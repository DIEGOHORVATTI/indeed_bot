"""Configuration and path constants for the agent."""

from __future__ import annotations

import json
import os
from pathlib import Path

import yaml

# Repo root: two levels up from apps/agent/config.py
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

DATA_DIR = REPO_ROOT / "apps" / "agent" / "data"
DB_PATH = DATA_DIR / "jobs.db"
PDF_DIR = DATA_DIR / "pdfs"
CHROME_PROFILE_DIR = DATA_DIR / "chrome-profile"
TEMPLATES_DIR = REPO_ROOT / "apps" / "extension" / "assets"

PROFILE_PATH = REPO_ROOT / "apps" / "agent" / "profile.json"
SEARCHES_PATH = REPO_ROOT / "apps" / "agent" / "searches.yaml"

MODEL_FAST = os.getenv("ANTHROPIC_MODEL_FAST", "claude-haiku-4-5-20251001")
MODEL_SMART = os.getenv("ANTHROPIC_MODEL_SMART", "claude-opus-4-20250514")


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    CHROME_PROFILE_DIR.mkdir(parents=True, exist_ok=True)


def load_profile() -> dict:
    if not PROFILE_PATH.exists():
        raise FileNotFoundError(
            f"Profile not found at {PROFILE_PATH}. "
            "Copy profile.example.json to profile.json and fill in your details."
        )
    return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))


def load_searches() -> dict:
    if not SEARCHES_PATH.exists():
        raise FileNotFoundError(
            f"Search config not found at {SEARCHES_PATH}. "
            "Copy searches.example.yaml to searches.yaml and configure your searches."
        )
    return yaml.safe_load(SEARCHES_PATH.read_text(encoding="utf-8"))
