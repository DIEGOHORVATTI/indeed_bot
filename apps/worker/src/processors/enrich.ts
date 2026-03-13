import type { Job } from 'bullmq'
import * as cheerio from 'cheerio'
import { getDb, getJobById, updateJob, logEvent } from '@jobpilot/db'
import { randomUserAgent, randomDelay, DELAY_PAGE } from '@jobpilot/anti-detection'

function extractDescription(html: string): string | null {
  const $ = cheerio.load(html)

  // Strategy 1: JSON-LD JobPosting
  const ldScripts = $('script[type="application/ld+json"]')
  for (let i = 0; i < ldScripts.length; i++) {
    try {
      let data = JSON.parse($(ldScripts[i]).text() || '{}')
      if (Array.isArray(data)) {
        data = data.find((d: Record<string, unknown>) => d['@type'] === 'JobPosting')
      }
      if (data?.['@type'] === 'JobPosting' && data.description) {
        const desc = cheerio.load(data.description as string).text().trim()
        if (desc) return desc
      }
    } catch {
      // ignore parse errors
    }
  }

  // Strategy 2: meta description
  const meta = $('meta[name="description"]').attr('content')?.trim()
  if (meta && meta.length > 100) return meta

  // Strategy 3: common job description containers
  const selectors = [
    '#jobDescriptionText',
    '.jobsearch-jobDescriptionText',
    '[class*="description"]',
    '[class*="jobDescription"]',
    'article',
    'main',
  ]
  for (const sel of selectors) {
    const text = $(sel).first().text().trim()
    if (text.length > 100) return text
  }

  // Fallback: body text
  const body = $('body').text().trim()
  if (body.length > 100) return body.slice(0, 5000)

  return null
}

export async function processEnrich(job: Job<{ jobId: number }>): Promise<{ jobIds: number[] }> {
  const db = getDb()
  const dbJob = getJobById(db, job.data.jobId)
  if (!dbJob) return { jobIds: [] }

  console.log(`[enrich] Buscando: ${dbJob.url}`)

  try {
    const resp = await fetch(dbJob.url, {
      headers: { 'User-Agent': randomUserAgent() },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      logEvent(db, dbJob.id, 'enrich', 'warning', `Falha na busca: ${resp.status}`)
      return { jobIds: [] }
    }

    const html = await resp.text()
    const description = extractDescription(html)

    if (description) {
      updateJob(db, dbJob.id, { description, status: 'enriched' })
      logEvent(db, dbJob.id, 'enrich', 'info', `Enriquecida (${description.length} caracteres)`)
    } else {
      // Move to enriched anyway so pipeline continues
      updateJob(db, dbJob.id, { status: 'enriched' })
      logEvent(db, dbJob.id, 'enrich', 'warning', 'Nenhuma descrição extraída')
    }

    await randomDelay(...DELAY_PAGE)
    return { jobIds: [dbJob.id] }
  } catch (err) {
    logEvent(db, dbJob.id, 'enrich', 'warning', `Erro na busca: ${err}`)
    return { jobIds: [] }
  }
}
