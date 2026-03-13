import { Elysia, t } from 'elysia'
import { getDb, getCvs, getCvById, insertCv, updateCv, incrementCvScore, deleteCv, getSetting } from '@jobpilot/db'
import { getProvider } from '@jobpilot/ai'
import { MODEL_SMART } from '@jobpilot/config'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..')
const CV_TEMPLATE = readFileSync(resolve(REPO_ROOT, 'templates', 'cv_template.html'), 'utf-8')

const PALETTES: Record<string, { primary: string; accent: string }> = {
  profissional: { primary: '#1B2A4A', accent: '#2E5FA3' },
  executivo: { primary: '#2C2C2C', accent: '#B8962E' },
  moderno: { primary: '#1E3A3A', accent: '#2A9D8F' },
  classico: { primary: '#1A3A2A', accent: '#2D6A4F' },
  criativo: { primary: '#5C1A2E', accent: '#8B2E4A' },
  minimalista: { primary: '#1A1A1A', accent: '#4A4A4A' },
}

function applyPalette(html: string, paletteId: string): string {
  const p = PALETTES[paletteId] || PALETTES.profissional
  return html
    .replaceAll('#16213e', p.primary)
    .replaceAll('#e94560', p.accent)
    .replaceAll('rgba(233, 69, 96,', `rgba(${parseInt(p.accent.slice(1, 3), 16)}, ${parseInt(p.accent.slice(3, 5), 16)}, ${parseInt(p.accent.slice(5, 7), 16)},`)
}

function fillTemplate(template: string, fields: Record<string, string>): string {
  let html = template
  for (const [key, value] of Object.entries(fields)) {
    html = html.replaceAll(`{{${key}}}`, value)
  }
  return html
}

const GENERATE_PROMPT = `Voce e um especialista em carreira. Com base nos dados do candidato e na vaga alvo, gere o conteudo para um curriculo profissional.

## DADOS DO CANDIDATO
\${candidateData}

## VAGA ALVO
\${jobDescription}

## INSTRUCOES ADICIONAIS
\${extraInstructions}

## REGRAS
- Escreva na primeira pessoa implicita (sem "Eu"), tom profissional e humano
- Use frases de tamanho variado, misture curtas com longas
- Conquistas no formato: [Verbo forte] + [o que] + [resultado mensuravel]
- Minimo 60% das bullets com numeros reais (%, R$, quantidade, tempo)
- Identifique 8-10 keywords da vaga e insira naturalmente no texto
- NUNCA use: Delve, pivotal, realm, intricate, showcasing, facilitate, streamline, spearheaded, synergy, results-driven, accomplished professional, dynamic, passionate, innovative, detail-oriented, team player

## PROIBICOES ABSOLUTAS (violar qualquer uma invalida o curriculo)
- ZERO travessoes (—). Nunca. Use ponto final ou virgula.
- ZERO emojis. Nenhum. Jamais.
- ZERO frases genericas vazias ("Vivemos em um mundo em constante transformacao", "O mercado esta cada vez mais competitivo"). Se a frase nao contem informacao especifica do candidato, delete.
- ZERO repeticao de ideia com palavras diferentes. Diga uma vez, com precisao, e siga em frente.
- ZERO tom motivacional/coach ("Pequenas acoes diarias levam a grandes resultados", "Acredito no poder da colaboracao"). Curriculo e documento tecnico, nao post de LinkedIn.
- ZERO estrutura redacao-ENEM (introducao generica + desenvolvimento + conclusao). Va direto ao ponto.
- ZERO adjetivos inflados sem evidencia ("inovador", "poderoso", "transformador", "disruptivo"). Cada adjetivo precisa de um numero ou fato concreto ao lado.
- ZERO neutralidade covarde. Tome posicao: o candidato e bom em X especifico, entregou Y mensuravel. Sem rodeios.

## FORMATO DE RESPOSTA
Retorne SOMENTE um JSON valido (sem markdown, sem comentarios) com estes campos:

{
  "profile_name": "Nome completo",
  "objective": "Titulo profissional / objetivo (ex: Desenvolvedor Full Stack Senior)",
  "profile_contact": "HTML com contato usando separadores. Formato: email <span class=\\"sep\\">|</span> telefone <span class=\\"sep\\">|</span> <a href=\\"url\\">LinkedIn</a> <span class=\\"sep\\">|</span> cidade",
  "section_summary": "RESUMO PROFISSIONAL",
  "summary": "Paragrafo de 3-4 linhas resumindo experiencia e diferenciais",
  "keywords": "HTML com badges das keywords. Formato: <span class=\\"badge\\">Keyword1</span><span class=\\"badge\\">Keyword2</span>...",
  "section_skills": "COMPETENCIAS TECNICAS",
  "skills": "HTML com grid de skills. Formato: <div class=\\"row\\"><span class=\\"label\\">Front-End:</span> React, TypeScript...</div><div class=\\"row\\">...</div>",
  "section_experience": "EXPERIENCIA PROFISSIONAL",
  "experience": "HTML com cada emprego. Formato para cada: <div class=\\"job\\"><div class=\\"job-header\\"><span class=\\"job-title\\">Cargo</span><span class=\\"job-date\\">periodo</span></div><div class=\\"job-company\\">Empresa - Regime - Local</div><ul><li>conquista 1</li><li>conquista 2</li></ul></div>",
  "section_education": "FORMACAO ACADEMICA",
  "education": "HTML. Formato: <strong>Curso</strong> - Instituicao (periodo)",
  "section_certifications": "CERTIFICACOES",
  "certifications": "HTML. Formato: <ul><li>Certificacao - Emissor (data)</li></ul>",
  "section_languages": "IDIOMAS",
  "languages": "HTML. Formato: <strong>Idioma:</strong> Nivel",
  "additional_info": ""
}`

