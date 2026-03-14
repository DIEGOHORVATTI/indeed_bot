import { Elysia, t } from 'elysia'
import { getDb, getJobs, getJobById, updateJob, deleteJobs, getStats } from '@jobpilot/db'
import { getMissingFieldsAlerts, clearMissingFieldsAlerts } from './ws.js'

export const jobsRoute = new Elysia()
  .get('/api/jobs', ({ query }) => {
    const db = getDb()
    return getJobs(db, {
      status: query.status || undefined,
      source: query.source || undefined,
      applyType: query.applyType || undefined,
      scoreMin: query.scoreMin ? parseInt(query.scoreMin, 10) : undefined,
      scoreMax: query.scoreMax ? parseInt(query.scoreMax, 10) : undefined,
      dateFrom: query.dateFrom || undefined,
      dateTo: query.dateTo || undefined,
      search: query.search || undefined,
      limit: parseInt(query.limit || '200', 10),
    })
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
      source: t.Optional(t.String()),
      applyType: t.Optional(t.String()),
      scoreMin: t.Optional(t.String()),
      scoreMax: t.Optional(t.String()),
      dateFrom: t.Optional(t.String()),
      dateTo: t.Optional(t.String()),
      search: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  .get('/api/jobs/stats', () => {
    const db = getDb()
    return getStats(db)
  })

  .get('/api/jobs/:id', ({ params, set }) => {
    const db = getDb()
    const id = parseInt(params.id, 10)
    const job = getJobById(db, id)
    if (!job) {
      set.status = 404
      return { error: 'Vaga não encontrada' }
    }
    return job
  })

  .patch('/api/jobs/:id', ({ params, body }) => {
    const db = getDb()
    const id = parseInt(params.id, 10)
    updateJob(db, id, body as Record<string, unknown>)
    return getJobById(db, id)
  })

  .delete('/api/jobs', ({ body }) => {
    const db = getDb()
    const ids = (body as { ids: number[] }).ids
    const deleted = deleteJobs(db, ids)
    return { deleted }
  }, {
    body: t.Object({
      ids: t.Array(t.Number()),
    }),
  })

  .get('/api/jobs/missing-fields', () => {
    return getMissingFieldsAlerts()
  })

  .delete('/api/jobs/missing-fields', () => {
    clearMissingFieldsAlerts()
    return { ok: true }
  })
