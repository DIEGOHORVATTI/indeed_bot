import { Elysia } from 'elysia'
import { sendToExtension } from './ws.js'

export const pipelineRoute = new Elysia()
  .post('/api/pipeline/start', () => {
    sendToExtension({ type: 'cmd:start', payload: { searchUrls: [], maxApplies: 0 } })
    return { status: 'started' }
  })

  .post('/api/pipeline/stop', () => {
    sendToExtension({ type: 'cmd:stop' })
    return { status: 'stopped' }
  })

  .get('/api/pipeline/status', () => {
    return {
      stages: {},
      isRunning: false,
    }
  })
