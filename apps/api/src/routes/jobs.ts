import { Elysia, t } from 'elysia'
import { getDb, getJobs, getJobById, updateJob, deleteJobs, getStats } from '@jobpilot/db'

export const jobsRoute = new Elysia()
  .get('/api/jobs', ({ query }) => {
    const db = getDb()
    const status = query.status || undefined
    const limit = parseInt(query.limit || '100', 10)
    return getJobs(db, { status, limit })
  }, {
    query: t.Object({
      status: t.Optional(t.String()),
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
