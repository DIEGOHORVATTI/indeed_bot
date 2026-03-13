import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { healthRoute } from './routes/health.js'
import { answerRoute } from './routes/answer.js'
import { tailorRoute } from './routes/tailor.js'
import { pdfRoute } from './routes/pdf.js'
import { jobsRoute } from './routes/jobs.js'
import { pipelineRoute } from './routes/pipeline.js'
import { sandboxRoute } from './routes/sandbox.js'
import { settingsRoute } from './routes/settings.js'
import { wsRoute } from './routes/ws.js'
import { cvsRoute } from './routes/cvs.js'

export const app = new Elysia()
  .use(cors())
  .use(openapi({
    documentation: {
      info: {
        title: 'JobPilot API',
        version: '0.1.0',
        description: 'API do JobPilot — pipeline automatizado de candidaturas',
      },
    },
  }))
  .use(healthRoute)
  .use(answerRoute)
  .use(tailorRoute)
  .use(pdfRoute)
  .use(jobsRoute)
  .use(pipelineRoute)
  .use(sandboxRoute)
  .use(wsRoute)
  .use(settingsRoute)
  .use(cvsRoute)
