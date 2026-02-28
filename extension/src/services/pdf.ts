/**
 * PDF generation — ported from Python pdf.py.
 * Uses html2pdf.js for client-side PDF conversion.
 * Template filling is pure string manipulation.
 */

import { TailoredContent, ProfileSettings } from '../types';

// Templates are loaded from extension assets
let cvTemplate = '';
let coverTemplate = '';

export async function loadTemplates(): Promise<void> {
  try {
    const cvUrl = chrome.runtime.getURL('assets/cv_template.html');
    const coverUrl = chrome.runtime.getURL('assets/cover_template.html');

    const [cvResp, coverResp] = await Promise.all([fetch(cvUrl), fetch(coverUrl)]);

    if (cvResp.ok) cvTemplate = await cvResp.text();
    else console.warn(`Failed to load CV template: ${cvResp.status}`);

    if (coverResp.ok) coverTemplate = await coverResp.text();
    else console.warn(`Failed to load cover template: ${coverResp.status}`);
  } catch (err) {
    console.warn('Failed to load templates:', err);
  }
}

const SEP = '<span class="sep">|</span>';

function buildContactHtml(profile: ProfileSettings): string {
  const parts = [profile.email, profile.phone];
  if (profile.linkedin) parts.push(`<a href="${profile.linkedin}">LinkedIn</a>`);
  if (profile.github) parts.push(`<a href="${profile.github}">GitHub</a>`);
  if (profile.portfolio) parts.push(`<a href="${profile.portfolio}">Portfolio</a>`);
  parts.push(profile.location);
  return parts.filter(Boolean).join(SEP);
}

function fillProfile(html: string, profile: ProfileSettings): string {
  html = html.replace(/\{\{profile_name\}\}/g, profile.name.toUpperCase());
  html = html.replace(/\{\{profile_contact\}\}/g, buildContactHtml(profile));
  return html;
}

export function fillCvTemplate(data: TailoredContent, profile?: ProfileSettings): string {
  let html = cvTemplate;

  if (profile) html = fillProfile(html, profile);

  html = html.replace('{{objective}}', data.objective || 'Full Stack Developer');
  html = html.replace('{{section_summary}}', data.section_summary || 'Resumo Profissional');
  html = html.replace('{{summary}}', data.summary || '');
  html = html.replace('{{section_skills}}', data.section_skills || 'Competências');
  html = html.replace('{{section_experience}}', data.section_experience || 'Experiência Profissional');
  html = html.replace('{{section_education}}', data.section_education || 'Formação');
  html = html.replace('{{section_certifications}}', data.section_certifications || 'Certificações');
  html = html.replace('{{section_languages}}', data.section_languages || 'Idiomas');

  // Keywords badges
  const keywordsHtml = (data.keywords || []).map(kw => `<span class="badge">${kw}</span>`).join('');
  html = html.replace('{{keywords}}', keywordsHtml);

  // Skills grid
  const skillsHtml = (data.skills || []).map(s =>
    `<div class="row"><span class="label">${s.label}:</span> ${s.items}</div>`
  ).join('\n');
  html = html.replace('{{skills}}', skillsHtml);

  // Experience
  const expHtml = (data.experience || []).map(job => {
    const bullets = (job.bullets || []).map(b => `<li>${b}</li>`).join('');
    return `<div class="job">
  <div class="job-header"><span class="job-title">${job.title}</span><span class="job-date">${job.date}</span></div>
  <div class="job-company">${job.company}</div>
  <ul>${bullets}</ul>
</div>`;
  }).join('\n');
  html = html.replace('{{experience}}', expHtml);

  // Education
  const eduHtml = (data.education || []).map(e =>
    `<strong>${e.degree}</strong> | ${e.institution} | ${e.period}<br>`
  ).join('\n');
  html = html.replace('{{education}}', eduHtml);

  // Certifications
  const certs = data.certifications || [];
  const certsHtml = certs.length > 0
    ? '<ul>' + certs.map(c => `<li>${c}</li>`).join('') + '</ul>'
    : '';
  html = html.replace('{{certifications}}', certsHtml);

  // Languages
  const langsHtml = (data.languages || []).map(l => `${l.name} – ${l.level}`).join(' &nbsp;|&nbsp; ');
  html = html.replace('{{languages}}', langsHtml);

  // Additional info
  const additional = data.additional_info || '';
  const additionalHtml = additional
    ? `<h2>${data.section_additional || 'Informações Adicionais'}</h2>\n<p class="additional">${additional}</p>`
    : '';
  html = html.replace('{{additional_info}}', additionalHtml);

  return html;
}

export function fillCoverTemplate(data: TailoredContent, profile?: ProfileSettings): string {
  let html = coverTemplate;

  if (profile) html = fillProfile(html, profile);

  html = html.replace('{{subtitle}}', data.cover_subtitle || 'Full Stack Developer');
  html = html.replace('{{greeting}}', data.cover_greeting || 'Prezado(a) Recrutador(a),');
  html = html.replace('{{closing}}', data.cover_closing || 'Atenciosamente');

  // Date
  const now = new Date();
  const city = profile?.location?.split(',')[0]?.trim() || '';
  const monthsPt = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const dateStr = city ? `${city}, ${now.getDate()} de ${monthsPt[now.getMonth() + 1]} de ${now.getFullYear()}` : '';
  html = html.replace('{{date}}', dateStr);

  // Paragraphs
  const parasHtml = (data.cover_paragraphs || []).map(p => `<p>${p}</p>`).join('\n');
  html = html.replace('{{paragraphs}}', parasHtml);

  return html;
}

/**
 * Note: PDF generation cannot run in a service worker (no DOM access).
 * The filled HTML is passed to the content script which uploads it directly.
 * Indeed's smartapply accepts PDF uploads — the content script handles
 * conversion using the browser's built-in capabilities if needed.
 */
