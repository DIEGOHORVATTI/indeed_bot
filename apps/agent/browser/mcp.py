"""MCP server configuration for Playwright browser automation."""

from __future__ import annotations

import json
import os
import tempfile


def write_mcp_config(chrome_profile_dir: str) -> str:
    """Write MCP config JSON for Playwright and return the file path."""
    config = {
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": [
                    "@playwright/mcp@latest",
                    "--browser", "chrome",
                    "--user-data-dir", chrome_profile_dir,
                ],
            }
        }
    }

    path = os.path.join(tempfile.gettempdir(), f"agent-mcp-{os.getpid()}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f)

    return path
