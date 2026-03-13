import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { resolve, dirname } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import * as schema from './schema.js'

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..')
const DEFAULT_DB_PATH = resolve(REPO_ROOT, 'data', 'jobs.db')

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database | null = null

export function getDb(dbPath?: string) {
  if (!db) {
    const path = dbPath || process.env.DB_PATH || DEFAULT_DB_PATH
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    sqlite = new Database(path)
    sqlite.exec('PRAGMA journal_mode = WAL')
    sqlite.exec('PRAGMA foreign_keys = ON')
    db = drizzle({ client: sqlite, schema })
  }
  return db
}

export function closeDb(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
  }
}
