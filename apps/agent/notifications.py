"""macOS desktop notifications via osascript."""

from __future__ import annotations

import logging
import subprocess

logger = logging.getLogger(__name__)


def notify(title: str, message: str, sound: str = "default") -> None:
    """Send a macOS notification. Silently fails on non-macOS."""
    try:
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display notification "{message}" with title "{title}" sound name "{sound}"',
            ],
            capture_output=True,
            timeout=5,
        )
    except Exception as e:
        logger.debug("Notification failed: %s", e)
