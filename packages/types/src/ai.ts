export interface AIProvider {
  complete(prompt: string, opts?: { maxTokens?: number; model?: string }): Promise<string>
}

export interface AnswerRequest {
  question: string
  options?: string[]
  jobTitle?: string
  baseProfile?: string
  constraints?: InputConstraints
  errorContext?: string
}

export interface InputConstraints {
  type?: string
  maxLength?: number
  minLength?: number
  min?: string
  max?: string
  pattern?: string
  placeholder?: string
}

export interface AnswerResponse {
  answer: string | null
}

export interface TailorRequest {
  jobTitle: string
  jobCompany: string
  jobDescription: string
  baseCv: string
  baseCoverLetter: string
}

export interface PdfRequest {
  html: string
  filename?: string
}
