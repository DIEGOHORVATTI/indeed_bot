import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TailoredContent } from '@jobpilot/types'

export function buildContactHtml(data: TailoredContent): string {
  const parts: string[] = []
  if (data.profile_email) parts.push(data.profile_email)
  if (data.profile_phone) parts.push(data.profile_phone)
  if (data.profile_location) parts.push(data.profile_location)
  if (data.profile_linkedin) parts.push(`<a href="${data.profile_linkedin}">LinkedIn</a>`)
  if (data.profile_github) parts.push(`<a href="${data.profile_github}">GitHub</a>`)
  if (data.profile_portfolio) parts.push(`<a href="${data.profile_portfolio}">Portfolio</a>`)
  return parts.join('<span class="sep">|</span>')
}

export function fillCvTemplate(
  data: TailoredContent,
  templatePath?: string
): string {
  const tplPath = templatePath || resolve(process.cwd(), 'templates', 'cv-classic.html')
  let html = readFileSync(tplPath, 'utf-8')

  html = html.replace(/\{\{profile_name\}\}/g, data.profile_name || '')
  html = html.replace(/\{\{objective\}\}/g, data.objective || '')
  html = html.replace(/\{\{profile_contact\}\}/g, buildContactHtml(data))
  html = html.replace(/\{\{section_summary\}\}/g, data.section_summary || 'Summary')
  html = html.replace(/\{\{summary\}\}/g, data.summary || '')

  // Keywords badges
  const keywordsHtml = (data.keywords || [])
    .map((kw) => `<span class="badge">${kw}</span>`)
    .join('')
  html = html.replace(/\{\{keywords\}\}/g, keywordsHtml)

  // Section titles
  html = html.replace(/\{\{section_skills\}\}/g, data.section_skills || 'Skills')
  html = html.replace(/\{\{section_experience\}\}/g, data.section_experience || 'Experience')
  html = html.replace(/\{\{section_education\}\}/g, data.section_education || 'Education')
  html = html.replace(/\{\{section_certifications\}\}/g, data.section_certifications || 'Certifications')
  html = html.replace(/\{\{section_languages\}\}/g, data.section_languages || 'Languages')

  // Skills grid
  const skillsHtml = (data.skills || [])
    .map((s) => `<div class="row"><span class="label">${s.label}:</span> ${s.items}</div>`)
    .join('')
  html = html.replace(/\{\{skills\}\}/g, skillsHtml)

  // Experience
  const expHtml = (data.experience || [])
    .map((exp) => {
      const bullets = (exp.bullets || []).map((b) => `<li>${b}</li>`).join('')
      return `<div class="job">
  <div class="job-header">
    <span class="job-title">${exp.title || ''}</span>
    <span class="job-date">${exp.date || ''}</span>
  </div>
  <div class="job-company">${exp.company || ''}</div>
  <ul>${bullets}</ul>
</div>`
    })
    .join('')
  html = html.replace(/\{\{experience\}\}/g, expHtml)

  // Education
  const eduHtml = (data.education || [])
    .map(
      (edu) =>
        `<strong>${edu.degree || ''}</strong> — ${edu.institution || ''} (${edu.period || ''})<br>`
    )
    .join('')
  html = html.replace(/\{\{education\}\}/g, eduHtml)

  // Certifications
  const certs = data.certifications || []
  const certsHtml = certs.length
    ? '<ul>' + certs.map((c) => `<li>${c}</li>`).join('') + '</ul>'
    : ''
  html = html.replace(/\{\{certifications\}\}/g, certsHtml)

  // Languages
  const langHtml = (data.languages || [])
    .map((l) => `${l.name} — ${l.level}`)
    .join('<br>')
  html = html.replace(/\{\{languages\}\}/g, langHtml)

  // Additional info
  const additional = data.additional_info || ''
  const additionalHtml = additional
    ? `<h2>${data.section_additional || 'Additional'}</h2><div class="additional">${additional}</div>`
    : ''
  html = html.replace(/\{\{additional_info\}\}/g, additionalHtml)

  return html
}

export function fillCoverTemplate(
  data: TailoredContent,
  templatePath?: string
): string {
  const tplPath = templatePath || resolve(process.cwd(), 'templates', 'cover-classic.html')
  let html = readFileSync(tplPath, 'utf-8')

  html = html.replace(/\{\{profile_name\}\}/g, data.profile_name || '')
  html = html.replace(/\{\{subtitle\}\}/g, data.cover_subtitle || '')
  html = html.replace(/\{\{profile_contact\}\}/g, buildContactHtml(data))
  html = html.replace(
    /\{\{date\}\}/g,
    new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  )
  html = html.replace(/\{\{greeting\}\}/g, data.cover_greeting || 'Dear Hiring Manager,')

  const paragraphsHtml = (data.cover_paragraphs || [])
    .map((p) => `<p>${p}</p>`)
    .join('')
  html = html.replace(/\{\{paragraphs\}\}/g, paragraphsHtml)

  html = html.replace(/\{\{closing\}\}/g, data.cover_closing || 'Sincerely')

  return html
}
