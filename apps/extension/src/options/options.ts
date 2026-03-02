/**
 * Options page — settings management.
 */

import { Settings, DEFAULT_SETTINGS, FloatingButtonSettings } from '../types';

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

// ── Field mappings ──
const fields = {
  searchUrls: $('search-urls') as unknown as HTMLTextAreaElement,
  language: $('language') as unknown as HTMLSelectElement,
  maxApplies: $('max-applies'),
  concurrentTabs: $('concurrent-tabs'),
  availableToday: $('available-today'),
  personalizationEnabled: $('personalization-enabled'),
  baseCv: $('base-cv') as unknown as HTMLTextAreaElement,
  baseCover: $('base-cover') as unknown as HTMLTextAreaElement,
  baseProfile: $('base-profile') as unknown as HTMLTextAreaElement,
  profileName: $('profile-name'),
  profileEmail: $('profile-email'),
  profilePhone: $('profile-phone'),
  profileStreet: $('profile-street'),
  profileNeighborhood: $('profile-neighborhood'),
  profileCity: $('profile-city'),
  profileState: $('profile-state'),
  profileCep: $('profile-cep'),
  profileLinkedin: $('profile-linkedin'),
  profileGithub: $('profile-github'),
  profileInstagram: $('profile-instagram'),
  profilePortfolio: $('profile-portfolio'),
  // Floating button
  fbEnabled: $('fb-enabled'),
  fbPosition: $('fb-position') as unknown as HTMLSelectElement,
  fbStyle: $('fb-style') as unknown as HTMLSelectElement,
  fbSize: $('fb-size') as unknown as HTMLSelectElement,
  fbOpacity: $('fb-opacity'),
  fbShowSkip: $('fb-show-skip'),
};

// ── Load Settings ──

async function loadSettings(): Promise<void> {
  const data = await chrome.storage.local.get('settings');
  const s: Settings = { ...DEFAULT_SETTINGS, ...data.settings };

  fields.searchUrls.value = s.searchUrls.join('\n');
  fields.language.value = s.language;
  fields.maxApplies.value = String(s.maxApplies);
  fields.concurrentTabs.value = String(s.concurrentTabs || 1);
  fields.availableToday.checked = s.availableToday !== false; // default true
  // Floating button
  const fb = { ...DEFAULT_SETTINGS.floatingButton, ...s.floatingButton };
  fields.fbEnabled.checked = fb.enabled;
  fields.fbPosition.value = fb.position;
  fields.fbStyle.value = fb.style;
  fields.fbSize.value = fb.size;
  fields.fbOpacity.value = String(fb.opacity);
  fields.fbShowSkip.checked = fb.showSkip;

  fields.personalizationEnabled.checked = s.personalization.enabled;
  fields.baseCv.value = s.personalization.baseCv;
  fields.baseCover.value = s.personalization.baseCoverLetter;
  fields.baseProfile.value = s.personalization.baseProfile || DEFAULT_SETTINGS.personalization.baseProfile;
  fields.profileName.value = s.profile.name;
  fields.profileEmail.value = s.profile.email;
  fields.profilePhone.value = s.profile.phone;
  fields.profileStreet.value = s.profile.street;
  fields.profileNeighborhood.value = s.profile.neighborhood;
  fields.profileCity.value = s.profile.city;
  fields.profileState.value = s.profile.state;
  fields.profileCep.value = s.profile.cep;
  fields.profileLinkedin.value = s.profile.linkedin;
  fields.profileGithub.value = s.profile.github;
  fields.profileInstagram.value = s.profile.instagram;
  fields.profilePortfolio.value = s.profile.portfolio;
}

// ── Save Settings ──

async function saveSettings(): Promise<void> {
  // Preserve fields hidden from UI
  const existing = await chrome.storage.local.get('settings');
  const prev = existing.settings || {};

  const settings: Settings = {
    backendUrl: prev.backendUrl || DEFAULT_SETTINGS.backendUrl,
    searchUrls: fields.searchUrls.value.split('\n').map(u => u.trim()).filter(Boolean),
    language: fields.language.value,
    maxApplies: parseInt(fields.maxApplies.value) || 0,
    concurrentTabs: Math.max(1, Math.min(5, parseInt(fields.concurrentTabs.value) || 1)),
    availableToday: fields.availableToday.checked,
    floatingButton: {
      enabled: fields.fbEnabled.checked,
      position: fields.fbPosition.value as FloatingButtonSettings['position'],
      style: fields.fbStyle.value as FloatingButtonSettings['style'],
      size: fields.fbSize.value as FloatingButtonSettings['size'],
      opacity: Math.max(0.1, Math.min(1, parseFloat(fields.fbOpacity.value) || 0.9)),
      showSkip: fields.fbShowSkip.checked,
    },
    personalization: {
      enabled: fields.personalizationEnabled.checked,
      baseCv: fields.baseCv.value,
      baseCoverLetter: fields.baseCover.value,
      baseProfile: fields.baseProfile.value,
    },
    profile: {
      ...DEFAULT_SETTINGS.profile,
      ...prev.profile,
      name: fields.profileName.value.trim(),
      email: fields.profileEmail.value.trim(),
      phone: fields.profilePhone.value.trim(),
      street: fields.profileStreet.value.trim(),
      neighborhood: fields.profileNeighborhood.value.trim(),
      city: fields.profileCity.value.trim(),
      state: fields.profileState.value.trim(),
      cep: fields.profileCep.value.trim(),
      linkedin: fields.profileLinkedin.value.trim(),
      github: fields.profileGithub.value.trim(),
      instagram: fields.profileInstagram.value.trim(),
      portfolio: fields.profilePortfolio.value.trim(),
    },
  };

  await chrome.storage.local.set({ settings });

  // Show saved message
  const msg = document.getElementById('saved-msg')!;
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2000);
}

