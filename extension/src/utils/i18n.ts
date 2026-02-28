/**
 * Multi-language keyword maps for Indeed button/text matching.
 * Ported from Python indeed.py
 */

export const SUBMIT_KEYWORDS = [
  'submit', 'soumettre', 'enviar', 'déposer', 'apply',
  'bewerben', 'postular', 'candidatura',
];

export const CONTINUE_KEYWORDS = [
  'continue', 'continuer', 'continuar', 'next',
  'próximo', 'suivant', 'weiter',
];

export const SKIP_KEYWORDS = [
  'back', 'previous', 'anterior', 'retour', 'cancel',
  'close', 'fechar', 'voltar', 'précédent',
];

export const EXTERNAL_APPLY_KEYWORDS = [
  'site da empresa', 'company site', "company's site",
  "site de l'entreprise", 'unternehmenswebsite',
  'sitio de la empresa', 'external site',
];

export const APPLY_BUTTON_SELECTORS = [
  'button:has(span[class*="css-1ebo7dz"])',
  'button[id*="indeedApplyButton"]',
  '[data-testid="indeedApplyButton"]',
  'button:visible:has-text("Candidatar")',
  'button:visible:has-text("Candidatura simplificada")',
  'button:visible:has-text("Postuler")',
  'button:visible:has-text("Apply now")',
  'button:visible:has-text("Apply")',
];

export const APPLY_HEURISTIC_KEYWORDS = [
  'postuler', 'apply', 'candidat', 'bewerben', 'postular',
];

export const SUBMIT_SELECTORS = [
  'button:visible:has-text("Déposer ma candidature")',
  'button:visible:has-text("Soumettre")',
  'button:visible:has-text("Submit your application")',
  'button:visible:has-text("Submit")',
  'button:visible:has-text("Enviar candidatura")',
  'button:visible:has-text("Enviar")',
  'button:visible:has-text("Apply")',
  'button:visible:has-text("Bewerben")',
  'button:visible:has-text("Postular")',
];

export const CONTINUE_SELECTORS = [
  '[data-testid="continue-button"]',
  'button:visible:has-text("Continuer")',
  'button:visible:has-text("Continue")',
  'button:visible:has-text("Continuar")',
  'button:visible:has-text("Next")',
  'button:visible:has-text("Próximo")',
  'button:visible:has-text("Suivant")',
  'button:visible:has-text("Weiter")',
];

export const RESUME_OPTIONS_SELECTORS = [
  '[data-testid="ResumeOptionsMenu"]',
  'button:visible:has-text("opções de currículo")',
  'button:visible:has-text("Opções de currículo")',
  'button:visible:has-text("Resume options")',
  'button:visible:has-text("resume options")',
  'button:visible:has-text("Opções")',
  'button:visible:has-text("Options")',
  '[data-testid*="resumeSelection"] button:visible',
  '[data-testid="resume-selection"] button:visible',
  '[aria-label*="resume" i] button:visible',
  'button:visible:has-text("Change")',
  'button:visible:has-text("Alterar")',
  'button:visible:has-text("Currículo")',
  'button:visible:has-text("CV")',
];

export const UPLOAD_BUTTON_SELECTORS = [
  '[data-testid="ResumeOptionsMenu-upload"]',
  '[data-testid="resume-selection-file-resume-upload-radio-card-button"]',
  '[data-testid="resume-selection-file-resume-radio-card-button"]',
  'button:visible:has-text("Carregar um arquivo diferente")',
  'button:visible:has-text("carregar um arquivo diferente")',
  'button:visible:has-text("Upload a different file")',
  'button:visible:has-text("upload a different")',
  'button:visible:has-text("Selecionar arquivo")',
  'button:visible:has-text("Select file")',
  'button:visible:has-text("Upload new")',
  'button:visible:has-text("Upload resume")',
  'button:visible:has-text("Upload CV")',
  'button:visible:has-text("Enviar currículo")',
  'button:visible:has-text("Enviar CV")',
  'button:visible:has-text("Carregar")',
  'button:visible:has-text("Upload")',
  'a:visible:has-text("carregar")',
  'a:visible:has-text("Upload")',
  'a:visible:has-text("upload")',
  'label:visible:has-text("Upload")',
  'label:visible:has-text("Carregar")',
  '[data-testid="ResumeUploadButton"]',
  '[data-testid*="uploadResume" i]',
];

export const COVER_LETTER_SELECTORS = [
  'button:visible:has-text("cover letter")',
  'button:visible:has-text("Cover Letter")',
  'button:visible:has-text("Upload cover")',
  'button:visible:has-text("carta")',
  'button:visible:has-text("carta de apresentação")',
  'button:visible:has-text("Carta de Apresentação")',
  'a:visible:has-text("cover letter")',
  'a:visible:has-text("Upload cover")',
  'a:visible:has-text("carta de apresentação")',
  'a:visible:has-text("Enviar carta")',
  'a:visible:has-text("carta")',
  'label:visible:has-text("cover letter")',
  'label:visible:has-text("carta")',
  '[data-testid*="coverLetter" i] button:visible',
  '[data-testid*="cover-letter" i] button:visible',
];

export const RESUME_CARD_SELECTORS = [
  '[data-testid="resume-selection-file-resume-upload-radio-card"]',
  '[data-testid="resume-selection-file-resume-upload-radio-card-input"]',
  '[data-testid="resume-selection-file-resume-radio-card"]',
  '[data-testid="resume-selection-file-resume-radio-card-input"]',
  '[data-testid="FileResumeCardHeader-title"]',
  '[data-testid="fileResumeCard"]',
  '[data-testid="ResumeCard"]',
  '[data-testid*="resumeCard" i]',
  '[data-testid*="resume-display"]',
  'div[class*="ResumeCard"]',
  'div[class*="resume-card"]',
  '[data-testid="resume-display-text"]',
];

/** Return the appropriate Indeed domain for a given language/locale code. */
export function domainForLanguage(lang: string): string {
  const l = lang.toLowerCase();
  if (l === 'en' || l === 'us') return 'www.indeed.com';
  if (l === 'uk') return 'uk.indeed.com';
  return `${l}.indeed.com`;
}
