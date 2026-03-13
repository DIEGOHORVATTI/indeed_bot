import { mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..')

export const DATA_DIR = process.env.DATA_DIR || resolve(REPO_ROOT, 'data')
export const DB_PATH = process.env.DB_PATH || resolve(DATA_DIR, 'jobs.db')
export const PDF_DIR = process.env.PDF_DIR || resolve(DATA_DIR, 'pdfs')
export const CHROME_PROFILE_DIR = resolve(DATA_DIR, 'chrome-profile')
export const TEMPLATES_DIR = resolve(REPO_ROOT, 'templates')

export const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5-20251001'
export const MODEL_SMART = process.env.ANTHROPIC_MODEL_SMART || 'claude-opus-4-20250514'

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

/** Proxy para o Playwright (ex: socks5://user:pass@host:port ou http://host:port) */
export const PROXY_URL = process.env.PROXY_URL || ''

export const PORT = parseInt(process.env.PORT || '8004', 10)
export const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '8005', 10)

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, PDF_DIR, CHROME_PROFILE_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}
