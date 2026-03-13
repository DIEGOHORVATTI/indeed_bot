"""
Abstracted AI provider – swap between Anthropic API and Claude CLI.

Set AI_PROVIDER env var to "api" or "cli" (default: "cli").
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from typing import Protocol

logger = logging.getLogger(__name__)


class AIProvider(Protocol):
    def complete(self, prompt: str, *, max_tokens: int = 4096, model: str = "") -> str:
        ...


# ── Anthropic SDK provider ──


class AnthropicAPI:
    """Calls Claude via the official anthropic Python SDK."""

    def __init__(self) -> None:
        import anthropic

        self._client = anthropic.Anthropic()

    def complete(self, prompt: str, *, max_tokens: int = 4096, model: str = "") -> str:
        msg = self._client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()


# ── Claude CLI provider ──


class ClaudeCLI:
    """Calls Claude via the `claude` CLI (`claude -p`)."""

    def __init__(self) -> None:
        self._bin = os.getenv("CLAUDE_CLI_PATH") or shutil.which("claude")
        if not self._bin:
            # Fallback: common nvm location
            nvm_path = os.path.expanduser("~/.nvm/versions/node")
            if os.path.isdir(nvm_path):
                for version_dir in sorted(os.listdir(nvm_path), reverse=True):
                    candidate = os.path.join(nvm_path, version_dir, "bin", "claude")
                    if os.path.isfile(candidate):
                        self._bin = candidate
                        break
        if not self._bin:
            raise RuntimeError(
                "claude CLI not found. Install it or set CLAUDE_CLI_PATH env var."
            )
        logger.info("Using claude CLI at: %s", self._bin)

        # Resolve node binary from same directory (for nvm setups where /usr/bin/env node fails)
        bin_dir = os.path.dirname(self._bin)
        self._node = os.path.join(bin_dir, "node")
        self._use_node = os.path.isfile(self._node)

    def complete(self, prompt: str, *, max_tokens: int = 4096, model: str = "") -> str:
        cmd: list[str] = []
        if self._use_node:
            cmd.append(self._node)
        cmd.extend([
            self._bin,
            "-p",
            prompt,
            "--no-session-persistence",
            "--output-format", "json",
        ])
        if model:
            cmd.extend(["--model", model])
        if max_tokens:
            cmd.extend(["--max-budget-usd", "1"])

        # Strip CLAUDECODE env var so nested sessions are allowed
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            env=env,
            cwd="/tmp",  # Avoid loading project CLAUDE.md
        )
        if result.returncode != 0:
            raise RuntimeError(f"claude CLI failed (exit {result.returncode}): {result.stderr}")

        # --output-format json wraps the answer in {"result": "..."}
        stdout = result.stdout.strip()
        try:
            wrapper = json.loads(stdout)
            if isinstance(wrapper, dict) and "result" in wrapper:
                return wrapper["result"].strip()
        except (json.JSONDecodeError, AttributeError):
            pass
        return stdout


# ── Factory ──

_provider: AIProvider | None = None


def get_provider() -> AIProvider:
    """Return the configured AI provider (singleton)."""
    global _provider
    if _provider is None:
        choice = os.getenv("AI_PROVIDER", "cli").lower()
        if choice == "api":
            logger.info("AI provider: Anthropic SDK")
            _provider = AnthropicAPI()
        else:
            logger.info("AI provider: Claude CLI")
            _provider = ClaudeCLI()
    return _provider


def extract_json(text: str) -> dict:
    """Extract a JSON object from AI output that may contain markdown fences."""
    text = text.strip()
    # Remove ```json ... ``` fences
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()
    # Find first { ... last }
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    raise json.JSONDecodeError("No JSON object found", text, 0)
