import type { Job } from 'bullmq'
import { getDb, getJobById, updateJob, logEvent } from '@jobpilot/db'
import { getProvider, extractJson } from '@jobpilot/ai'
import { MODEL_FAST } from '@jobpilot/config'
import { loadProfile } from '@jobpilot/db'

export async function processScore(job: Job<{ jobId: number }>): Promise<{ jobIds: number[] }> {
  const db = getDb()
  const dbJob = getJobById(db, job.data.jobId)
  if (!dbJob) return { jobIds: [] }

  const desc = (dbJob.description || '').slice(0, 1500)
  if (!desc) {
    updateJob(db, dbJob.id, { status: 'skipped', score: 0, scoreReason: 'Sem descrição' })
    return { jobIds: [] }
  }

  const ai = getProvider()
  const profileText = loadProfile()
  const candidateInfo = profileText.slice(0, 800) || 'Nenhum perfil configurado'
  const threshold = 40

  const prompt =
    `Score 0-100 job-candidate match. Reply ONLY with JSON.\n\n` +
    `Job: ${dbJob.title} at ${dbJob.company} (${dbJob.location || 'N/A'})\n` +
    `Description: ${desc}\n\n` +
    `Candidate:\n${candidateInfo}\n\n` +
    `Reply ONLY: {"score": N, "reason": "..."}`

  try {
    const raw = await ai.complete(prompt, { model: MODEL_FAST })
    const result = extractJson(raw)
    const score = Number(result.score)
    const reason = String(result.reason || '')

    if (score < threshold) {
      updateJob(db, dbJob.id, { score, scoreReason: reason, status: 'skipped' })
      logEvent(db, dbJob.id, 'score', 'info', `Pontuação ${score} < ${threshold}, ignorada`)
      return { jobIds: [] }
    }

    updateJob(db, dbJob.id, { score, scoreReason: reason, status: 'scored' })
    logEvent(db, dbJob.id, 'score', 'info', `Pontuação ${score}: ${reason}`)
    return { jobIds: [dbJob.id] }
  } catch (err) {
    logEvent(db, dbJob.id, 'score', 'error', `Erro na pontuação: ${err}`)
    updateJob(db, dbJob.id, { status: 'skipped', score: 0, scoreReason: `Erro: ${err}` })
    return { jobIds: [] }
  }
}
