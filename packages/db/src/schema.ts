import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    url: text('url').notNull().unique(),
    source: text('source'),
    title: text('title'),
    company: text('company'),
    location: text('location'),
    salary: text('salary'),
    datePosted: text('date_posted'),
    searchQuery: text('search_query'),
    description: text('description'),
    score: integer('score'),
    scoreReason: text('score_reason'),
    tailoredCv: text('tailored_cv'),
    cvPdfPath: text('cv_pdf_path'),
    coverPdfPath: text('cover_pdf_path'),
    status: text('status').notNull().default('discovered'),
    failReason: text('fail_reason'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_jobs_status').on(table.status),
    index('idx_jobs_score').on(table.score),
    index('idx_jobs_url').on(table.url),
  ]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const cvs = sqliteTable(
  'cvs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    variant: text('variant').notNull().default('A'),
    htmlContent: text('html_content').notNull(),
    promptUsed: text('prompt_used'),
    jobId: integer('job_id').references(() => jobs.id),
    jobTitle: text('job_title'),
    jobCompany: text('job_company'),
    score: integer('score').notNull().default(0),
    templateId: text('template_id'),
    paletteId: text('palette_id'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_cvs_job').on(table.jobId),
    index('idx_cvs_variant').on(table.variant),
  ]
)

export const logs = sqliteTable(
  'logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id').references(() => jobs.id),
    stage: text('stage').notNull(),
    level: text('level').notNull().default('info'),
    message: text('message'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_logs_job').on(table.jobId)]
)
