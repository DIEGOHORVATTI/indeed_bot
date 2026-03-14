import { Elysia, sse } from 'elysia'
import type { SandboxControlAction } from '@jobpilot/types'
import { onScreenshot, handleSandboxControl } from './ws.js'

export const sandboxRoute = new Elysia()
  .get('/api/sandbox/stream', async function* ({ request }) {
    const messages: string[] = []
    let notifyReady: (() => void) | null = null

    const unsubscribe = onScreenshot((data) => {
      messages.push(data)
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
      unsubscribe()
    }
  })

  .post('/api/sandbox/control', ({ body }) => {
    const { action } = body as { action: SandboxControlAction }
    handleSandboxControl(action)
    return { status: 'ok', action }
  })
