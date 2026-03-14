import type { Job } from 'bullmq'
import { getDb, getJobById, updateJob, logEvent } from '@jobpilot/db'
import { checkRateLimit, randomDelay, DELAY_APPLY } from '@jobpilot/anti-detection'
import { loadProfile } from '@jobpilot/db'
import { runAgent } from '../browser/agent.js'
import { createSandbox } from '../browser/sandbox.js'
import { isExtensionConnected, requestApply } from '../bridge/extension-client.js'

export async function processApply(job: Job<{ jobId: number }>): Promise<{ jobIds: number[] }> {
  const db = getDb()
  const dbJob = getJobById(db, job.data.jobId)
  if (!dbJob) return { jobIds: [] }

  const extConnected = await isExtensionConnected()
  if (extConnected) {
    console.log(`[apply] Extensão conectada — delegando aplicação para o navegador real: ${dbJob.title}`)
    const apiUrl = process.env.API_URL || 'http://localhost:8004'
    const cvPdfUrl = dbJob.cvPdfPath ? `${apiUrl}/api/pdf/${dbJob.cvPdfPath}` : undefined
    const coverPdfUrl = dbJob.coverPdfPath ? `${apiUrl}/api/pdf/${dbJob.coverPdfPath}` : undefined
    await requestApply(dbJob.id, dbJob.url, dbJob.title || '', dbJob.company || '', cvPdfUrl, coverPdfUrl)
    logEvent(db, dbJob.id, 'apply', 'info', 'Delegado para extensão do navegador')
    return { jobIds: [dbJob.id] }
  }

  console.log(`[apply] Extensão não conectada — usando agente Playwright: ${dbJob.title}`)

  if (!checkRateLimit(db)) {
    console.warn('[apply] Limite de requisições atingido, pulando')
    return { jobIds: [] }
  }

  const profileText = loadProfile()
  const dryRun = process.env.DRY_RUN === 'true'

  console.log(`[apply] Candidatando-se a: ${dbJob.title} em ${dbJob.company}`)
  logEvent(db, dbJob.id, 'apply', 'info', `Iniciando (dryRun=${dryRun})`)

  const sandbox = await createSandbox()

  try {
    const result = await runAgent({
      job: dbJob,
      profileText,
      cvPdfPath: dbJob.cvPdfPath || '',
      coverPdfPath: dbJob.coverPdfPath || '',
      sandbox,
      dryRun,
    })

    const status = result.status
    const reason = result.reason || ''

    if (status === 'applied') {
      updateJob(db, dbJob.id, { status: 'applied' })
      logEvent(db, dbJob.id, 'apply', 'info', `Candidatado: ${reason}`)
      return { jobIds: [dbJob.id] }
    } else if (status === 'skipped') {
      logEvent(db, dbJob.id, 'apply', 'info', `Ignorada: ${reason}`)
    } else {
      updateJob(db, dbJob.id, { status: 'failed', failReason: `${status}: ${reason}` })
      logEvent(db, dbJob.id, 'apply', status === 'failed' ? 'error' : 'warning', `${status}: ${reason}`)
    }
  } catch (err) {
    logEvent(db, dbJob.id, 'apply', 'error', `Exceção: ${err}`)
    updateJob(db, dbJob.id, { status: 'failed', failReason: String(err) })
  } finally {
    await sandbox.close()
  }

  await randomDelay(...DELAY_APPLY)
  return { jobIds: [] }
}
