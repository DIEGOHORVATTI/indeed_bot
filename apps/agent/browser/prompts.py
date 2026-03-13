"""Prompt templates for browser-based job application."""

from __future__ import annotations


def build_apply_prompt(
    job: dict,
    profile: dict,
    cv_pdf_path: str,
    cover_pdf_path: str,
    dry_run: bool = False,
) -> str:
    """Build the prompt for Claude CLI to apply to a job via browser."""
    submit_instruction = (
        "Fill everything but DO NOT click the final submit button. Stop just before submission."
        if dry_run
        else "After filling all fields, click the submit/apply button to complete the application."
    )

    return f"""You are applying to a job on behalf of a candidate. Use the Playwright browser tools to complete this application.

JOB URL: {job.get('url', '')}
JOB TITLE: {job.get('title', '')}
COMPANY: {job.get('company', '')}

CANDIDATE INFO:
- Name: {profile.get('name', '')}
- Email: {profile.get('email', '')}
- Phone: {profile.get('phone', '')}
- Location: {profile.get('location', '')}
- LinkedIn: {profile.get('linkedin', '')}
- GitHub: {profile.get('github', '')}
- Portfolio: {profile.get('portfolio', '')}

CV PDF PATH: {cv_pdf_path}
COVER LETTER PDF PATH: {cover_pdf_path}

INSTRUCTIONS:
1. Navigate to the job URL
2. Click the "Apply" or "Apply Now" button
3. If a login/signup page appears, report status as "login_required"
4. Fill in all required form fields using the candidate info above
5. Upload the CV PDF when a resume upload field is available
6. Upload the Cover Letter PDF if there is a cover letter upload field
7. For any question fields, answer positively about all technologies and tools
8. If asked about years of experience with a specific technology, say 3-5 years
9. {submit_instruction}

IMPORTANT:
- If you encounter a CAPTCHA, stop and report status as "captcha"
- If you detect anti-bot measures, stop and report status as "antibot"
- If the application requires creating an account, report status as "login_required"
- Do not spend more than 5 minutes on a single application

After completing (or failing), respond with ONLY a JSON object:
{{"status": "applied"|"captcha"|"antibot"|"login_required"|"failed", "reason": "brief explanation"}}"""
