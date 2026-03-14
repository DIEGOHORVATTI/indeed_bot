import { Elysia } from 'elysia'
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
          applyType?: string
          searchQuery?: string
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
  | {
      type: 'cmd:scrape'
      payload: {
        searchUrls: string[]
        maxJobs: number
      }
    }
  | {
      type: 'cmd:apply-jobs'
      payload: {
        jobs: Array<{
          id: number
          url: string
          title: string
          company: string
        }>
        mode: 'semi-auto' | 'full-auto'
        generateCv: boolean
      }
    }

const db = getDb()
const jobKeyToUrl = new Map<string, string>()

let extensionSocket: { send(data: string): void; close(code?: number, reason?: string): void } | null =
  null
let extensionConnected = false

type ScreenshotListener = (data: string) => void
const screenshotListeners = new Set<ScreenshotListener>()

export function onScreenshot(listener: ScreenshotListener): () => void {
  screenshotListeners.add(listener)
  return () => screenshotListeners.delete(listener)
}

export function isExtensionConnected(): boolean {
  return extensionConnected
}

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

function forwardToExtension(message: BackendMessage): void {
  if (!extensionSocket) return
  try {
    extensionSocket.send(JSON.stringify(message))
  } catch {}
}

async function handleExtensionMessage(message: ExtensionMessage): Promise<void> {
  switch (message.type) {
    case 'ext:screenshot': {
      const payload = JSON.stringify(message.payload)
      for (const listener of screenshotListeners) {
        listener(payload)
      }
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
            jobKey: job.jobKey || null,
            applyType: job.applyType || null,
            searchQuery: job.searchQuery || null,
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

export function sendToExtension(message: BackendMessage): void {
  forwardToExtension(message)
}

export function handleSandboxControl(action: string): void {
  if (action === 'pause') forwardToExtension({ type: 'cmd:pause' })
  else if (action === 'resume') forwardToExtension({ type: 'cmd:resume' })
  else if (action === 'skip') forwardToExtension({ type: 'cmd:stop' })
}

export const wsRoute = new Elysia().ws('/ws/extension', {
  open(ws) {
    if (extensionSocket && extensionSocket !== ws) {
      try {
        extensionSocket.close(1000, 'Replaced by newer extension connection')
      } catch {}
    }

    extensionSocket = ws
    extensionConnected = true
  },

  message(_ws, data) {
    const raw = normalizeIncoming(data)
    if (!raw) return

    const parsed = tryParseJSON<ExtensionMessage>(raw)
    if (!parsed) return

    handleExtensionMessage(parsed)
  },

  close(ws) {
    if (extensionSocket === ws) {
      extensionSocket = null
      extensionConnected = false
    }
  }
})
