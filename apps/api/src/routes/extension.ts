import { Elysia, t } from 'elysia'
import { getDb, getJobById, updateJob } from '@jobpilot/db'
import { sendToExtension } from './ws.js'

export const extensionRoute = new Elysia()
  .post('/api/extension/scrape', async ({ body }) => {
    const { searchUrls, maxJobs = 50 } = body
    await sendToExtension({
      type: 'cmd:scrape',
      payload: { searchUrls, maxJobs },
    })
    return { ok: true, message: 'Comando de coleta enviado para a extensao' }
  }, {
    body: t.Object({
      searchUrls: t.Array(t.String()),
      maxJobs: t.Optional(t.Number()),
    }),
  })

  .post('/api/extension/apply', async ({ body }) => {
    const { jobIds, mode, generateCv = true } = body
    const db = getDb()

    const jobs = jobIds
      .map((id) => getJobById(db, id))
      .filter((j): j is NonNullable<typeof j> => j != null)

    if (jobs.length === 0) {
      return { ok: false, error: 'Nenhuma vaga encontrada com os IDs informados' }
    }

    for (const job of jobs) {
      updateJob(db, job.id, { status: 'applying' })
    }

    sendToExtension({
      type: 'cmd:apply-jobs',
      payload: {
        jobs: jobs.map((j) => ({
          id: j.id,
          url: j.url,
          title: j.title || '',
          company: j.company || '',
        })),
        mode,
        generateCv,
      },
    })

    return { ok: true, count: jobs.length, message: `Aplicando em ${jobs.length} vaga(s)` }
  }, {
    body: t.Object({
      jobIds: t.Array(t.Number()),
      mode: t.Union([t.Literal('semi-auto'), t.Literal('full-auto')]),
      generateCv: t.Optional(t.Boolean()),
    }),
  })
