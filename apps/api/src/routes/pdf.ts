import { Elysia } from 'elysia'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { htmlToPdf } from '@jobpilot/pdf'
import { PDF_DIR } from '@jobpilot/config'

function sanitizeFilename(name: string): string {
  return basename(name).replace(/[^\w\s\-.]/g, '') || 'document.pdf'
}

export const pdfRoute = new Elysia()
  .post('/api/generate-pdf', async ({ body, set }) => {
    const { html, filename } = body as { html: string; filename?: string }

    try {
      const pdfBuffer = await htmlToPdf(html)
      const safeName = sanitizeFilename(filename || 'document.pdf')

      if (filename) {
        mkdirSync(PDF_DIR, { recursive: true })
        writeFileSync(join(PDF_DIR, safeName), pdfBuffer)
      }

      return new Response(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeName}"`,
        },
      })
    } catch (err) {
      set.status = 500
      return { error: `Falha ao gerar PDF: ${err}` }
    }
  })

  .get('/api/pdf/:filename', ({ params, set }) => {
    const safeName = sanitizeFilename(params.filename)
    if (!safeName) {
      set.status = 400
      return { error: 'Nome de arquivo inválido' }
    }

    const filePath = join(PDF_DIR, safeName)
    if (!existsSync(filePath)) {
      set.status = 404
      return { error: 'PDF não encontrado' }
    }

    const pdfBytes = readFileSync(filePath)
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}"`,
      },
    })
  })
