"""Stage 5: Generate CV and cover letter PDFs from tailored content."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime

from apps.agent.config import TEMPLATES_DIR, PDF_DIR, ensure_dirs
from apps.agent.db import get_jobs, update_job, log_event
from apps.backend.pdf import html_to_pdf

logger = logging.getLogger(__name__)


def _build_contact_html(profile: dict) -> str:
    """Build contact line HTML from profile."""
    parts = []
    if profile.get("email"):
        parts.append(profile["email"])
    if profile.get("phone"):
        parts.append(profile["phone"])
    if profile.get("location"):
        parts.append(profile["location"])
    if profile.get("linkedin"):
        parts.append(f'<a href="{profile["linkedin"]}">LinkedIn</a>')
    if profile.get("github"):
        parts.append(f'<a href="{profile["github"]}">GitHub</a>')
    if profile.get("portfolio"):
        parts.append(f'<a href="{profile["portfolio"]}">Portfolio</a>')
    return '<span class="sep">|</span>'.join(parts)


def _render_cv(template: str, data: dict, profile: dict) -> str:
    """Render CV template with tailored data."""
    html = template
    html = html.replace("{{profile_name}}", profile.get("name", ""))
    html = html.replace("{{objective}}", data.get("objective", ""))
    html = html.replace("{{profile_contact}}", _build_contact_html(profile))
    html = html.replace("{{section_summary}}", data.get("section_summary", "Summary"))
    html = html.replace("{{summary}}", data.get("summary", ""))

    # Keywords badges
    keywords = data.get("keywords", [])
    keywords_html = "".join(f'<span class="badge">{kw}</span>' for kw in keywords)
    html = html.replace("{{keywords}}", keywords_html)

    # Section titles
    html = html.replace("{{section_skills}}", data.get("section_skills", "Skills"))
    html = html.replace("{{section_experience}}", data.get("section_experience", "Experience"))
    html = html.replace("{{section_education}}", data.get("section_education", "Education"))
    html = html.replace("{{section_certifications}}", data.get("section_certifications", "Certifications"))
    html = html.replace("{{section_languages}}", data.get("section_languages", "Languages"))

    # Skills grid
    skills = data.get("skills", [])
    skills_html = ""
    for skill in skills:
        skills_html += f'<div class="row"><span class="label">{skill["label"]}:</span> {skill["items"]}</div>'
    html = html.replace("{{skills}}", skills_html)

    # Experience
    experience = data.get("experience", [])
    exp_html = ""
    for exp in experience:
        bullets = "".join(f"<li>{b}</li>" for b in exp.get("bullets", []))
        exp_html += f"""<div class="job">
  <div class="job-header">
    <span class="job-title">{exp.get('title', '')}</span>
    <span class="job-date">{exp.get('date', '')}</span>
  </div>
  <div class="job-company">{exp.get('company', '')}</div>
  <ul>{bullets}</ul>
</div>"""
    html = html.replace("{{experience}}", exp_html)

    # Education
    education = data.get("education", [])
    edu_html = ""
    for edu in education:
        edu_html += f'<strong>{edu.get("degree", "")}</strong> — {edu.get("institution", "")} ({edu.get("period", "")})<br>'
    html = html.replace("{{education}}", edu_html)

    # Certifications
    certs = data.get("certifications", [])
    if certs:
        certs_html = "<ul>" + "".join(f"<li>{c}</li>" for c in certs) + "</ul>"
    else:
        certs_html = ""
    html = html.replace("{{certifications}}", certs_html)

    # Languages
    languages = data.get("languages", [])
    lang_html = "<br>".join(f'{l["name"]} — {l["level"]}' for l in languages)
    html = html.replace("{{languages}}", lang_html)

    # Additional info
    additional = data.get("additional_info", "")
    if additional:
        additional_html = f'<h2>{data.get("section_additional", "Additional")}</h2><div class="additional">{additional}</div>'
    else:
        additional_html = ""
    html = html.replace("{{additional_info}}", additional_html)

    return html


def _render_cover(template: str, data: dict, profile: dict) -> str:
    """Render cover letter template with tailored data."""
    html = template
    html = html.replace("{{profile_name}}", profile.get("name", ""))
    html = html.replace("{{subtitle}}", data.get("cover_subtitle", ""))
    html = html.replace("{{profile_contact}}", _build_contact_html(profile))
    html = html.replace("{{date}}", datetime.now().strftime("%B %d, %Y"))
    html = html.replace("{{greeting}}", data.get("cover_greeting", "Dear Hiring Manager,"))

    paragraphs = data.get("cover_paragraphs", [])
    paragraphs_html = "".join(f"<p>{p}</p>" for p in paragraphs)
    html = html.replace("{{paragraphs}}", paragraphs_html)

    html = html.replace("{{closing}}", data.get("cover_closing", "Sincerely"))

    return html


def run(db: sqlite3.Connection, profile: dict) -> int:
    """Generate PDFs for tailored jobs. Returns count of jobs made ready."""
    ensure_dirs()
    jobs = get_jobs(db, status="tailored")
    ready = 0

    cv_template = (TEMPLATES_DIR / "cv_template.html").read_text(encoding="utf-8")
    cover_template = (TEMPLATES_DIR / "cover_template.html").read_text(encoding="utf-8")

    for job in jobs:
        try:
            data = json.loads(job["tailored_cv"])
        except (json.JSONDecodeError, TypeError) as e:
            logger.error("Invalid tailored_cv JSON for job %d: %s", job["id"], e)
            log_event(db, job["id"], "cover", "error", f"Invalid JSON: {e}")
            update_job(db, job["id"], status="failed", fail_reason=f"Cover JSON error: {e}")
            continue

        logger.info("Generating PDFs for: %s at %s", job["title"], job["company"])

        try:
            # Render and generate CV PDF
            cv_html = _render_cv(cv_template, data, profile)
            cv_path = str(PDF_DIR / f"{job['id']}_cv.pdf")
            html_to_pdf(cv_html, cv_path)

            # Render and generate cover letter PDF
            cover_html = _render_cover(cover_template, data, profile)
            cover_path = str(PDF_DIR / f"{job['id']}_cover.pdf")
            html_to_pdf(cover_html, cover_path)

            update_job(db, job["id"], cv_pdf_path=cv_path, cover_pdf_path=cover_path, status="ready")
            log_event(db, job["id"], "cover", "info", "PDFs generated")
            ready += 1

        except Exception as e:
            logger.error("PDF generation failed for job %d: %s", job["id"], e)
            log_event(db, job["id"], "cover", "error", f"PDF error: {e}")
            update_job(db, job["id"], status="failed", fail_reason=f"PDF error: {e}")

    return ready
