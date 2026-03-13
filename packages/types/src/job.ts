export type JobStatus =
  | 'discovered'
  | 'enriched'
  | 'scored'
  | 'tailored'
  | 'ready'
  | 'applied'
  | 'failed'
  | 'skipped'

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
