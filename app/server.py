"""
Backend API server for the Indeed Auto Apply Chrome extension.

Proxies AI requests to Claude so the extension never sees API keys or model names.
Run: uvicorn app.server:app --port 3000
"""

from __future__ import annotations

import json
import os

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

HAIKU = "claude-haiku-4-5-20251001"
SONNET = "claude-sonnet-4-20250514"

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

app = FastAPI(title="Indeed Bot Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


# ── Request / Response models ──


class AnswerRequest(BaseModel):
    question: str
    options: list[str] | None = None
    jobTitle: str = ""


class AnswerResponse(BaseModel):
    answer: str | None


class TailorRequest(BaseModel):
    jobTitle: str
    jobCompany: str
    jobDescription: str
    baseCv: str
    baseCoverLetter: str


# ── Helpers ──


def _call_claude(prompt: str, model: str = HAIKU, max_tokens: int = 1024) -> str:
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


# ── Endpoints ──


@app.post("/api/answer", response_model=AnswerResponse)
async def answer_question(req: AnswerRequest):
    """Answer a job application form question using Haiku (fast/cheap)."""
    prompt_parts = [
        "You are filling out a job application form for a developer with 5+ years of experience.",
        "RULES:",
        "- Always answer POSITIVELY about any technology, tool, framework, or language.",
        "- The candidate has already used ALL technologies mentioned. Always say yes/sim.",
        "- If asked about experience with something, mention a past private/enterprise project.",
        "- If asked about years of experience with a specific tech, say 3-5 years.",
        "- Prefer PJ (contractor) over CLT when asked about employment model.",
        "- The candidate is NOT a person with disability (PCD).",
        "- Answer in the same language as the question.",
    ]

    if req.jobTitle:
        prompt_parts.append(f"Job title: {req.jobTitle}")

    prompt_parts.append(f"Question: {req.question}")

    if req.options:
        prompt_parts.append(
            f"Available options (pick exactly one): {', '.join(req.options)}"
        )
        prompt_parts.append("Reply with ONLY the exact option text, nothing else.")
    else:
        prompt_parts.append("Reply with ONLY the answer value (short, no explanation).")

    try:
        raw = _call_claude("\n".join(prompt_parts), model=HAIKU, max_tokens=256)
        answer = raw.strip()

        if req.options:
            lower = answer.lower()
            for opt in req.options:
                if (
                    opt.lower() == lower
                    or opt.lower() in lower
                    or lower in opt.lower()
                ):
                    return AnswerResponse(answer=opt)
            return AnswerResponse(answer=req.options[0])

        return AnswerResponse(answer=answer)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/tailor")
async def tailor_cv(req: TailorRequest):
    """Generate tailored CV/cover letter content using Sonnet (smarter)."""
    desc = req.jobDescription[:4000]

    prompt = f"""You are an expert recruiter and CV strategist. Your goal is to produce a HIGH-CONVERSION CV tailored to a specific job posting. The CV must pass ATS (Applicant Tracking Systems) and grab a recruiter's attention in under 10 seconds.

You must ONLY return text content as JSON. Do NOT generate any HTML.

JOB POSTING:
Title: {req.jobTitle or 'N/A'}
Company: {req.jobCompany or 'N/A'}
Description:
{desc}

BASE CV (source of truth - keep all facts, only reorder/emphasize):
{req.baseCv}

BASE COVER LETTER (adapt tone and content for this specific role):
{req.baseCoverLetter}

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
6. PROJECTS: Select 2-3 projects most relevant to this job.
7. EDUCATION: Include all education entries from the base CV.
8. CERTIFICATIONS: List certifications and courses separately.
9. LANGUAGES: Include language name and proficiency level.
10. ADDITIONAL INFO: Only include if genuinely relevant.
11. COVER LETTER: 3-4 paragraphs. Hook with company interest, concrete examples, call to action.

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
  "section_projects": "section title",
  "projects": [{{"name": "Name", "url": "https://...", "description": "one-line"}}],
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
        raw = _call_claude(prompt, model=SONNET, max_tokens=4096)
        output = raw.strip()

        # Strip markdown fences if present
        if output.startswith("```"):
            lines = output.split("\n")
            output = "\n".join(l for l in lines if not l.startswith("```"))

        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Invalid JSON from AI: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/health")
async def health():
    return {"status": "ok"}
