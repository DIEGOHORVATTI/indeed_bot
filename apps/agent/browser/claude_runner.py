"""Run Claude CLI with MCP for browser automation."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess

logger = logging.getLogger(__name__)


def find_claude_bin() -> str:
    """Find the claude CLI binary (reuses ai_provider.py detection logic)."""
    path = os.getenv("CLAUDE_CLI_PATH") or shutil.which("claude")
    if path:
        return path

    # Fallback: nvm location
    nvm_path = os.path.expanduser("~/.nvm/versions/node")
    if os.path.isdir(nvm_path):
        for version_dir in sorted(os.listdir(nvm_path), reverse=True):
            candidate = os.path.join(nvm_path, version_dir, "bin", "claude")
            if os.path.isfile(candidate):
                return candidate

    raise RuntimeError("claude CLI not found. Install it or set CLAUDE_CLI_PATH env var.")


def run_apply(prompt: str, mcp_config_path: str, timeout: int = 300) -> dict:
    """Run claude CLI with Playwright MCP to apply to a job. Returns parsed result."""
    claude_bin = find_claude_bin()

    cmd = [
        claude_bin,
        "-p", prompt,
        "--no-session-persistence",
        "--mcp-config", mcp_config_path,
        "--allowedTools", "mcp__playwright__*",
        "--dangerously-skip-permissions",
        "--max-budget-usd", "2",
        "--model", "sonnet",
        "--output-format", "json",
    ]

    logger.info("Running claude CLI for application...")
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

    if result.returncode != 0:
        logger.error("Claude CLI failed (exit %d): %s", result.returncode, result.stderr[:500])
        return {"status": "failed", "reason": f"CLI exit {result.returncode}: {result.stderr[:200]}"}

    try:
        output = json.loads(result.stdout)
        # Claude CLI JSON output wraps the result — extract the text content
        if isinstance(output, dict) and "result" in output:
            text = output["result"]
        elif isinstance(output, dict) and "content" in output:
            text = output["content"]
        else:
            text = result.stdout

        # Try to parse the inner JSON from the AI's response
        if isinstance(text, str):
            # Find JSON in the response
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])

        return {"status": "failed", "reason": "Could not parse AI response"}
    except json.JSONDecodeError:
        return {"status": "failed", "reason": f"Invalid JSON output: {result.stdout[:200]}"}
