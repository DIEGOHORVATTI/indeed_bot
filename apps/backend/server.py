"""
Backend API server for the Indeed Auto Apply Chrome extension.

Proxies AI requests to Claude CLI so the extension never needs API keys.
Run: uvicorn apps.backend.server:app --port 3000
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="Indeed Bot Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


# ── Request / Response models ──


class InputConstraints(BaseModel):
    type: str | None = None
    maxLength: int | None = None
    minLength: int | None = None
    min: str | None = None
    max: str | None = None
    pattern: str | None = None
    placeholder: str | None = None


class AnswerRequest(BaseModel):
    question: str
    options: list[str] | None = None
    jobTitle: str = ""
    baseProfile: str = ""
    constraints: InputConstraints | None = None
    errorContext: str | None = None


class AnswerResponse(BaseModel):
    answer: str | None


class TailorRequest(BaseModel):
    jobTitle: str
    jobCompany: str
    jobDescription: str
    baseCv: str
    baseCoverLetter: str


class PdfRequest(BaseModel):
    html: str
    filename: str | None = None  # optional: save a copy to output/


# ── Helpers ──


def _call_claude_cli(prompt: str, max_tokens: int = 4096) -> str:
    """Call Claude via CLI (uses your terminal's authenticated session)."""
    # Remove CLAUDECODE env var to avoid nested session detection
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    result = subprocess.run(
        ["claude", "-p", prompt, "--output-format", "text"],
        capture_output=True,
        text=True,
        timeout=180,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Claude CLI failed (exit {result.returncode}): {result.stderr[:500]}")
    return result.stdout.strip()


# ── Endpoints ──


@app.post("/api/answer", response_model=AnswerResponse)
async def answer_question(req: AnswerRequest):
    """Answer a job application form question using Claude CLI."""
    prompt_parts = [
        "You are filling out a job application form. Use the CANDIDATE PROFILE below to answer accurately.",
        "RULES:",
        "- Use EXACT data from the profile when available (name, CPF, RG, address, etc.).",
        "- Always answer POSITIVELY about any technology, tool, framework, or language.",
        "- The candidate has already used ALL technologies mentioned. Always say yes/sim.",
        "- If asked about experience with something, say yes and mention a past project.",
        "- If asked about years of experience with a specific tech, say 3-5 years.",
        "- Answer in the same language as the question.",
        "- For date fields, use the format shown in the profile.",
        "- NEVER refuse to answer. NEVER say you can't provide personal data. The profile IS the candidate's real data.",
    ]

    if req.baseProfile:
        prompt_parts.append(f"\nCANDIDATE PROFILE:\n{req.baseProfile}")

    if req.jobTitle:
        prompt_parts.append(f"\nJob title being applied for: {req.jobTitle}")

    if req.constraints:
        c = req.constraints
        constraint_lines = ["INPUT CONSTRAINTS (your answer MUST satisfy these):"]
        if c.type:
            constraint_lines.append(f"- Type: {c.type}" + (" (only digits allowed)" if c.type == "number" else ""))
        if c.maxLength is not None:
            constraint_lines.append(f"- Max length: {c.maxLength} characters")
        if c.minLength is not None:
            constraint_lines.append(f"- Min length: {c.minLength} characters")
        if c.min is not None:
            constraint_lines.append(f"- Min value: {c.min}")
        if c.max is not None:
            constraint_lines.append(f"- Max value: {c.max}")
        if c.pattern:
            constraint_lines.append(f"- Pattern (regex): {c.pattern}")
        if c.placeholder:
            constraint_lines.append(f"- Expected format/placeholder: {c.placeholder}")
        prompt_parts.append("\n" + "\n".join(constraint_lines))

    if req.errorContext:
        prompt_parts.append(f"\nPREVIOUS ERROR: {req.errorContext}")

    prompt_parts.append(f"\nForm field / Question: {req.question}")

    if req.options:
        prompt_parts.append(
            f"Available options (pick exactly one): {', '.join(req.options)}"
        )
        prompt_parts.append("Reply with ONLY the exact option text, nothing else.")
    else:
        prompt_parts.append("Reply with ONLY the answer value (short, no explanation, no quotes).")

    try:
        raw = _call_claude_cli("\n".join(prompt_parts))
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
    """Generate tailored CV/cover letter content using Claude CLI."""
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
        raw = _call_claude_cli(prompt)
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


@app.post("/api/generate-pdf")
async def generate_pdf(req: PdfRequest):
    """Convert HTML to PDF using Playwright. Saves a copy to output/ if filename provided."""
    from apps.backend.pdf import html_to_pdf

    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp_path = tmp.name

        html_to_pdf(req.html, tmp_path)

        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()

        os.unlink(tmp_path)

        # Save a copy to output/ directory
        if req.filename:
            output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, req.filename)
            with open(output_path, "wb") as f:
                f.write(pdf_bytes)

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={req.filename or 'document.pdf'}"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}")


@app.get("/health")
async def health():
    return {"status": "ok"}
