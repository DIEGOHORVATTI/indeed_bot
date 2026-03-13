import { Worker, Queue } from 'bullmq'
import { REDIS_URL } from '@jobpilot/config'
import { processDiscover } from './processors/discover.js'
import { processEnrich } from './processors/enrich.js'
import { processScore } from './processors/score.js'
import { processTailor } from './processors/tailor.js'
import { processRenderPdf } from './processors/render-pdf.js'
import { processApply } from './processors/apply.js'

function getConnection() {
  const url = new URL(REDIS_URL)
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  }
}

export function getQueue(name: string): Queue {
  return new Queue(name, { connection: getConnection() })
}

export function setupWorkers(): Worker[] {
  const connection = getConnection()

  return [
    new Worker('discover', processDiscover, {
      connection,
      concurrency: 1,
    }),
    new Worker('enrich', processEnrich, {
      connection,
      concurrency: 5,
      limiter: { max: 10, duration: 60_000 },
    }),
    new Worker('score', processScore, {
      connection,
      concurrency: 3,
    }),
    new Worker('tailor', processTailor, {
      connection,
      concurrency: 1,
    }),
    new Worker('render-pdf', processRenderPdf, {
      connection,
      concurrency: 2,
    }),
    new Worker('apply', processApply, {
      connection,
      concurrency: 1,
      limiter: { max: 8, duration: 3_600_000 },
    }),
  ]
}
