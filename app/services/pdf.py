from __future__ import annotations

import hashlib
import os
import time
from datetime import date
from pathlib import Path
from typing import Tuple

TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "assets"

SEP = '<span class="sep">|</span>'


def _build_contact_html(profile: dict) -> str:
    """Build the contact line HTML from profile config."""
    parts = [profile.get("email", ""), profile.get("phone", "")]
    if profile.get("linkedin"):
        parts.append(f'<a href="{profile["linkedin"]}">LinkedIn</a>')
    if profile.get("github"):
        parts.append(f'<a href="{profile["github"]}">GitHub</a>')
    if profile.get("portfolio"):
        parts.append(f'<a href="{profile["portfolio"]}">Portfolio</a>')
    parts.append(profile.get("location", ""))
    return SEP.join(p for p in parts if p)


def _fill_profile(html: str, profile: dict) -> str:
    """Replace profile placeholders in any template."""
    html = html.replace("{{profile_name}}", profile.get("name", "").upper())
    html = html.replace("{{profile_contact}}", _build_contact_html(profile))
    return html


def fill_cv_template(data: dict, profile: dict | None = None) -> str:
    """Fill the CV HTML template with AI-generated text content."""
    html = (TEMPLATES_DIR / "cv_template.html").read_text(encoding="utf-8")

    # Profile placeholders
    if profile:
        html = _fill_profile(html, profile)

    # Simple text placeholders
    html = html.replace("{{objective}}", data.get("objective", "Full Stack Developer"))
    html = html.replace("{{section_summary}}", data.get("section_summary", "Resumo Profissional"))
    html = html.replace("{{summary}}", data.get("summary", ""))
    html = html.replace("{{section_skills}}", data.get("section_skills", "Competências"))
    html = html.replace("{{section_experience}}", data.get("section_experience", "Experiência Profissional"))
    html = html.replace("{{section_education}}", data.get("section_education", "Formação"))
    html = html.replace("{{section_certifications}}", data.get("section_certifications", "Certificações"))
    html = html.replace("{{section_languages}}", data.get("section_languages", "Idiomas"))

    # Keywords as inline badges
    keywords = data.get("keywords", [])
    keywords_html = "".join(f'<span class="badge">{kw}</span>' for kw in keywords)
    html = html.replace("{{keywords}}", keywords_html)

    # Skills grid
    skills_html = ""
    for skill in data.get("skills", []):
        skills_html += f'<div class="row"><span class="label">{skill["label"]}:</span> {skill["items"]}</div>\n'
    html = html.replace("{{skills}}", skills_html)

    # Experience blocks
    exp_html = ""
    for job in data.get("experience", []):
        bullets = "".join(f"<li>{b}</li>" for b in job.get("bullets", []))
        exp_html += f"""<div class="job">
  <div class="job-header"><span class="job-title">{job.get("title", "")}</span><span class="job-date">{job.get("date", "")}</span></div>
  <div class="job-company">{job.get("company", "")}</div>
  <ul>{bullets}</ul>
</div>\n"""
    html = html.replace("{{experience}}", exp_html)

    # Education (dynamic)
    edu_html = ""
    for edu in data.get("education", []):
        edu_html += f'<strong>{edu.get("degree", "")}</strong> | {edu.get("institution", "")} | {edu.get("period", "")}<br>\n'
    html = html.replace("{{education}}", edu_html)

    # Certifications
    certs = data.get("certifications", [])
    if certs:
        certs_html = "<ul>" + "".join(f"<li>{c}</li>" for c in certs) + "</ul>"
    else:
        certs_html = ""
    html = html.replace("{{certifications}}", certs_html)

    # Languages (dynamic)
    langs = data.get("languages", [])
    langs_html = " &nbsp;|&nbsp; ".join(f'{l["name"]} – {l["level"]}' for l in langs)
    html = html.replace("{{languages}}", langs_html)

    # Additional info (optional section)
    additional = data.get("additional_info", "")
    if additional:
        additional_html = f'<h2>{data.get("section_additional", "Informações Adicionais")}</h2>\n<p class="additional">{additional}</p>'
    else:
        additional_html = ""
    html = html.replace("{{additional_info}}", additional_html)

    return html


