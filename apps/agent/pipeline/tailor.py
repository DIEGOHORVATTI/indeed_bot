"""Stage 4: Tailor CV content using AI (reuses server.py prompt structure)."""

from __future__ import annotations

import json
import logging
import sqlite3

from apps.backend.ai_provider import extract_json, get_provider
from apps.agent.config import MODEL_SMART
from apps.agent.db import get_jobs, update_job, log_event

logger = logging.getLogger(__name__)


def run(db: sqlite3.Connection, profile: dict) -> int:
    """Tailor CVs for scored jobs. Returns count of tailored jobs."""
    jobs = get_jobs(db, status="scored")
    tailored = 0
    ai = get_provider()

    for job in jobs:
        desc = (job["description"] or "")[:4000]
        logger.info("Tailoring CV for: %s at %s", job["title"], job["company"])

        prompt = f"""You are an expert recruiter and CV strategist. Your goal is to produce a HIGH-CONVERSION CV tailored to a specific job posting. The CV must pass ATS (Applicant Tracking Systems) and grab a recruiter's attention in under 10 seconds.

You must ONLY return text content as JSON. Do NOT generate any HTML.

JOB POSTING:
Title: {job['title'] or 'N/A'}
Company: {job['company'] or 'N/A'}
Description:
{desc}

BASE CV (source of truth - keep all facts, only reorder/emphasize):
{profile.get('base_cv', '')}

BASE COVER LETTER (adapt tone and content for this specific role):
{profile.get('base_cover_letter', '')}

LANGUAGE RULE (CRITICAL): Detect the language of the job description.
- If Portuguese → write everything in PT-BR.
- If English → write everything in English.
- Default to Portuguese for br.indeed.com jobs.

HIGH-CONVERSION RULES:
1. OBJECTIVE: Write a single clear sentence stating the target role. Match the exact job title from the posting.
2. SUMMARY: Max 3 lines. Lead with years of experience + the SPECIFIC FRAMEWORKS that match the job. Include a measurable achievement if possible. NEVER say "studying X".
3. KEYWORDS: Extract the top 8-12 technologies/tools mentioned in BOTH the job posting AND the base CV.
4. SKILLS: Group by category. Put the most job-relevant category first.
5. EXPERIENCE: Include ALL jobs from the base CV. Start bullets with strong ACTION VERBS. BE SPECIFIC with tools/libraries. Include quantifiable results.
6. EDUCATION: Include all education entries from the base CV.
7. CERTIFICATIONS: List certifications and courses separately.
8. LANGUAGES: Include language name and proficiency level.
9. ADDITIONAL INFO: Only include if genuinely relevant.
10. COVER LETTER: 3-4 paragraphs. Hook with company interest, concrete examples, call to action.

Return ONLY a JSON object with these exact keys:

{{
  "objective": "target role",
  "section_summary": "section title",
  "summary": "2-3 sentence professional summary",
  "keywords": ["TypeScript", "React", "..."],
  "section_skills": "section title",
  "skills": [{{"label": "Front-End", "items": "React.js, Next.js, ..."}}],
  "section_experience": "section title",
  "experience": [{{"title": "job title", "date": "01/2024 – Present", "company": "Company · Location", "bullets": ["..."]}}],
  "section_education": "section title",
  "education": [{{"degree": "CS – Bachelor", "institution": "University", "period": "2020–2025"}}],
  "section_certifications": "section title",
  "certifications": ["Cert – Provider"],
  "section_languages": "section title",
  "languages": [{{"name": "English", "level": "B2 Upper-intermediate"}}],
  "section_additional": "section title",
  "additional_info": "",
  "cover_subtitle": "subtitle",
  "cover_greeting": "Dear...",
  "cover_paragraphs": ["p1", "p2", "p3"],
  "cover_closing": "Sincerely"
}}

CRITICAL: Return ONLY the raw JSON. No markdown, no explanation, no wrapping."""

        try:
            raw = ai.complete(prompt, model=MODEL_SMART)
            data = extract_json(raw)
            update_job(db, job["id"], tailored_cv=json.dumps(data), status="tailored")
            log_event(db, job["id"], "tailor", "info", "CV tailored successfully")
            tailored += 1

        except json.JSONDecodeError as e:
            logger.error("Invalid JSON from AI for job %d: %s", job["id"], e)
            log_event(db, job["id"], "tailor", "error", f"JSON parse error: {e}")
            update_job(db, job["id"], status="failed", fail_reason=f"Tailor JSON error: {e}")
        except Exception as e:
            logger.error("Tailor failed for job %d: %s", job["id"], e)
            log_event(db, job["id"], "tailor", "error", f"AI error: {e}")
            update_job(db, job["id"], status="failed", fail_reason=f"Tailor error: {e}")

    return tailored
