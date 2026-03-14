export type JobStatus =
  | 'discovered'
  | 'enriched'
  | 'scored'
  | 'tailored'
  | 'ready'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'skipped'

export type ApplyType = 'easy_apply' | 'external'

export interface Job {
  id: number
  url: string
  source: string | null
  title: string | null
  company: string | null
  location: string | null
  salary: string | null
  datePosted: string | null
  searchQuery: string | null
  description: string | null
  score: number | null
  scoreReason: string | null
  tailoredCv: string | null
  cvPdfPath: string | null
  coverPdfPath: string | null
  status: JobStatus
  applyType: ApplyType | null
  jobKey: string | null
  failReason: string | null
  createdAt: string
  updatedAt: string
}

export interface JobInfo {
  title: string
  company: string
  description: string
  url: string
}