def fill_cover_template(data: dict, profile: dict | None = None) -> str:
    """Fill the cover letter HTML template with AI-generated text content."""
    html = (TEMPLATES_DIR / "cover_template.html").read_text(encoding="utf-8")

    # Profile placeholders
    if profile:
        html = _fill_profile(html, profile)

    html = html.replace("{{subtitle}}", data.get("cover_subtitle", data.get("subtitle", "Full Stack Developer")))
    html = html.replace("{{greeting}}", data.get("cover_greeting", "Prezado(a) Recrutador(a),"))
    html = html.replace("{{closing}}", data.get("cover_closing", "Atenciosamente"))

    today = date.today()
    location = (profile or {}).get("location", "")
    city = location.split(",")[0].strip() if location else ""
    months_pt = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
                 "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
    date_str = f"{city}, {today.day} de {months_pt[today.month]} de {today.year}" if city else ""
    html = html.replace("{{date}}", date_str)

    paragraphs = data.get("cover_paragraphs", [])
    paragraphs_html = "".join(f"<p>{p}</p>\n" for p in paragraphs)
    html = html.replace("{{paragraphs}}", paragraphs_html)

    return html


def _run_pdf_in_subprocess(html_path: str, output_path: str) -> None:
    """Run Playwright PDF generation in a subprocess to avoid async loop conflicts."""
    import subprocess
    import sys

    script = f"""
import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("file://{html_path}", wait_until="networkidle")
    page.pdf(
        path="{output_path}",
        format="A4",
        print_background=True,
        margin={{"top": "0", "right": "0", "bottom": "0", "left": "0"}},
    )
    browser.close()
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"PDF subprocess failed: {result.stderr[:500]}")


def html_to_pdf(html_content: str, output_path: str) -> str:
    """Convert HTML string to PDF using Playwright in a subprocess.

    Uses a subprocess to avoid 'Playwright Sync API inside asyncio loop' errors
    when Camoufox (which uses an internal event loop) is active.
    """
    import tempfile

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as tmp:
        tmp.write(html_content)
        tmp_path = tmp.name

    try:
        _run_pdf_in_subprocess(tmp_path, output_path)
    finally:
        os.unlink(tmp_path)

    return output_path


def _job_file_prefix(job_info: dict) -> str:
    """Generate a file name prefix from job info."""
    job_hash = hashlib.md5(job_info.get("url", str(time.time())).encode()).hexdigest()[:8]
    company = (job_info.get("company", "unknown") or "unknown").replace(" ", "_").replace("/", "_")[:30]
    title = (job_info.get("title", "job") or "job").replace(" ", "_").replace("/", "_")[:30]
    return f"{company}_{title}_{job_hash}"


def generate_pdfs_for_job(
    job_info: dict,
    base_cv_path: str = "assets/base_cv.md",
    base_cover_path: str = "assets/base_cover_letter.md",
    claude_cli_path: str = "claude",
    output_dir: str = "output",
    profile: dict | None = None,
    include_cover: bool = False,
) -> Tuple[str, str | None]:
    """Generate tailored CV (and optionally cover letter) PDFs for a specific job.

    When include_cover=False, only the CV PDF is generated. The cover letter
    can be generated later via generate_cover_pdf_for_job() using cached content.
    """
    from .cv_generator import generate_tailored_content

    os.makedirs(output_dir, exist_ok=True)

    prefix = _job_file_prefix(job_info)
    cv_pdf_path = os.path.join(output_dir, f"cv_{prefix}.pdf")

    cv_html, cover_html = generate_tailored_content(
        job_info, base_cv_path, base_cover_path, claude_cli_path, profile=profile
    )

    html_to_pdf(cv_html, cv_pdf_path)

    # Cache cover HTML for lazy generation
    cover_cache_path = os.path.join(output_dir, f".cover_html_{prefix}.html")
    with open(cover_cache_path, "w", encoding="utf-8") as f:
        f.write(cover_html)

    cover_pdf_path = None
    if include_cover:
        cover_pdf_path = os.path.join(output_dir, f"cover_{prefix}.pdf")
        html_to_pdf(cover_html, cover_pdf_path)

    return cv_pdf_path, cover_pdf_path


def generate_cover_pdf_for_job(
    job_info: dict,
    output_dir: str = "output",
) -> str | None:
    """Generate cover letter PDF from cached HTML content.

    This is called lazily when the wizard detects a cover letter field.
    Returns the PDF path or None if no cached content exists.
    """
    prefix = _job_file_prefix(job_info)
    cover_cache_path = os.path.join(output_dir, f".cover_html_{prefix}.html")
    cover_pdf_path = os.path.join(output_dir, f"cover_{prefix}.pdf")

    # Already generated
    if os.path.exists(cover_pdf_path):
        return cover_pdf_path

    # Generate from cached HTML
    if os.path.exists(cover_cache_path):
        cover_html = open(cover_cache_path, encoding="utf-8").read()
        html_to_pdf(cover_html, cover_pdf_path)
        return cover_pdf_path

    return None
