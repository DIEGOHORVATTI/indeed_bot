import { Elysia, t } from 'elysia'
import { getDb, getSetting, setSetting, getAllSettings } from '@jobpilot/db'

export const settingsRoute = new Elysia()
  .get('/api/settings', () => {
    const db = getDb()
    return getAllSettings(db)
  })

  .get('/api/settings/:key', ({ params }) => {
    const db = getDb()
    const value = getSetting(db, params.key)
    if (value === null) return { key: params.key, value: '' }
    return { key: params.key, value }
  })

  .put('/api/settings/:key', ({ params, body }) => {
    const db = getDb()
    const { value } = body as { value: string }
    setSetting(db, params.key, value)
    return { key: params.key, value, status: 'saved' }
  })
