import { Elysia } from 'elysia'
import { getProvider, extractJson } from '@jobpilot/ai'
import { MODEL_SMART } from '@jobpilot/config'
import type { TailorRequest } from '@jobpilot/types'

export const tailorRoute = new Elysia()
  .post('/api/tailor', async ({ body, set }) => {
    const req = body as TailorRequest
    const ai = getProvider()
    const desc = req.jobDescription.slice(0, 4000)

    const prompt = `You are an expert recruiter and CV strategist. Your goal is to produce a HIGH-CONVERSION CV tailored to a specific job posting. The CV must pass ATS (Applicant Tracking Systems) and grab a recruiter's attention in under 10 seconds.

You must ONLY return text content as JSON. Do NOT generate any HTML.

JOB POSTING:
Title: ${req.jobTitle || 'N/A'}
Company: ${req.jobCompany || 'N/A'}
Description:
${desc}

BASE CV (source of truth - keep all facts, only reorder/emphasize):
${req.baseCv}

BASE COVER LETTER (adapt tone and content for this specific role):
${req.baseCoverLetter}

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

{
  "objective": "target role",
  "section_summary": "section title",
  "summary": "2-3 sentence professional summary",
  "keywords": ["TypeScript", "React", "..."],
  "section_skills": "section title",
  "skills": [{"label": "Front-End", "items": "React.js, Next.js, ..."}],
  "section_experience": "section title",
  "experience": [{"title": "job title", "date": "01/2024 – Present", "company": "Company · Location", "bullets": ["..."]}],
  "section_education": "section title",
  "education": [{"degree": "CS – Bachelor", "institution": "University", "period": "2020–2025"}],
  "section_certifications": "section title",
  "certifications": ["Cert – Provider"],
  "section_languages": "section title",
  "languages": [{"name": "English", "level": "B2 Upper-intermediate"}],
  "section_additional": "section title",
  "additional_info": "",
  "cover_subtitle": "subtitle",
  "cover_greeting": "Dear...",
  "cover_paragraphs": ["p1", "p2", "p3"],
  "cover_closing": "Sincerely"
}

CRITICAL: Return ONLY the raw JSON. No markdown, no explanation, no wrapping.`

    try {
      const raw = await ai.complete(prompt, { model: MODEL_SMART })
      const data = extractJson(raw)
      return data
    } catch (err) {
      if (err instanceof SyntaxError) {
        set.status = 502
        return { error: `JSON inválido da IA: ${err.message}` }
      }
      set.status = 502
      return { error: String(err) }
    }
  })
