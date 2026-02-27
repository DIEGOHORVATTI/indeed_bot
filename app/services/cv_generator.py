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
    profile: dict | None = None,
) -> Tuple[str, str]:
    """Generate tailored CV and cover letter via Claude CLI.

    Returns (cv_html, cover_html) after filling templates with AI-generated content.
    """
    from .pdf import fill_cv_template, fill_cover_template

    base_cv = Path(base_cv_path).read_text(encoding="utf-8")
    base_cover = Path(base_cover_path).read_text(encoding="utf-8")
    desc = job_info.get("description", "")[:4000]

    prompt = f"""You are an expert recruiter and CV strategist. Your goal is to produce a HIGH-CONVERSION CV tailored to a specific job posting. The CV must pass ATS (Applicant Tracking Systems) and grab a recruiter's attention in under 10 seconds.

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

HIGH-CONVERSION RULES:
1. OBJECTIVE: Write a single clear sentence stating the target role. Match the exact job title from the posting. If the job is "backend", emphasize backend frameworks (Express, tRPC). If "frontend", emphasize React/Next.js. Companies search by FRAMEWORK, not just language.
2. SUMMARY: Max 3 lines. Lead with years of experience + the SPECIFIC FRAMEWORKS that match the job (not just "TypeScript" — say "React.js and Node.js/Express"). Include a measurable achievement if possible. NEVER say "studying X" — either you know it or you don't.
3. KEYWORDS: Extract the top 8-12 technologies/tools mentioned in BOTH the job posting AND the base CV. These are the intersection — what the candidate knows that the job requires. Prefer FRAMEWORKS over languages (React.js over JavaScript, Express over Node.js). Order by relevance to the job.
4. SKILLS: Group by category. Put the most job-relevant category first. Within each category, lead with the skills mentioned in the job posting.
5. EXPERIENCE: Include ALL jobs from the base CV. For each bullet:
   - Start with a strong ACTION VERB (Developed, Architected, Implemented, Optimized, Led, etc.)
   - BE SPECIFIC: name the exact tools/libraries/frameworks used (not "optimized performance" but "reduced TTFF by 30% using HLS chunk preloading")
   - Include quantifiable results when possible (e.g., "reducing load time by 40%", "serving 50k+ users", "form with 200+ fields")
   - Highlight technologies/skills that match the job posting
   - Max 3-4 bullets per job, most relevant first
   - NEVER write vague bullets like "development and maintenance of modules" — always answer: WHAT tool, to achieve WHAT result, with WHAT measurable impact
   - Keep "Contract (PJ)" or "Full-time (CLT)" labels from the base CV in the company field to clarify employment type
6. PROJECTS: Select 2-3 projects from the base CV most relevant to this job. Each with name, URL, and a 1-line description emphasizing the SPECIFIC tech stack used and relevance to this job.
7. EDUCATION: Include all education entries from the base CV.
8. CERTIFICATIONS: List certifications and courses separately. Include provider name.
9. LANGUAGES: Include language name and proficiency level with dash separator.
10. ADDITIONAL INFO: Only include if there's something genuinely relevant not covered elsewhere (e.g., open-source contributions, community involvement). Leave empty string if nothing to add.
11. COVER LETTER: 3-4 paragraphs. First paragraph: hook with specific interest in the company. Middle: concrete examples matching job requirements with SPECIFIC technologies and results. Last: call to action.

Return ONLY a JSON object with these exact keys:

{{
  "objective": "target role matching job title (e.g. 'Desenvolvedor Full Stack' or 'Full Stack Developer')",
  "section_summary": "section title (e.g. 'Resumo Profissional' or 'Professional Summary')",
  "summary": "2-3 sentence professional summary tailored to this job",
  "keywords": ["TypeScript", "React", "Node.js", "AWS", "..."],
  "section_skills": "section title (e.g. 'Competências Técnicas' or 'Technical Skills')",
  "skills": [
    {{"label": "Front-End", "items": "React.js, Next.js, ..."}},
    {{"label": "Back-End", "items": "Node.js, Express, ..."}},
    {{"label": "Languages", "items": "TypeScript, JavaScript"}},
    {{"label": "Architecture", "items": "Clean Architecture, ..."}},
    {{"label": "DevOps", "items": "Docker, AWS, ..."}},
    {{"label": "Testing", "items": "Jest, Cypress, ..."}}
  ],
  "section_experience": "section title",
  "experience": [
    {{
      "title": "job title",
      "date": "01/2024 – Present",
      "company": "Company Name · Location",
      "bullets": ["action verb + achievement + tech", "...", "..."]
    }}
  ],
  "section_projects": "section title (e.g. 'Projetos' or 'Projects')",
  "projects": [
    {{
      "name": "Project Name",
      "url": "https://github.com/...",
      "description": "one-line description highlighting relevance to this job"
    }}
  ],
  "section_education": "section title",
  "education": [
    {{
      "degree": "Computer Science – Bachelor",
      "institution": "University Name",
      "period": "2020–2025"
    }}
  ],
  "section_certifications": "section title (e.g. 'Certificações' or 'Certifications')",
  "certifications": ["Front End Engineer – Ebac", "Next.js – Udemy"],
  "section_languages": "section title",
  "languages": [
    {{"name": "English", "level": "B2 Upper-intermediate"}},
    {{"name": "Portuguese", "level": "Fluent"}}
  ],
  "section_additional": "section title (e.g. 'Informações Adicionais' or 'Additional Information')",
  "additional_info": "relevant additional info or empty string",
  "cover_subtitle": "subtitle for cover letter header",
  "cover_greeting": "Prezado(a) Equipe de Recrutamento da CompanyX," or "Dear Hiring Team at CompanyX,",
  "cover_paragraphs": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "cover_closing": "Atenciosamente" or "Sincerely"
}}

CRITICAL: Return ONLY the raw JSON. No markdown, no explanation, no wrapping."""

    data = _call_claude(prompt, claude_cli_path)

    cv_html = fill_cv_template(data, profile=profile)
    cover_html = fill_cover_template(data, profile=profile)

    return cv_html, cover_html
