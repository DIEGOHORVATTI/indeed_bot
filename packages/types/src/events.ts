export interface SandboxState {
  screenshot: string | null
  pageContext: string | null
  currentJob: {
    title: string
    company: string
    score: number | null
    url: string
  } | null
  status: 'idle' | 'applying' | 'paused' | 'completed'
}

export interface SandboxEvent {
  type: string
  data: Record<string, unknown>
  timestamp: number
}

export type SandboxControlAction = 'pause' | 'resume' | 'skip'

export interface LogEntry {
  timestamp: number
  level: 'info' | 'warning' | 'error'
  message: string
}
