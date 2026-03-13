import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function htmlToPdf(html: string, outputPath?: string): Promise<Buffer> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()

    // Write HTML to temp file for file:// protocol (handles relative paths in HTML)
    const tmpPath = join(tmpdir(), `jobpilot-${randomUUID()}.html`)
    writeFileSync(tmpPath, html, 'utf-8')

    await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle' })
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    })

    // Clean up temp file
    try {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(tmpPath)
    } catch {
      // ignore cleanup errors
    }

    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, pdfBuffer)
    }

    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}
