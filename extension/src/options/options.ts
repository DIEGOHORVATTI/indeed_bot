/**
 * Options page — settings management.
 */

import { Settings, DEFAULT_SETTINGS } from '../types';

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

// ── Field mappings ──
const fields = {
  searchUrls: $('search-urls') as unknown as HTMLTextAreaElement,
  language: $('language') as unknown as HTMLSelectElement,
  maxApplies: $('max-applies'),
  availableToday: $('available-today'),
  personalizationEnabled: $('personalization-enabled'),
  baseCv: $('base-cv') as unknown as HTMLTextAreaElement,
  baseCover: $('base-cover') as unknown as HTMLTextAreaElement,
  baseProfile: $('base-profile') as unknown as HTMLTextAreaElement,
  profileName: $('profile-name'),
  profileEmail: $('profile-email'),
  profilePhone: $('profile-phone'),
  profileLocation: $('profile-location'),
  profileLinkedin: $('profile-linkedin'),
  profileGithub: $('profile-github'),
  profileInstagram: $('profile-instagram'),
  profilePortfolio: $('profile-portfolio'),
};

// ── Load Settings ──

async function loadSettings(): Promise<void> {
  const data = await chrome.storage.local.get('settings');
  const s: Settings = { ...DEFAULT_SETTINGS, ...data.settings };

  fields.searchUrls.value = s.searchUrls.join('\n');
  fields.language.value = s.language;
  fields.maxApplies.value = String(s.maxApplies);
  fields.availableToday.checked = s.availableToday !== false; // default true
  fields.personalizationEnabled.checked = s.personalization.enabled;
  fields.baseCv.value = s.personalization.baseCv;
  fields.baseCover.value = s.personalization.baseCoverLetter;
  fields.baseProfile.value = s.personalization.baseProfile || DEFAULT_SETTINGS.personalization.baseProfile;
  fields.profileName.value = s.profile.name;
  fields.profileEmail.value = s.profile.email;
  fields.profilePhone.value = s.profile.phone;
  fields.profileLocation.value = s.profile.location;
  fields.profileLinkedin.value = s.profile.linkedin;
  fields.profileGithub.value = s.profile.github;
  fields.profileInstagram.value = s.profile.instagram;
  fields.profilePortfolio.value = s.profile.portfolio;
}

// ── Save Settings ──

async function saveSettings(): Promise<void> {
  // Preserve backendUrl from existing settings (hidden from UI)
  const existing = await chrome.storage.local.get('settings');
  const backendUrl = existing.settings?.backendUrl || DEFAULT_SETTINGS.backendUrl;

  const settings: Settings = {
    backendUrl,
    searchUrls: fields.searchUrls.value.split('\n').map(u => u.trim()).filter(Boolean),
    language: fields.language.value,
    maxApplies: parseInt(fields.maxApplies.value) || 0,
    availableToday: fields.availableToday.checked,
    personalization: {
      enabled: fields.personalizationEnabled.checked,
      baseCv: fields.baseCv.value,
      baseCoverLetter: fields.baseCover.value,
      baseProfile: fields.baseProfile.value,
    },
    profile: {
      name: fields.profileName.value.trim(),
      email: fields.profileEmail.value.trim(),
      phone: fields.profilePhone.value.trim(),
      location: fields.profileLocation.value.trim(),
      linkedin: fields.profileLinkedin.value.trim(),
      github: fields.profileGithub.value.trim(),
      instagram: fields.profileInstagram.value.trim(),
      portfolio: fields.profilePortfolio.value.trim(),
      birthDate: '',
      country: 'Brasil',
      rg: '',
      cpf: '',
      motherName: '',
      fatherName: '',
      address: '',
      cep: '',
    },
  };

  await chrome.storage.local.set({ settings });

  // Show saved message
  const msg = document.getElementById('saved-msg')!;
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2000);
}

// ── Init ──

loadSettings();
document.getElementById('btn-save')!.addEventListener('click', saveSettings);
