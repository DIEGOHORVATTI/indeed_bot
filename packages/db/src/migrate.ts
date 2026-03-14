import { mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..')
const dbPath = process.env.DB_PATH || resolve(REPO_ROOT, 'data', 'jobs.db')
const dir = dirname(dbPath)
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

const sqlite = new Database(dbPath)
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA foreign_keys = ON')

const db = drizzle({ client: sqlite })
migrate(db, { migrationsFolder: './drizzle' })

console.log('Migrations applied successfully')
sqlite.close()
