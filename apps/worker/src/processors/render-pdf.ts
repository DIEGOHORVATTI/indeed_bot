import type { Job } from 'bullmq'
import { getDb, getJobById, updateJob, logEvent } from '@jobpilot/db'
import { fillCvTemplate, fillCoverTemplate, htmlToPdf } from '@jobpilot/pdf'
import { PDF_DIR, TEMPLATES_DIR, ensureDirs } from '@jobpilot/config'
import { join } from 'node:path'
import type { TailoredContent } from '@jobpilot/types'

export async function processRenderPdf(job: Job<{ jobId: number }>): Promise<{ jobIds: number[] }> {
  const db = getDb()
  const dbJob = getJobById(db, job.data.jobId)
  if (!dbJob) return { jobIds: [] }

  ensureDirs()

  let data: TailoredContent
  try {
    data = JSON.parse(dbJob.tailoredCv || '{}') as TailoredContent
  } catch (err) {
    logEvent(db, dbJob.id, 'render-pdf', 'error', `JSON inválido: ${err}`)
    updateJob(db, dbJob.id, { status: 'failed', failReason: `Erro no JSON do PDF: ${err}` })
    return { jobIds: [] }
  }

  console.log(`[render-pdf] Gerando PDFs para: ${dbJob.title} em ${dbJob.company}`)

  try {
    const cvTemplatePath = join(TEMPLATES_DIR, 'cv_template.html')
    const coverTemplatePath = join(TEMPLATES_DIR, 'cover_template.html')

    // Generate CV PDF — contact info now comes from TailoredContent
    const cvHtml = fillCvTemplate(data, cvTemplatePath)
    const cvPath = join(PDF_DIR, `${dbJob.id}_cv.pdf`)
    await htmlToPdf(cvHtml, cvPath)

    // Generate cover letter PDF
    const coverHtml = fillCoverTemplate(data, coverTemplatePath)
    const coverPath = join(PDF_DIR, `${dbJob.id}_cover.pdf`)
    await htmlToPdf(coverHtml, coverPath)

    updateJob(db, dbJob.id, { cvPdfPath: cvPath, coverPdfPath: coverPath, status: 'ready' })
    logEvent(db, dbJob.id, 'render-pdf', 'info', 'PDFs gerados')
    return { jobIds: [dbJob.id] }
  } catch (err) {
    logEvent(db, dbJob.id, 'render-pdf', 'error', `Erro no PDF: ${err}`)
    updateJob(db, dbJob.id, { status: 'failed', failReason: `Erro no PDF: ${err}` })
    return { jobIds: [] }
  }
}