// ── LinkedIn Import ──

async function importLinkedIn(): Promise<void> {
  const usernameInput = $('linkedin-username');
  const statusEl = document.getElementById('import-status')!;
  const btn = document.getElementById('btn-import-linkedin') as HTMLButtonElement;
  const username = usernameInput.value.trim();

  if (!username) {
    statusEl.textContent = 'Enter a LinkedIn username or URL';
    statusEl.className = 'import-status error';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Importing...';
  statusEl.textContent = 'Opening LinkedIn profile...';
  statusEl.className = 'import-status';

  try {
    const response = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'SCRAPE_LINKEDIN', payload: { username } },
        resolve,
      );
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    const data = response?.payload;
    if (!data) {
      throw new Error('No data returned');
    }

    // ── Fill Profile fields ──
    if (data.name) fields.profileName.value = data.name;
    if (data.city) fields.profileCity.value = data.city;
    if (data.state) fields.profileState.value = data.state;
    if (data.linkedin) fields.profileLinkedin.value = data.linkedin;
    if (data.github) fields.profileGithub.value = data.github;
    if (data.instagram) fields.profileInstagram.value = data.instagram;
    if (data.portfolio) fields.profilePortfolio.value = data.portfolio;

    // ── Generate Base CV (Markdown) ──
    const cvLines: string[] = [];
    cvLines.push(`# ${data.name}`);
    if (data.headline) cvLines.push(`**${data.headline}**\n`);

    if (data.about) {
      cvLines.push('## Resumo Profissional');
      cvLines.push(data.about + '\n');
    }

    if (data.experience?.length) {
      cvLines.push('## Experiência Profissional');
      for (const job of data.experience) {
        cvLines.push(`### ${job.title}`);
        const meta = [job.company, job.dates].filter(Boolean).join(' | ');
        if (meta) cvLines.push(`*${meta}*`);
        if (job.description) cvLines.push(job.description);
        cvLines.push('');
      }
    }

    if (data.education?.length) {
      cvLines.push('## Formação');
      for (const edu of data.education) {
        const line = [edu.degree, edu.school, edu.dates].filter(Boolean).join(' — ');
        cvLines.push(`- ${line}`);
      }
      cvLines.push('');
    }

    if (data.skills?.length) {
      cvLines.push('## Competências');
      cvLines.push(data.skills.join(', ') + '\n');
    }

    if (data.certifications?.length) {
      cvLines.push('## Certificações');
      for (const cert of data.certifications) {
        const line = [cert.name, cert.issuer, cert.date].filter(Boolean).join(' — ');
        cvLines.push(`- ${line}`);
      }
      cvLines.push('');
    }

    if (data.languages?.length) {
      cvLines.push('## Idiomas');
      for (const lang of data.languages) {
        cvLines.push(`- ${lang.name}${lang.level ? ` (${lang.level})` : ''}`);
      }
      cvLines.push('');
    }

    if (cvLines.length > 2) {
      fields.baseCv.value = cvLines.join('\n');
    }

    // ── Generate Base Cover Letter (Markdown) ──
    if (data.name && data.headline) {
      const coverLines = [
        `Prezado(a) Recrutador(a),\n`,
        `Meu nome é ${data.name} e sou ${data.headline}.`,
      ];
      if (data.about) {
        const firstSentence = data.about.split('.')[0] + '.';
        coverLines.push(firstSentence);
      }
      if (data.experience?.length) {
        const latest = data.experience[0];
        coverLines.push(`Atualmente atuo como ${latest.title}${latest.company ? ` na ${latest.company}` : ''}.`);
      }
      coverLines.push(
        `\nEstou à disposição para uma conversa e posso contribuir significativamente para o sucesso da equipe.\n`,
        `Atenciosamente,`,
        data.name,
      );
      fields.baseCover.value = coverLines.join('\n');
    }

    // ── Fill Profile / Personal Data markdown ──
    const currentProfile = fields.baseProfile.value || DEFAULT_SETTINGS.personalization.baseProfile;
    const replacements: Record<string, string> = {
      'Nome completo:': `Nome completo: ${data.name || ''}`,
      'LinkedIn:': `LinkedIn: ${data.linkedin || ''}`,
      'GitHub:': `GitHub: ${data.github || ''}`,
      'Portfolio/Website:': `Portfolio/Website: ${data.portfolio || ''}`,
      'Instagram:': `Instagram: ${data.instagram || ''}`,
      'Cidade:': `Cidade: ${data.city || ''}`,
      'Estado:': `Estado: ${data.state || ''}`,
    };
    let updatedProfile = currentProfile;
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`^(- ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}).*$`, 'm');
      updatedProfile = updatedProfile.replace(regex, `- ${value}`);
    }
    fields.baseProfile.value = updatedProfile;

    statusEl.textContent = 'Profile imported! Review all fields and click Save.';
    statusEl.className = 'import-status success';
  } catch (err: any) {
    statusEl.textContent = err.message || 'Failed to import';
    statusEl.className = 'import-status error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}

// ── Init ──

loadSettings();
document.getElementById('btn-save')!.addEventListener('click', saveSettings);
document.getElementById('btn-import-linkedin')!.addEventListener('click', importLinkedIn);
