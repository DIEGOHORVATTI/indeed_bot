import { Elysia } from 'elysia'
import { Queue } from 'bullmq'
import { REDIS_URL } from '@jobpilot/config'
import type { PipelineStage } from '@jobpilot/types'

const STAGES: PipelineStage[] = ['discover', 'enrich', 'score', 'tailor', 'render-pdf', 'apply']

function getConnection() {
  const url = new URL(REDIS_URL)
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  }
}

const queues = new Map<PipelineStage, Queue>()

function getQueue(stage: PipelineStage): Queue {
  if (!queues.has(stage)) {
    queues.set(stage, new Queue(stage, { connection: getConnection() }))
  }
  return queues.get(stage)!
}

export const pipelineRoute = new Elysia()
  .post('/api/pipeline/start', async () => {
    const queue = getQueue('discover')
    await queue.add('discover-run', {})
    return { status: 'started' }
  })

  .post('/api/pipeline/stop', async () => {
    for (const stage of STAGES) {
      const queue = getQueue(stage)
      await queue.drain()
    }
    return { status: 'stopped' }
  })

  .get('/api/pipeline/status', async () => {
    const status: Record<string, { waiting: number; active: number; completed: number; failed: number }> = {}

    for (const stage of STAGES) {
      const queue = getQueue(stage)
      const counts = await queue.getJobCounts()
      status[stage] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      }
    }

    return {
      stages: status,
      isRunning: Object.values(status).some((s) => s.active > 0 || s.waiting > 0),
    }
  })
