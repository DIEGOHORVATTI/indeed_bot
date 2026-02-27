from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Tuple


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

    def _text(sels: list[str]) -> str:
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
    if output.startswith("```"):
        lines = output.split("\n")
        lines = [line for line in lines if not line.startswith("```")]
        output = "\n".join(lines)

    return json.loads(output)


def generate_tailored_content(
    job_info: dict,
    base_cv_path: str,
    base_cover_path: str,
    claude_cli_path: str = "claude",
) -> Tuple[str, str]:
    """Generate tailored CV and cover letter via Claude CLI.

    Returns (cv_json_data, cover_json_data) as a single dict from AI,
    then fills HTML templates. Returns (cv_html, cover_html).
    """
    from .pdf import fill_cv_template, fill_cover_template

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

    cv_html = fill_cv_template(data)
    cover_html = fill_cover_template(data)

    return cv_html, cover_html
