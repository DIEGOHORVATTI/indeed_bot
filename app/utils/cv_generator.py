from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from datetime import date
from pathlib import Path
from typing import Optional, Tuple

TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "assets"


def scrape_job_description(page) -> dict:
    """Extract job title, company, and description from an Indeed job page."""
    selectors_title = [
        'h1.jobsearch-JobInfoHeader-title',
        'h1[data-testid="jobsearch-JobInfoHeader-title"]',
        'h1[class*="JobInfoHeader"]',
        'h2.jobTitle',
    ]
    selectors_company = [
        '[data-testid="inlineHeader-companyName"]',
        '[data-testid="company-name"]',
        'div[data-company-name] a',
        'span.css-1cjkto6',
    ]
    selectors_desc = [
        '#jobDescriptionText',
        'div.jobsearch-JobComponent-description',
        '[data-testid="jobDescriptionText"]',
    ]

    def _text(sels):
        for sel in sels:
            try:
                el = page.query_selector(sel)
                if el:
                    return el.inner_text().strip()
            except Exception:
                continue
        return ""

    return {
        "title": _text(selectors_title),
        "company": _text(selectors_company),
        "description": _text(selectors_desc),
        "url": page.url,
    }


def _call_claude(prompt: str, claude_cli_path: str = "claude") -> dict:
    """Call Claude CLI and return parsed JSON."""
    result = subprocess.run(
        [claude_cli_path, "-p", prompt, "--output-format", "text"],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Claude CLI failed (exit {result.returncode}): {result.stderr[:500]}")

    output = result.stdout.strip()
    # Remove markdown code block wrapper if present
    if output.startswith("```"):
        lines = output.split("\n")
        lines = [l for l in lines if not l.startswith("```")]
        output = "\n".join(lines)

    return json.loads(output)


def generate_tailored_content(
    job_info: dict,
    base_cv_path: str,
    base_cover_path: str,
    claude_cli_path: str = "claude",
) -> Tuple[str, str]:
    """Generate tailored CV and cover letter by filling fixed HTML templates.

    The AI only generates text content (JSON), the HTML structure is fixed.
    Returns (cv_html, cover_letter_html).
    """
    base_cv = Path(base_cv_path).read_text(encoding="utf-8")
    base_cover = Path(base_cover_path).read_text(encoding="utf-8")
    desc = job_info.get("description", "")[:4000]

    prompt = f"""You are tailoring a CV and cover letter for a specific job application.
You must ONLY return text content as JSON. Do NOT generate any HTML.

JOB POSTING:
Title: {job_info.get('title', 'N/A')}
Company: {job_info.get('company', 'N/A')}
Description:
{desc}

BASE CV (source of truth - keep all facts, only reorder/emphasize):
{base_cv}

BASE COVER LETTER (adapt tone and content for this specific role):
{base_cover}

LANGUAGE RULE (CRITICAL): Detect the language of the job description.
- If Portuguese → write everything in PT-BR.
- If English → write everything in English.
- Default to Portuguese for br.indeed.com jobs.

Return ONLY a JSON object with these exact keys:

{{
  "subtitle": "role title adapted for this job (e.g. 'Desenvolvedor Full Stack' or 'Full Stack Developer')",
  "section_summary": "section title (e.g. 'Resumo Profissional' or 'Professional Summary')",
  "summary": "2-3 sentence professional summary tailored to this job",
  "section_skills": "section title (e.g. 'Competências' or 'Skills')",
  "skills": [
    {{"label": "Front-End", "items": "React.js, Next.js, ..."}},
    {{"label": "Back-End", "items": "Node.js, Express, ..."}},
    {{"label": "Linguagens", "items": "TypeScript, JavaScript"}},
    {{"label": "Arquitetura", "items": "Clean Architecture, ..."}},
    {{"label": "DevOps", "items": "Docker, AWS, ..."}},
    {{"label": "Testes", "items": "Jest, Cypress, ..."}}
  ],
  "section_experience": "section title (e.g. 'Experiência Profissional' or 'Professional Experience')",
  "experience": [
    {{
      "title": "job title",
      "date": "01/2024 – Presente",
      "company": "Company Name · Location",
      "bullets": ["bullet 1", "bullet 2", "bullet 3"]
    }}
  ],
  "section_education": "section title",
  "section_languages": "section title",
  "cover_subtitle": "subtitle for cover letter header (can differ from CV subtitle)",
  "cover_greeting": "Prezado(a) Equipe de Recrutamento da CompanyX," or "Dear Hiring Team at CompanyX,",
  "cover_paragraphs": ["paragraph 1 text", "paragraph 2 text", "paragraph 3 text", "paragraph 4 text"],
  "cover_closing": "Atenciosamente" or "Sincerely"
}}

RULES:
- Keep ALL facts from the base CV truthful. Never invent experience.
- Reorder skills and emphasize bullets relevant to THIS job.
- Experience: include ALL 5 jobs from the base CV. Adapt bullet text to highlight relevance.
- Cover letter: 3-5 paragraphs, specific to this company and role.
- Return ONLY the raw JSON. No markdown, no explanation."""

    data = _call_claude(prompt, claude_cli_path)

    # Build CV HTML from template
    cv_template = (TEMPLATES_DIR / "cv_template.html").read_text(encoding="utf-8")
    cv_html = _fill_cv_template(cv_template, data)

    # Build cover letter HTML from template
    cover_template = (TEMPLATES_DIR / "cover_template.html").read_text(encoding="utf-8")
    cover_html = _fill_cover_template(cover_template, data)

    return cv_html, cover_html


def _fill_cv_template(template: str, data: dict) -> str:
    """Fill the CV HTML template with AI-generated text content."""
    html = template
    html = html.replace("{{subtitle}}", data.get("subtitle", "Full Stack Developer"))
    html = html.replace("{{section_summary}}", data.get("section_summary", "Resumo Profissional"))
    html = html.replace("{{summary}}", data.get("summary", ""))
    html = html.replace("{{section_skills}}", data.get("section_skills", "Competências"))
    html = html.replace("{{section_experience}}", data.get("section_experience", "Experiência Profissional"))
    html = html.replace("{{section_education}}", data.get("section_education", "Formação"))
    html = html.replace("{{section_languages}}", data.get("section_languages", "Idiomas"))

    # Skills
    skills_html = ""
    for skill in data.get("skills", []):
        skills_html += f'<div class="row"><span class="label">{skill["label"]}:</span> {skill["items"]}</div>\n'
    html = html.replace("{{skills}}", skills_html)

    # Experience
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


def _fill_cover_template(template: str, data: dict) -> str:
    """Fill the cover letter HTML template with AI-generated text content."""
    html = template
    html = html.replace("{{subtitle}}", data.get("cover_subtitle", data.get("subtitle", "Full Stack Developer")))
    html = html.replace("{{greeting}}", data.get("cover_greeting", "Prezado(a) Recrutador(a),"))
    html = html.replace("{{closing}}", data.get("cover_closing", "Atenciosamente"))

    # Date
    today = date.today()
    months_pt = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
                 "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
    date_str = f"Florianópolis, {today.day} de {months_pt[today.month]} de {today.year}"
    html = html.replace("{{date}}", date_str)

    # Paragraphs
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
    """Orchestrate: generate tailored content via Claude CLI and convert to PDFs."""
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
