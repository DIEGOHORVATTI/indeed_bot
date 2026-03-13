import { Elysia } from 'elysia'
import { Redis as IORedis } from 'ioredis'
import { REDIS_URL } from '@jobpilot/config'
import { getDb, insertJob, updateJob, getJobByUrl } from '@jobpilot/db'

type ExtensionMessage =
  | {
      type: 'ext:status'
      payload: {
        state: string
        appliedCount: number
        skippedCount: number
        failedCount: number
        pendingJobs: number
        totalJobs: number
        currentJob?: string
      }
    }
  | {
      type: 'ext:screenshot'
      payload: {
        screenshot: string
        url: string
        pageContext: string
        timestamp: number
      }
    }
  | {
      type: 'ext:job:discovered'
      payload: {
        jobs: Array<{
          url: string
          jobKey: string
          title?: string
          company?: string
          location?: string
          salary?: string
          source: string
        }>
      }
    }
  | {
      type: 'ext:job:applied'
      payload: {
        jobKey: string
        title: string
        company: string
      }
    }
  | {
      type: 'ext:job:failed'
      payload: {
        jobKey: string
        reason: string
      }
    }
  | {
      type: 'ext:log'
      payload: {
        level: string
        message: string
        timestamp: number
      }
    }

type BackendMessage =
  | {
      type: 'cmd:start'
      payload: {
        searchUrls: string[]
        maxApplies: number
      }
    }
  | { type: 'cmd:stop' }
  | { type: 'cmd:pause' }
  | { type: 'cmd:resume' }
  | {
      type: 'cmd:apply'
      payload: {
        jobId: number
        url: string
        title: string
        company: string
        cvPdfUrl?: string
        coverPdfUrl?: string
      }
    }

type SandboxControl = { action?: string }

const db = getDb()
const redisPub = new IORedis(REDIS_URL)
const redisSub = new IORedis(REDIS_URL)
const jobKeyToUrl = new Map<string, string>()

let extensionSocket: { send(data: string): void; close(code?: number, reason?: string): void } | null =
  null
let subReadyPromise: Promise<void> | null = null

function tryParseJSON<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function normalizeIncoming(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (data instanceof Uint8Array) return Buffer.from(data).toString('utf-8')
  if (data && typeof data === 'object') {
    try {
      return JSON.stringify(data)
    } catch {
      return null
    }
  }
  return null
}

function mapSandboxActionToCommand(action?: string): BackendMessage | null {
  if (action === 'pause') return { type: 'cmd:pause' }
  if (action === 'resume') return { type: 'cmd:resume' }
  if (action === 'skip') return { type: 'cmd:stop' }
  return null
}

function forwardToExtension(message: BackendMessage): void {
  if (!extensionSocket) return
  try {
    extensionSocket.send(JSON.stringify(message))
  } catch {}
}

async function ensureRedisSubscriptions(): Promise<void> {
  if (subReadyPromise) return subReadyPromise

  subReadyPromise = (async () => {
    redisSub.on('message', (channel: string, message: string) => {
      if (channel === 'sandbox:control') {
        const control = tryParseJSON<SandboxControl>(message)
        const mapped = mapSandboxActionToCommand(control?.action)
        if (mapped) forwardToExtension(mapped)
        return
      }

      if (channel === 'extension:command') {
        const parsed = tryParseJSON<BackendMessage>(message)
        if (parsed) forwardToExtension(parsed)
      }
    })

    await redisSub.subscribe('sandbox:control', 'extension:command')
  })()

  return subReadyPromise
}

async function handleExtensionMessage(message: ExtensionMessage): Promise<void> {
  switch (message.type) {
    case 'ext:screenshot': {
      await redisPub.publish('sandbox:state', JSON.stringify(message.payload))
      return
    }

    case 'ext:job:discovered': {
      for (const job of message.payload.jobs) {
        jobKeyToUrl.set(job.jobKey, job.url)

        const existing = getJobByUrl(db, job.url)
        if (!existing) {
          insertJob(db, {
            url: job.url,
            source: job.source,
            title: job.title ?? '',
            company: job.company ?? '',
            location: job.location || null,
            salary: job.salary || null,
          })
        }
      }
      return
    }

    case 'ext:job:applied': {
      const url = jobKeyToUrl.get(message.payload.jobKey)
      if (!url) return

      const job = getJobByUrl(db, url)
      if (!job) return

      updateJob(db, job.id, {
        status: 'applied',
        failReason: null,
        title: message.payload.title,
        company: message.payload.company
      })
      return
    }

    case 'ext:job:failed': {
      const url = jobKeyToUrl.get(message.payload.jobKey)
      if (!url) return

      const job = getJobByUrl(db, url)
      if (!job) return

      updateJob(db, job.id, {
        status: 'failed',
        failReason: message.payload.reason
      })
      return
    }

    case 'ext:status':
    case 'ext:log': {
      return
    }
  }
}

export async function sendToExtension(message: BackendMessage): Promise<void> {
  await redisPub.publish('extension:command', JSON.stringify(message))
}

export const wsRoute = new Elysia().ws('/ws/extension', {
  async open(ws) {
    await ensureRedisSubscriptions()

    if (extensionSocket && extensionSocket !== ws) {
      try {
        extensionSocket.close(1000, 'Replaced by newer extension connection')
      } catch {}
    }

    extensionSocket = ws
    await redisPub.set('extension:connected', 'true')
  },

  async message(_ws, data) {
    const raw = normalizeIncoming(data)
    if (!raw) return

    const parsed = tryParseJSON<ExtensionMessage>(raw)
    if (!parsed) return

    await handleExtensionMessage(parsed)
  },

  async close(ws) {
    if (extensionSocket === ws) {
      extensionSocket = null
      await redisPub.set('extension:connected', 'false')
    }
  }
})
