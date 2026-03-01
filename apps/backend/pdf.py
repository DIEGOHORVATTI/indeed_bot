from __future__ import annotations

import os
import subprocess
import sys
import tempfile


def _run_pdf_in_subprocess(html_path: str, output_path: str) -> None:
    """Run Playwright PDF generation in a subprocess to avoid async loop conflicts."""
    script = """
import sys
from playwright.sync_api import sync_playwright
html_path, output_path = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("file://" + html_path, wait_until="networkidle")
    page.pdf(
        path=output_path,
        format="A4",
        print_background=True,
        margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
    )
    browser.close()
"""
    result = subprocess.run(
        [sys.executable, "-c", script, html_path, output_path],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"PDF subprocess failed: {result.stderr[:500]}")


def html_to_pdf(html_content: str, output_path: str) -> str:
    """Convert HTML string to PDF using Playwright in a subprocess."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as tmp:
        tmp.write(html_content)
        tmp_path = tmp.name

    try:
        _run_pdf_in_subprocess(tmp_path, output_path)
    finally:
        os.unlink(tmp_path)

    return output_path