export const cvsRoute = new Elysia()
  .get('/api/cvs', () => {
    const db = getDb()
    const all = getCvs(db)
    return all.map(cv => ({ ...cv, htmlContent: undefined }))
  })

  .get('/api/cvs/:id', ({ params, set }) => {
    const db = getDb()
    const cv = getCvById(db, Number(params.id))
    if (!cv) {
      set.status = 404
      return { error: 'CV não encontrado' }
    }
    return cv
  })

  .post('/api/cvs', ({ body }) => {
    const db = getDb()
    const id = insertCv(db, {
      name: body.name,
      htmlContent: body.htmlContent,
      variant: body.variant,
      jobId: body.jobId,
      jobTitle: body.jobTitle,
      jobCompany: body.jobCompany,
      templateId: body.templateId,
      paletteId: body.paletteId,
      promptUsed: body.promptUsed,
    })
    return { id }
  }, {
    body: t.Object({
      name: t.String(),
      htmlContent: t.String(),
      variant: t.Optional(t.String()),
      jobId: t.Optional(t.Number()),
      jobTitle: t.Optional(t.String()),
      jobCompany: t.Optional(t.String()),
      templateId: t.Optional(t.String()),
      paletteId: t.Optional(t.String()),
      promptUsed: t.Optional(t.String()),
    }),
  })

  .post('/api/cvs/generate', async ({ body, set }) => {
    const ai = getProvider()
    const db = getDb()

    const candidateData = body.candidateData || getSetting(db, 'profile') || ''
    if (!candidateData) {
      set.status = 400
      return { error: 'Perfil do candidato nao encontrado. Configure seu perfil em Configuracoes.' }
    }

    const jobDescription = body.jobDescription || 'Nenhuma vaga especifica — gere um curriculo generico otimizado.'
    const extra = body.extraInstructions || 'Nenhuma instrucao adicional.'
    const prompt = GENERATE_PROMPT
      .replace('${candidateData}', candidateData)
      .replace('${jobDescription}', jobDescription)
      .replace('${extraInstructions}', extra)

    try {
      const raw = await ai.complete(prompt, { model: MODEL_SMART })

      let fields: Record<string, string>
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        fields = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw)
      } catch {
        set.status = 502
        return { error: 'IA retornou formato invalido. Tente novamente.' }
      }

      let html = fillTemplate(CV_TEMPLATE, fields)
      if (body.paletteId) {
        html = applyPalette(html, body.paletteId)
      }

      const id = insertCv(db, {
        name: body.name || `CV ${new Date().toLocaleDateString('pt-BR')}`,
        htmlContent: html,
        promptUsed: prompt,
        jobId: body.jobId || null,
        jobTitle: body.jobTitle || null,
        jobCompany: body.jobCompany || null,
        templateId: body.templateId || 'classic',
        paletteId: body.paletteId || null,
      })

      return { id, htmlContent: html }
    } catch (err) {
      set.status = 502
      return { error: `Erro ao gerar CV: ${err}` }
    }
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      candidateData: t.Optional(t.String()),
      jobDescription: t.Optional(t.String()),
      extraInstructions: t.Optional(t.String()),
      jobId: t.Optional(t.Number()),
      jobTitle: t.Optional(t.String()),
      jobCompany: t.Optional(t.String()),
      templateId: t.Optional(t.String()),
      paletteId: t.Optional(t.String()),
    }),
  })

  .patch('/api/cvs/:id', ({ params, body, set }) => {
    const db = getDb()
    const id = Number(params.id)
    const cv = getCvById(db, id)
    if (!cv) {
      set.status = 404
      return { error: 'CV nao encontrado' }
    }
    const fields: Record<string, string | null> = {}
    if (body.paletteId !== undefined) fields.paletteId = body.paletteId
    if (body.templateId !== undefined) fields.templateId = body.templateId
    updateCv(db, id, fields)
    return getCvById(db, id)
  }, {
    body: t.Object({
      paletteId: t.Optional(t.String()),
      templateId: t.Optional(t.String()),
    }),
  })

  .post('/api/cvs/:id/score', ({ params }) => {
    const db = getDb()
    incrementCvScore(db, Number(params.id))
    return { ok: true }
  })

  .delete('/api/cvs/:id', ({ params }) => {
    const db = getDb()
    deleteCv(db, Number(params.id))
    return { ok: true }
  })
