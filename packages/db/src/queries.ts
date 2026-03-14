import { eq, desc, sql, and, gte, lte, count, inArray, like } from 'drizzle-orm'
import { getDb } from './connection.js'
import { jobs, logs, settings, cvs } from './schema.js'
import type { Job, StatsEntry, SearchesConfig, Platform } from '@jobpilot/types'

type DB = ReturnType<typeof getDb>

function normalizeJobUrl(raw: string): string {
  try {
    const parsed = new URL(raw)
    if (parsed.hostname.includes('indeed.com')) {
      const jk = parsed.searchParams.get('jk') || parsed.searchParams.get('vjk')
      if (jk) {
        return `https://${parsed.hostname}/viewjob?jk=${jk}`
      }
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return raw
  }
}

export function insertJob(
  db: DB,
  data: {
    url: string
    source: string
    title: string
    company: string
    location?: string | null
    salary?: string | null
    datePosted?: string | null
    searchQuery?: string | null
    description?: string | null
    applyType?: string | null
    jobKey?: string | null
  }
): number | null {
  const status = data.description ? 'enriched' : 'discovered'
  const url = normalizeJobUrl(data.url)
  try {
    const result = db
      .insert(jobs)
      .values({ ...data, url, status })
      .onConflictDoNothing({ target: jobs.url })
      .returning({ id: jobs.id })
      .get()
    return result?.id ?? null
  } catch {
    return null
  }
}

export function getJobs(
  db: DB,
  opts?: {
    status?: string
    source?: string
    applyType?: string
    scoreMin?: number
    scoreMax?: number
    dateFrom?: string
    dateTo?: string
    search?: string
    limit?: number
  }
): Job[] {
  const limit = opts?.limit ?? 100
  const conditions = []

  if (opts?.status) conditions.push(eq(jobs.status, opts.status))
  if (opts?.source) conditions.push(eq(jobs.source, opts.source))
  if (opts?.applyType) conditions.push(eq(jobs.applyType, opts.applyType))
  if (opts?.scoreMin != null) conditions.push(gte(jobs.score, opts.scoreMin))
  if (opts?.scoreMax != null) conditions.push(lte(jobs.score, opts.scoreMax))
  if (opts?.dateFrom) conditions.push(gte(jobs.createdAt, opts.dateFrom))
  if (opts?.dateTo) conditions.push(lte(jobs.createdAt, opts.dateTo))
  if (opts?.search) conditions.push(like(jobs.title, `%${opts.search}%`))

  const query = db.select().from(jobs)
  const filtered = conditions.length > 0
    ? query.where(and(...conditions))
    : query

  return filtered
    .orderBy(desc(jobs.score))
    .limit(limit)
    .all() as Job[]
}

export function getJobById(db: DB, id: number): Job | undefined {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.id, id))
    .get() as Job | undefined
}

export function getJobByUrl(db: DB, url: string): Job | undefined {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.url, normalizeJobUrl(url)))
    .get() as Job | undefined
}

export function updateJob(
  db: DB,
  jobId: number,
  fields: Partial<Omit<Job, 'id' | 'createdAt'>>
): void {
  db.update(jobs)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(eq(jobs.id, jobId))
    .run()
}

export function logEvent(
  db: DB,
  jobId: number | null,
  stage: string,
  level: string,
  message: string
): void {
  db.insert(logs)
    .values({ jobId, stage, level, message })
    .run()
}

export function getStats(db: DB): StatsEntry[] {
  const rows = db
    .select({
      status: jobs.status,
      count: count(),
    })
    .from(jobs)
    .groupBy(jobs.status)
    .orderBy(desc(count()))
    .all()
  return rows.map((r) => ({ status: r.status as Job['status'], count: r.count }))
}

export function resetFailed(db: DB): number {
  const failed = db
    .select({ cnt: count() })
    .from(jobs)
    .where(eq(jobs.status, 'failed'))
    .get()
  const total = failed?.cnt ?? 0

  if (total > 0) {
    db.update(jobs)
      .set({
        status: 'discovered',
        failReason: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(jobs.status, 'failed'))
      .run()
  }

  return total
}

export function deleteJobs(db: DB, ids: number[]): number {
  if (ids.length === 0) return 0
  db.delete(jobs).where(inArray(jobs.id, ids)).run()
  return ids.length
}

export function exportJobs(db: DB): Job[] {
  return db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .all() as Job[]
}

// ── Settings ──

export function getSetting(db: DB, key: string): string | null {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get()
  return row?.value ?? null
}

export function setSetting(db: DB, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
    .run()
}

export function getAllSettings(db: DB): Record<string, string> {
  const rows = db.select().from(settings).all()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export function loadProfile(): string {
  const db = getDb()
  return getSetting(db, 'profile') || ''
}

export function loadSearches(): SearchesConfig {
  const db = getDb()
  const raw = getSetting(db, 'searches')
  if (!raw) return { searches: [] }
  try {
    return JSON.parse(raw) as SearchesConfig
  } catch {
    return { searches: [] }
  }
}

export function loadPlatforms(): Platform[] {
  const db = getDb()
  const raw = getSetting(db, 'platforms')
  if (!raw) return ['indeed']
  try {
    return JSON.parse(raw) as Platform[]
  } catch {
    return ['indeed']
  }
}

// ── CVs ──

export interface CvRow {
  id: number
  name: string
  variant: string
  htmlContent: string
  promptUsed: string | null
  jobId: number | null
  jobTitle: string | null
  jobCompany: string | null
  score: number
  templateId: string | null
  createdAt: string
}

export function updateCv(
  db: DB,
  id: number,
  fields: Partial<{ name: string; variant: string; templateId: string | null; paletteId: string | null; htmlContent: string }>
): void {
  db.update(cvs).set(fields).where(eq(cvs.id, id)).run()
}

export function insertCv(
  db: DB,
  data: {
    name: string
    variant?: string
    htmlContent: string
    promptUsed?: string
    jobId?: number | null
    jobTitle?: string | null
    jobCompany?: string | null
    templateId?: string | null
    paletteId?: string | null
  }
): number {
  const result = db
    .insert(cvs)
    .values(data)
    .returning({ id: cvs.id })
    .get()
  return result.id
}

export function getCvs(db: DB): CvRow[] {
  return db
    .select()
    .from(cvs)
    .orderBy(desc(cvs.createdAt))
    .all() as CvRow[]
}

export function getCvById(db: DB, id: number): CvRow | undefined {
  return db
    .select()
    .from(cvs)
    .where(eq(cvs.id, id))
    .get() as CvRow | undefined
}

export function incrementCvScore(db: DB, id: number): void {
  db.update(cvs)
    .set({ score: sql`${cvs.score} + 1` })
    .where(eq(cvs.id, id))
    .run()
}

export function deleteCv(db: DB, id: number): void {
  db.delete(cvs).where(eq(cvs.id, id)).run()
}

export function getAppliedCount(
  db: DB,
  since: 'hour' | 'day'
): number {
  const interval = since === 'hour' ? '-1 hour' : '-1 day'
  const rows = db
    .select({ cnt: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'applied'),
        gte(jobs.updatedAt, sql`datetime('now', ${interval})`)
      )
    )
    .all()
  return rows[0]?.cnt ?? 0
}
