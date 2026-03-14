import type { JobStatus } from './job.js'

export interface SearchEntry {
  query: string
  location: string
  hoursOld: number
  resultsWanted: number
  country: string
}

export interface SearchesConfig {
  searches: SearchEntry[]
  scoreThreshold?: number
}

export type Platform = 'indeed' | 'linkedin' | 'glassdoor' | 'google_jobs'

export interface TailoredContent {
  // Contact (extracted by AI from profile text)
  profile_name: string
  profile_email: string
  profile_phone: string
  profile_location: string
  profile_linkedin: string
  profile_github: string
  profile_portfolio: string

  // CV content
  objective: string
  section_summary: string
  summary: string
  keywords: string[]
  section_skills: string
  skills: { label: string; items: string }[]
  section_experience: string
  experience: {
    title: string
    date: string
    company: string
    bullets: string[]
  }[]
  section_education: string
  education: { degree: string; institution: string; period: string }[]
  section_certifications: string
  certifications: string[]
  section_languages: string
  languages: { name: string; level: string }[]
  section_additional: string
  additional_info: string

  // Cover letter
  cover_subtitle: string
  cover_greeting: string
  cover_paragraphs: string[]
  cover_closing: string
}

export type PipelineStage = 'discover' | 'enrich' | 'score' | 'tailor' | 'render-pdf' | 'apply'

export interface QueueJobData {
  jobId: number
}

export interface DiscoverJobData {
  search: SearchEntry
}

export interface PipelineStatus {
  stage: PipelineStage
  queueDepths: Record<PipelineStage, number>
  activeCount: Record<PipelineStage, number>
  isRunning: boolean
}

export interface StatsEntry {
  status: JobStatus
  count: number
}
