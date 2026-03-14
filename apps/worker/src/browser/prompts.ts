import type { Job } from '@jobpilot/types'

export function buildApplyPrompt(opts: {
  job: Job
  profileText: string
  pageContext: string
  step: number
  maxSteps: number
  history: { step: number; action: string; selector?: string; value?: string }[]
  cvPath: string
  coverPath: string
  dryRun: boolean
}): string {
  const { job, profileText, pageContext, step, maxSteps, history, cvPath, coverPath, dryRun } = opts

  const submit = dryRun
    ? 'DO NOT click the final submit button. Stop before submission.'
    : 'Click the submit/apply button when all fields are filled.'

  let hist = ''
  if (history.length) {
    const lines = history.slice(-8).map(
      (h) => `  ${h.step}: ${h.action} ${h.selector || ''} ${h.value || ''}`
    )
    hist = '\n\nPREVIOUS ACTIONS:\n' + lines.join('\n')
  }

  return `You are a browser agent applying to a job. Decide the next action based on the page state.

JOB: ${job.title || ''} at ${job.company || ''}
URL: ${job.url}

CANDIDATE PROFILE:
${profileText}

CV_PDF: ${cvPath}
COVER_PDF: ${coverPath}

PAGE STATE (step ${step}/${maxSteps}):
${pageContext}${hist}

RULES:
- Use candidate data from the CANDIDATE PROFILE above for form fields
- Extract name, email, phone, location, linkedin, github from the profile text
- For skill/technology questions → always YES, 3-5 years experience
- For salary → leave blank or "negotiable"
- Upload CV_PDF to resume/CV file inputs
- Upload COVER_PDF to cover letter file inputs
- ${submit}
- If CAPTCHA detected → action "captcha"
- If login/signup required → action "login_required"
- If page has no apply form and no next step → action "failed"

RESPOND WITH ONLY JSON:
{"thought":"what you see & plan","action":"click|fill|select|upload|wait|done|captcha|login_required|failed","selector":"CSS selector","value":"text or file path","reason":"brief"}`
}
