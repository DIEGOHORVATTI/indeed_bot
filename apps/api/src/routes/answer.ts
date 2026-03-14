import { Elysia, t } from 'elysia'
import { getProvider } from '@jobpilot/ai'
import { MODEL_FAST } from '@jobpilot/config'
import { getSetting } from '@jobpilot/db'
import type { AnswerRequest } from '@jobpilot/types'

const SYSTEM_RULES = [
  'Voce esta ajudando uma pessoa real a preencher o formulario de candidatura dela.',
  'O perfil abaixo foi escrito pela propria pessoa com suas informacoes reais.',
  'Voce deve responder cada campo como se fosse a propria pessoa digitando — tom casual, humano, sem parecer robo.',
  '',
  'ESTILO DE ESCRITA:',
  '- Escreva como uma pessoa normal escreveria, nao como um assistente de IA.',
  '- Use primeira pessoa: "Trabalho com...", "Tenho experiencia em...", "Ja atuei com...".',
  '- Tom casual e direto, como se estivesse conversando com o recrutador.',
  '- Pode ser breve quando o campo pede algo simples (nome, email, telefone).',
  '- Para campos de texto livre (resumo, experiencia, motivacao), escreva 2-4 frases naturais.',
  '- Evite linguagem corporativa generica. Seja especifico sobre o que esta no perfil.',
  '- Nao use bullet points nem formatacao markdown — texto corrido natural.',
  '- Nao exagere nem infle. Se o perfil diz "junior", nao diga "senior".',
  '',
  'REGRAS:',
  '- Para dados pessoais (nome, CPF, RG, endereco, telefone, email, LinkedIn), copie exatamente do perfil.',
  '- Para skills e tecnologias, mencione apenas as que estao no perfil.',
  '- Para experiencia, referencie posicoes e projetos reais do perfil.',
  '- Responda no mesmo idioma da pergunta.',
  '- Para campos de data, use DD/MM/YYYY ou o formato indicado pelo campo.',
  '- Se a informacao NAO esta no perfil, responda exatamente: __MISSING__',
  '- Para campos de salario: se o perfil menciona pretensao salarial, use. Senao: __MISSING__',
  '',
  'EXEMPLOS DE TOM CORRETO:',
  '- "Trabalho principalmente com React e Node.js, mas ja passei por projetos com Python e Go tambem."',
  '- "Tenho uns 4 anos com TypeScript, comecei usando no front e hoje uso em tudo."',
  '- "Sim, ja trabalhei com Docker e Kubernetes em producao, principalmente na AWS."',
  '- "Mobile eu tenho experiencia com React Native, mas nativo em Swift ainda nao peguei firme."',
  '',
  'EXEMPLOS DE TOM ERRADO (nunca faca isso):',
  '- "Possuo vasta experiencia em tecnologias de ponta..." (corporativo demais)',
  '- "Sou um profissional altamente qualificado..." (inflado)',
  '- "Tenho expertise em..." (ninguem fala assim)',
  '- "I am a highly motivated..." (robo)',
].join('\n')

function buildProfileContext(): string {
  try {
    const { getDb } = require('@jobpilot/db')
    const db = getDb()
    const row = db.select().from(require('@jobpilot/db').settings).where(require('drizzle-orm').eq(require('@jobpilot/db').settings.key, 'profile')).get()
    return row?.value || ''
  } catch {
    return ''
  }
}

function resolveProfile(reqProfile?: string): string {
  if (reqProfile && reqProfile.length > 50 && !reqProfile.includes('- Nome completo:\n')) return reqProfile
  const dbProfile = buildProfileContext()
  if (dbProfile && dbProfile.length > 50) return dbProfile
  return reqProfile || ''
}

function matchOption(answer: string, options: string[]): string {
  const lower = answer.toLowerCase()
  const exact = options.find((o) => o.toLowerCase() === lower)
  if (exact) return exact
  const includes = options.find((o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()))
  return includes ?? options[0]
}

