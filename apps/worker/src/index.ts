import { Redis } from 'ioredis'
import { REDIS_URL } from '@jobpilot/config'

const MAX_RETRIES = 10
const RETRY_DELAY = 3000

async function waitForRedis(): Promise<void> {
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 2000 })
      await redis.connect()
      await redis.ping()
      await redis.quit()
      return
    } catch {
      console.log(`[worker] Redis não disponível (tentativa ${i}/${MAX_RETRIES}), tentando novamente em ${RETRY_DELAY / 1000}s...`)
      await new Promise((r) => setTimeout(r, RETRY_DELAY))
    }
  }
  console.error('[worker] Não foi possível conectar ao Redis. Está rodando? (docker compose up -d redis)')
  process.exit(1)
}

async function main() {
  console.log('JobPilot Worker iniciando...')

  await waitForRedis()

  const { setupWorkers } = await import('./queues.js')
  const { setupScheduler } = await import('./scheduler.js')

  const workers = setupWorkers()
  setupScheduler()

  console.log(`Workers iniciados: ${workers.map((w) => w.name).join(', ')}`)

  const shutdown = async () => {
    console.log('Encerrando workers...')
    await Promise.all(workers.map((w) => w.close()))
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
