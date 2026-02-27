from __future__ import annotations

import hashlib
import os
import time
from datetime import date
from pathlib import Path
from typing import Tuple

TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "assets"


def fill_cv_template(data: dict) -> str:
    """Fill the CV HTML template with AI-generated text content."""
    html = (TEMPLATES_DIR / "cv_template.html").read_text(encoding="utf-8")
    html = html.replace("{{subtitle}}", data.get("subtitle", "Full Stack Developer"))
    html = html.replace("{{section_summary}}", data.get("section_summary", "Resumo Profissional"))
    html = html.replace("{{summary}}", data.get("summary", ""))
    html = html.replace("{{section_skills}}", data.get("section_skills", "Competências"))
    html = html.replace("{{section_experience}}", data.get("section_experience", "Experiência Profissional"))
    html = html.replace("{{section_education}}", data.get("section_education", "Formação"))
    html = html.replace("{{section_languages}}", data.get("section_languages", "Idiomas"))

    skills_html = ""
    for skill in data.get("skills", []):
        skills_html += f'<div class="row"><span class="label">{skill["label"]}:</span> {skill["items"]}</div>\n'
    html = html.replace("{{skills}}", skills_html)

    exp_html = ""
    for job in data.get("experience", []):
        bullets = "".join(f"<li>{b}</li>" for b in job.get("bullets", []))
        exp_html += f"""<div class="job">
  <div class="job-header"><span class="job-title">{job.get("title", "")}</span><span class="job-date">{job.get("date", "")}</span></div>
  <div class="job-company">{job.get("company", "")}</div>
  <ul>{bullets}</ul>
</div>\n"""
    html = html.replace("{{experience}}", exp_html)

    return html


def fill_cover_template(data: dict) -> str:
    """Fill the cover letter HTML template with AI-generated text content."""
    html = (TEMPLATES_DIR / "cover_template.html").read_text(encoding="utf-8")
    html = html.replace("{{subtitle}}", data.get("cover_subtitle", data.get("subtitle", "Full Stack Developer")))
    html = html.replace("{{greeting}}", data.get("cover_greeting", "Prezado(a) Recrutador(a),"))
    html = html.replace("{{closing}}", data.get("cover_closing", "Atenciosamente"))

    today = date.today()
    months_pt = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
                 "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
    date_str = f"Florianópolis, {today.day} de {months_pt[today.month]} de {today.year}"
    html = html.replace("{{date}}", date_str)

    paragraphs = data.get("cover_paragraphs", [])
    paragraphs_html = "".join(f"<p>{p}</p>\n" for p in paragraphs)
    html = html.replace("{{paragraphs}}", paragraphs_html)

    return html


def html_to_pdf(html_content: str, output_path: str) -> str:
    """Convert HTML string to PDF using xhtml2pdf."""
    from xhtml2pdf import pisa

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w+b") as f:
        status = pisa.CreatePDF(html_content, dest=f)
    if status.err:
        raise RuntimeError(f"PDF generation failed with {status.err} errors")
    return output_path


def generate_pdfs_for_job(
    job_info: dict,
    base_cv_path: str = "assets/base_cv.md",
    base_cover_path: str = "assets/base_cover_letter.md",
    claude_cli_path: str = "claude",
    output_dir: str = "output",
) -> Tuple[str, str]:
    """Generate tailored CV and cover letter PDFs for a specific job."""
    from .cv_generator import generate_tailored_content

    os.makedirs(output_dir, exist_ok=True)

    job_hash = hashlib.md5(job_info.get("url", str(time.time())).encode()).hexdigest()[:8]
    company = (job_info.get("company", "unknown") or "unknown").replace(" ", "_").replace("/", "_")[:30]
    title = (job_info.get("title", "job") or "job").replace(" ", "_").replace("/", "_")[:30]
    prefix = f"{company}_{title}_{job_hash}"

    cv_pdf_path = os.path.join(output_dir, f"cv_{prefix}.pdf")
    cover_pdf_path = os.path.join(output_dir, f"cover_{prefix}.pdf")

    cv_html, cover_html = generate_tailored_content(
        job_info, base_cv_path, base_cover_path, claude_cli_path
    )

    html_to_pdf(cv_html, cv_pdf_path)
    html_to_pdf(cover_html, cover_pdf_path)

    return cv_pdf_path, cover_pdf_path
