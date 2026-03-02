// ── Bot State ──
export type BotState = 'idle' | 'collecting' | 'applying' | 'paused' | 'waiting_user';

export interface JobEntry {
  url: string;
  jobKey: string;
  title?: string;
  company?: string;
  status: 'pending' | 'applied' | 'skipped' | 'failed';
  skipReason?: string;
}

// ── Settings ──
export interface ProfileSettings {
  name: string;
  email: string;
  phone: string;
  // Address (segmented)
  street: string; // Rua + número
  neighborhood: string; // Bairro
  city: string;
  state: string;
  cep: string;
  country: string;
  // Links
  linkedin: string;
  github: string;
  instagram: string;
  portfolio: string;
  // Personal data for Brazilian job applications
  birthDate: string; // DD/MM/YYYY
  rg: string;
  cpf: string;
  motherName: string;
  fatherName: string;
}

export interface FloatingButtonSettings {
  enabled: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  style: 'fixed' | 'absolute' | 'sticky';
  size: 'small' | 'medium' | 'large';
  opacity: number; // 0.1 - 1.0
  showSkip: boolean; // Show a "Skip" button alongside "Next"
}

export interface Settings {
  backendUrl: string; // Backend API URL that proxies Claude
  language: string; // us, uk, br, fr, de, es
  searchUrls: string[];
  maxApplies: number; // 0 = unlimited
  availableToday: boolean; // When true, date fields asking "when can you start" → today's date
  concurrentTabs: number; // 1-5, number of simultaneous application tabs
  floatingButton: FloatingButtonSettings;
  personalization: {
    enabled: boolean;
    baseCv: string; // markdown content
    baseCoverLetter: string; // markdown content
    baseProfile: string; // markdown with personal data for form filling
  };
  profile: ProfileSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: 'http://localhost:3000',
  language: 'br',
  searchUrls: [],
  maxApplies: 0,
  availableToday: true,
  concurrentTabs: 1,
  floatingButton: {
    enabled: true,
    position: 'bottom-right',
    style: 'fixed',
    size: 'medium',
    opacity: 0.9,
    showSkip: true
  },
  personalization: {
    enabled: true,
    baseCv: '',
    baseCoverLetter: '',
    baseProfile: `# Dados Pessoais
- Nome completo:
- Email:
- Telefone:
- Data de nascimento (DD/MM/YYYY):
- CPF:
- RG:
- País:
- Nacionalidade:
- Estado civil:
- CEP:
- Rua (com número):
- Bairro:
- Cidade:
- Estado:
- Nome completo da mãe:
- Nome completo do pai:
- Gênero:
- Etnia/Raça (autodeclaração):

# Links Profissionais
- LinkedIn:
- GitHub:
- Portfolio/Website:
- Instagram:

# Preferências Profissionais
- Pretensão salarial (CLT):
- Pretensão salarial (PJ):
- Modelo de contratação preferido (CLT/PJ/Ambos):
- Disponibilidade para início:
- Aceita trabalho remoto:
- Aceita trabalho híbrido:
- Aceita trabalho presencial:
- Aceita mudança de cidade/estado:
- Aceita viagens a trabalho:
- Horário de trabalho preferido:

# Experiência e Formação
- Nível profissional (Júnior/Pleno/Sênior):
- Anos de experiência total:
- Área de atuação principal:
- Formação acadêmica:
- Instituição de ensino:
- Ano de conclusão:

# Documentos e Habilitação
- Possui CNH:
- Categoria CNH:
- Possui veículo próprio:
- PIS/PASEP:
- Título de eleitor:
- Carteira de trabalho digital:

# Saúde e Acessibilidade
- Pessoa com deficiência (PCD):
- Tipo de deficiência (se aplicável):

# Idiomas
- Português:
- Inglês:
- Espanhol:
- Outros:

# Conhecimentos Técnicos (regras para a IA)
- Responder positivamente sobre qualquer tecnologia mencionada
- Anos de experiência por tecnologia específica:
- Sempre dizer que já trabalhou com a ferramenta/framework mencionado`
  },
  profile: {
    name: '',
    email: '',
    phone: '',
    street: '',
    neighborhood: '',
    city: '',
    state: '',
    cep: '',
    country: 'Brasil',
    linkedin: '',
    github: '',
    instagram: '',
    portfolio: '',
    birthDate: '',
    rg: '',
    cpf: '',
    motherName: '',
    fatherName: ''
  }
};

// ── Messages (service worker <-> content scripts) ──
export type MessageType =
  | 'COLLECT_LINKS'
  | 'LINKS_COLLECTED'
  | 'CLICK_APPLY'
  | 'APPLY_RESULT'
  | 'SCRAPE_JOB'
  | 'JOB_SCRAPED'
  | 'WIZARD_READY'
  | 'FILL_AND_ADVANCE'
  | 'STEP_RESULT'
  | 'ASK_CLAUDE'
  | 'CLAUDE_RESPONSE'
  | 'NEED_USER_INPUT'
  | 'STATUS_UPDATE'
  | 'GET_NEXT_PAGE'
  | 'NEXT_PAGE'
  | 'GET_TOTAL_COUNT'
  | 'TOTAL_COUNT'
  | 'GET_STATE'
  | 'SET_STATE'
  | 'START_BOT'
  | 'STOP_BOT'
  | 'PAUSE_BOT'
  | 'RESUME_BOT'
  | 'ADD_LOG'
  | 'SCRAPE_LINKEDIN'
  | 'STEP_ADVANCED'
  | 'TAB_SUBMITTED';

export interface Message {
  type: MessageType;
  payload?: any;
}

// ── Job Info (scraped from page) ──
export interface JobInfo {
  title: string;
  company: string;
  description: string;
  url: string;
}

// ── Answer Cache Entry ──
export interface CacheEntry {
  label: string;
  tokens: string[];
  inputType: string;
  answer: string;
  options: string[];
}

// ── Bot Status (for popup display) ──
export interface BotStatus {
  state: BotState;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  pendingJobs: number;
  totalJobs: number;
  currentJob?: string;
  currentSearchUrl?: string;
  currentSearchIndex?: number;
  totalSearchUrls?: number;
  // Collection progress
  currentPage?: number;
  totalPages?: number;
  estimatedTotalJobs?: number;
  // Collection stats (breakdown of why jobs were skipped during scraping)
  collectionStats?: {
    externalApply: number;
    duplicates: number;
    alreadyKnown: number;
  };
  // Worker pool
  activeWorkers?: number;
  concurrentTabs?: number;
  log: LogEntry[];
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warning' | 'error';
  message: string;
}

// ── CV Generation Data ──
export interface TailoredContent {
  objective: string;
  section_summary: string;
  summary: string;
  keywords: string[];
  section_skills: string;
  skills: { label: string; items: string }[];
  section_experience: string;
  experience: {
    title: string;
    date: string;
    company: string;
    bullets: string[];
  }[];
  section_education: string;
  education: { degree: string; institution: string; period: string }[];
  section_certifications: string;
  certifications: string[];
  section_languages: string;
  languages: { name: string; level: string }[];
  section_additional: string;
  additional_info: string;
  cover_subtitle: string;
  cover_greeting: string;
  cover_paragraphs: string[];
  cover_closing: string;
}
