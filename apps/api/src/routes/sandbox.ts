import { Elysia, sse } from 'elysia'
import { Redis as IORedis } from 'ioredis'
import { REDIS_URL } from '@jobpilot/config'
import type { SandboxControlAction } from '@jobpilot/types'

export const sandboxRoute = new Elysia()
  .get('/api/sandbox/stream', async function* ({ request }) {
    const sub = new IORedis(REDIS_URL)
    await sub.subscribe('sandbox:state')

    const messages: string[] = []
    let notifyReady: (() => void) | null = null

    sub.on('message', (_channel: string, message: string) => {
      messages.push(message)
      if (notifyReady) {
        notifyReady()
        notifyReady = null
      }
    })

    try {
      while (!request.signal.aborted) {
        if (messages.length === 0) {
          await Promise.race([
            new Promise<void>((r) => { notifyReady = r }),
            new Promise<void>((r) => setTimeout(r, 15_000)),
          ])
        }

        if (messages.length > 0) {
          while (messages.length > 0) {
            yield sse({ event: 'state', data: messages.shift()! })
          }
        } else {
          yield sse({ event: 'ping', data: '' })
        }
      }
    } finally {
      sub.unsubscribe()
      sub.quit()
    }
  })

  .post('/api/sandbox/control', async ({ body }) => {
    const { action } = body as { action: SandboxControlAction }
    const pub = new IORedis(REDIS_URL)
    await pub.publish('sandbox:control', JSON.stringify({ action }))
    pub.quit()
    return { status: 'ok', action }
  })