export const answerRoute = new Elysia()
  .post('/api/answer', async ({ body, set }) => {
    const req = body as AnswerRequest
    const ai = getProvider()
    const profile = resolveProfile(req.baseProfile)

    const promptParts = [SYSTEM_RULES]
    if (profile) promptParts.push(`\nCANDIDATE PROFILE:\n${profile}`)
    if (req.jobTitle) promptParts.push(`\nJob being applied for: ${req.jobTitle}`)

    if (req.constraints) {
      const c = req.constraints
      const lines = ['INPUT CONSTRAINTS:']
      if (c.type) lines.push(`- Type: ${c.type}${c.type === 'number' ? ' (digits only)' : ''}`)
      if (c.maxLength != null) lines.push(`- Max length: ${c.maxLength}`)
      if (c.minLength != null) lines.push(`- Min length: ${c.minLength}`)
      if (c.min != null) lines.push(`- Min value: ${c.min}`)
      if (c.max != null) lines.push(`- Max value: ${c.max}`)
      if (c.pattern) lines.push(`- Regex: ${c.pattern}`)
      if (c.placeholder) lines.push(`- Format hint: ${c.placeholder}`)
      promptParts.push('\n' + lines.join('\n'))
    }

    if (req.errorContext) promptParts.push(`\nERRO ANTERIOR: ${req.errorContext}`)

    promptParts.push(`\nCampo do formulario: ${req.question}`)

    if (req.options?.length) {
      promptParts.push(`Opcoes disponiveis (escolha exatamente uma): ${req.options.join(', ')}`)
      promptParts.push('Responda APENAS com o texto exato da opcao.')
    } else {
      promptParts.push('Responda APENAS com o valor, como a pessoa digitaria. Sem explicacao, sem aspas.')
    }

    try {
      const raw = await ai.complete(promptParts.join('\n'), { model: MODEL_FAST })
      let answer = raw.trim()
      if (req.options?.length) answer = matchOption(answer, req.options)
      return { answer }
    } catch (err) {
      set.status = 502
      return { error: String(err) }
    }
  })

  .post('/api/answer-batch', async ({ body, set }) => {
    const { fields, jobTitle, baseProfile } = body as {
      fields: Array<{ id: string; question: string; options?: string[]; constraints?: Record<string, unknown> }>
      jobTitle?: string
      baseProfile?: string
    }
    const ai = getProvider()
    const profile = resolveProfile(baseProfile)

    const fieldDescriptions = fields.map((f, i) => {
      let desc = `[${i + 1}] "${f.question}"`
      if (f.options?.length) desc += ` (options: ${f.options.join(', ')})`
      if (f.constraints) {
        const c = f.constraints as Record<string, unknown>
        if (c.type) desc += ` [type: ${c.type}]`
        if (c.maxLength) desc += ` [max: ${c.maxLength}]`
      }
      return desc
    }).join('\n')

    const prompt = [
      SYSTEM_RULES,
      profile ? `\nCANDIDATE PROFILE:\n${profile}` : '',
      jobTitle ? `\nJob: ${jobTitle}` : '',
      '\nCAMPOS PARA PREENCHER (responda todos de uma vez):',
      fieldDescriptions,
      '\nResponda em JSON: { "answers": { "1": "valor", "2": "valor", ... } }',
      'Para cada campo, responda como a propria pessoa digitaria — tom natural e humano.',
      'Se tem opcoes, use o texto exato da opcao.',
      'Se o dado NAO esta no perfil, use "__MISSING__" como valor.',
      'Retorne APENAS o JSON valido, nada mais.',
    ].filter(Boolean).join('\n')

    try {
      const raw = await ai.complete(prompt, { model: MODEL_FAST })
      const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(cleaned) as { answers: Record<string, string> }

      const results: Record<string, { answer: string | null; missing: boolean }> = {}

      for (const field of fields) {
        const idx = fields.indexOf(field) + 1
        let answer = parsed.answers[String(idx)] || null
        const isMissing = answer === '__MISSING__'

        if (isMissing) {
          results[field.id] = { answer: null, missing: true }
          continue
        }

        if (answer && field.options?.length) {
          answer = matchOption(answer, field.options)
        }

        results[field.id] = { answer, missing: false }
      }

      return { results }
    } catch (err) {
      set.status = 502
      return { error: String(err) }
    }
  })
