import type { Job } from 'bullmq'
import { getDb, getJobById, updateJob, logEvent } from '@jobpilot/db'
import { getProvider, extractJson } from '@jobpilot/ai'
import { MODEL_SMART } from '@jobpilot/config'
import { loadProfile } from '@jobpilot/db'

export async function processTailor(job: Job<{ jobId: number }>): Promise<{ jobIds: number[] }> {
  const db = getDb()
  const dbJob = getJobById(db, job.data.jobId)
  if (!dbJob) return { jobIds: [] }

  const ai = getProvider()
  const profileText = loadProfile()
  const desc = (dbJob.description || '').slice(0, 4000)

  console.log(`[tailor] Personalizando CV para: ${dbJob.title} em ${dbJob.company}`)

  const prompt = `You are an expert recruiter and CV strategist. Your goal is to produce a HIGH-CONVERSION CV tailored to a specific job posting. The CV must pass ATS (Applicant Tracking Systems) and grab a recruiter's attention in under 10 seconds.

You must ONLY return text content as JSON. Do NOT generate any HTML.

JOB POSTING:
Title: ${dbJob.title || 'N/A'}
Company: ${dbJob.company || 'N/A'}
Description:
${desc}

CANDIDATE PROFILE (free text — extract all relevant info):
${profileText}

LANGUAGE RULE (CRITICAL): Detect the language of the job description.
- If Portuguese → write everything in PT-BR.
- If English → write everything in English.
- Default to Portuguese for br.indeed.com jobs.

HIGH-CONVERSION RULES:
1. CONTACT: Extract name, email, phone, location, linkedin, github, portfolio from the profile text above.
2. OBJECTIVE: Write a single clear sentence stating the target role.
3. SUMMARY: Max 3 lines. Lead with years of experience + SPECIFIC FRAMEWORKS.
4. KEYWORDS: Extract top 8-12 technologies from BOTH job posting AND profile.
5. SKILLS: Group by category. Most job-relevant first.
6. EXPERIENCE: ALL jobs from profile. Action verbs, specific tools, quantifiable results.
7. EDUCATION: All entries from profile.
8. CERTIFICATIONS: List separately.
9. LANGUAGES: Name and proficiency level.
10. ADDITIONAL INFO: Only if genuinely relevant.
11. COVER LETTER: 3-4 paragraphs.

Return ONLY a JSON object with keys: profile_name, profile_email, profile_phone, profile_location, profile_linkedin, profile_github, profile_portfolio, objective, section_summary, summary, keywords, section_skills, skills, section_experience, experience, section_education, education, section_certifications, certifications, section_languages, languages, section_additional, additional_info, cover_subtitle, cover_greeting, cover_paragraphs, cover_closing.

CRITICAL: Return ONLY the raw JSON. No markdown, no explanation, no wrapping.`

  try {
    const raw = await ai.complete(prompt, { model: MODEL_SMART })
    const data = extractJson(raw)
    updateJob(db, dbJob.id, { tailoredCv: JSON.stringify(data), status: 'tailored' })
    logEvent(db, dbJob.id, 'tailor', 'info', 'CV personalizado com sucesso')
    return { jobIds: [dbJob.id] }
  } catch (err) {
    logEvent(db, dbJob.id, 'tailor', 'error', `Erro na personalização: ${err}`)
    updateJob(db, dbJob.id, { status: 'failed', failReason: `Erro na personalização: ${err}` })
    return { jobIds: [] }
  }
}
