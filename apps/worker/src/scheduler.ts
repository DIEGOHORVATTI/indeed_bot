import { Queue, QueueEvents } from 'bullmq'
import { REDIS_URL } from '@jobpilot/config'
import { getQueue } from './queues.js'

function getConnection() {
  const url = new URL(REDIS_URL)
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  }
}

export function setupScheduler(): void {
  const discoverQueue = getQueue('discover')

  // Add repeatable discover job (every 30 minutes)
  discoverQueue.add(
    'discover-cron',
    {},
    {
      repeat: { every: 30 * 60 * 1000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    }
  )

  // Pipeline chaining: when a stage completes, add jobs to the next stage
  const stages = ['discover', 'enrich', 'score', 'tailor', 'render-pdf'] as const
  const nextStage: Record<string, string> = {
    discover: 'enrich',
    enrich: 'score',
    score: 'tailor',
    tailor: 'render-pdf',
    'render-pdf': 'apply',
  }

  for (const stage of stages) {
    const events = new QueueEvents(stage, { connection: getConnection() })
    events.on('completed', async ({ returnvalue }) => {
      if (!returnvalue) return
      try {
        const result = JSON.parse(returnvalue)
        const next = nextStage[stage]
        if (next && result.jobIds?.length) {
          const nextQueue = getQueue(next)
          const jobs = result.jobIds.map((id: number) => ({
            name: `${next}-${id}`,
            data: { jobId: id },
          }))
          await nextQueue.addBulk(jobs)
        }
      } catch {
        // ignore parse errors
      }
    })
  }

  console.log('Scheduler configured: discover every 30min, pipeline chaining active')
}
