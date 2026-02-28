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
  location: string;
  linkedin: string;
  github: string;
  instagram: string;
  portfolio: string;
}

export interface Settings {
  backendUrl: string; // Backend API URL that proxies Claude
  language: string; // us, uk, br, fr, de, es
  searchUrls: string[];
  maxApplies: number; // 0 = unlimited
  personalization: {
    enabled: boolean;
    baseCv: string; // markdown content
    baseCoverLetter: string; // markdown content
  };
  profile: ProfileSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: 'http://localhost:3000',
  language: 'br',
  searchUrls: [],
  maxApplies: 0,
  personalization: {
    enabled: true,
    baseCv: '',
    baseCoverLetter: '',
  },
  profile: {
    name: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    github: '',
    instagram: '',
    portfolio: '',
  },
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
  | 'GET_STATE'
  | 'SET_STATE'
  | 'START_BOT'
  | 'STOP_BOT'
  | 'PAUSE_BOT'
  | 'RESUME_BOT';

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
  totalJobs: number;
  currentJob?: string;
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
  section_projects: string;
  projects: { name: string; url: string; description: string }[];
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
