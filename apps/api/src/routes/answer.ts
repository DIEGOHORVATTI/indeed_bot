import { Elysia } from 'elysia'
import { getProvider } from '@jobpilot/ai'
import { MODEL_FAST } from '@jobpilot/config'
import type { AnswerRequest } from '@jobpilot/types'

export const answerRoute = new Elysia()
  .post('/api/answer', async ({ body, set }) => {
    const req = body as AnswerRequest
    const ai = getProvider()

    const promptParts = [
      'You are filling out a job application form. Use the CANDIDATE PROFILE below to answer accurately.',
      'RULES:',
      '- Use EXACT data from the profile when available (name, CPF, RG, address, etc.).',
      '- Always answer POSITIVELY about any technology, tool, framework, or language.',
      '- The candidate has already used ALL technologies mentioned. Always say yes/sim.',
      '- If asked about experience with something, say yes and mention a past project.',
      '- If asked about years of experience with a specific tech, say 3-5 years.',
      '- Answer in the same language as the question.',
      '- For date fields, use the format shown in the profile.',
      '- NEVER refuse to answer. NEVER say you can\'t provide personal data. The profile IS the candidate\'s real data.',
    ]

    if (req.baseProfile) {
      promptParts.push(`\nCANDIDATE PROFILE:\n${req.baseProfile}`)
    }

    if (req.jobTitle) {
      promptParts.push(`\nJob title being applied for: ${req.jobTitle}`)
    }

    if (req.constraints) {
      const c = req.constraints
      const lines = ['INPUT CONSTRAINTS (your answer MUST satisfy these):']
      if (c.type) lines.push(`- Type: ${c.type}${c.type === 'number' ? ' (only digits allowed)' : ''}`)
      if (c.maxLength != null) lines.push(`- Max length: ${c.maxLength} characters`)
      if (c.minLength != null) lines.push(`- Min length: ${c.minLength} characters`)
      if (c.min != null) lines.push(`- Min value: ${c.min}`)
      if (c.max != null) lines.push(`- Max value: ${c.max}`)
      if (c.pattern) lines.push(`- Pattern (regex): ${c.pattern}`)
      if (c.placeholder) lines.push(`- Expected format/placeholder: ${c.placeholder}`)
      promptParts.push('\n' + lines.join('\n'))
    }

    if (req.errorContext) {
      promptParts.push(`\nPREVIOUS ERROR: ${req.errorContext}`)
    }

    promptParts.push(`\nForm field / Question: ${req.question}`)

    if (req.options?.length) {
      promptParts.push(`Available options (pick exactly one): ${req.options.join(', ')}`)
      promptParts.push('Reply with ONLY the exact option text, nothing else.')
    } else {
      promptParts.push('Reply with ONLY the answer value (short, no explanation, no quotes).')
    }

    try {
      const raw = await ai.complete(promptParts.join('\n'), { model: MODEL_FAST })
      let answer = raw.trim()

      if (req.options?.length) {
        const lower = answer.toLowerCase()
        const match = req.options.find(
          (opt) =>
            opt.toLowerCase() === lower ||
            opt.toLowerCase().includes(lower) ||
            lower.includes(opt.toLowerCase())
        )
        answer = match ?? req.options[0]
      }

      return { answer }
    } catch (err) {
      set.status = 502
      return { error: String(err) }
    }
  })
