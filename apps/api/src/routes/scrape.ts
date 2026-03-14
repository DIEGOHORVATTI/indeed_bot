import { Elysia, t } from 'elysia'
import { getDb, insertJob, getJobByUrl } from '@jobpilot/db'
import { scrapeIndeed, formatSalary } from '../services/indeed-scraper.js'

export const scrapeRoute = new Elysia()
  .post('/api/scrape', async ({ body }) => {
    const db = getDb()
    const { searches } = body

    let totalNew = 0
    let totalSkipped = 0

    for (const search of searches) {
      const jobs = await scrapeIndeed({
        searchTerm: search.query,
        location: search.location || 'Brasil',
        country: search.country || 'BR',
        radius: search.radius ?? 100,
        maxResults: search.maxResults ?? 50,
        hoursOld: search.hoursOld,
        easyApplyOnly: search.easyApplyOnly,
      })

      for (const job of jobs) {
        const existing = getJobByUrl(db, job.url)
        if (existing) {
          totalSkipped++
          continue
        }

        const salary = formatSalary(job)
        const locationParts = [job.city, job.state].filter(Boolean)

        insertJob(db, {
          url: job.url,
          source: 'indeed',
          title: job.title,
          company: job.company || '',
          location: locationParts.join(', ') || null,
          salary,
          jobKey: job.jobKey,
          applyType: job.applyUrl && !job.applyUrl.includes('indeed.com')
            ? 'external'
            : 'easy_apply',
          searchQuery: search.query,
          description: job.description,
        })
        totalNew++
      }
    }

    return {
      ok: true,
      newJobs: totalNew,
      skipped: totalSkipped,
      message: `${totalNew} novas vagas coletadas, ${totalSkipped} duplicadas ignoradas`,
    }
  }, {
    body: t.Object({
      searches: t.Array(t.Object({
        query: t.String(),
        location: t.Optional(t.String()),
        country: t.Optional(t.String()),
        radius: t.Optional(t.Number()),
        maxResults: t.Optional(t.Number()),
        hoursOld: t.Optional(t.Number()),
        easyApplyOnly: t.Optional(t.Boolean()),
      })),
    }),
  })
