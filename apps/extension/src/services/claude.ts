/**
 * Claude API client — calls backend proxy that handles model selection and API keys.
 * The user never sees which model or API key is used.
 */

interface BackendAnswerRequest {
  question: string;
  options?: string[];
  jobTitle?: string;
  baseProfile?: string;
  constraints?: {
    type?: string;
    maxLength?: number;
    minLength?: number;
    min?: string;
    max?: string;
    pattern?: string;
    placeholder?: string;
  };
  errorContext?: string;
}

interface BackendTailorRequest {
  jobTitle: string;
  jobCompany: string;
  jobDescription: string;
  baseCv: string;
  baseCoverLetter: string;
}

/**
 * Ask backend for an answer to a questionnaire field.
 */
export async function askClaudeForAnswer(
  question: string,
  options: string[] | undefined,
  jobTitle: string,
  backendUrl: string,
  baseProfile?: string,
  constraints?: BackendAnswerRequest['constraints'],
  errorContext?: string
): Promise<string | null> {
  if (!backendUrl) return null;

  try {
    const body: BackendAnswerRequest = { question, jobTitle };
    if (baseProfile) body.baseProfile = baseProfile;
    if (options && options.length > 0) body.options = options;
    if (constraints) body.constraints = constraints;
    if (errorContext) body.errorContext = errorContext;

    const response = await fetch(`${backendUrl}/api/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      console.warn(`Backend answer error (${response.status})`);
      return null;
    }

    const data = await response.json();
    const answer = data.answer?.trim();
    if (!answer) return null;

    // If options provided, find best match
    if (options && options.length > 0) {
      // Multi-select: answer contains | separator — return as-is for caller to parse
      if (answer.includes('|')) {
        return answer;
      }
      const lower = answer.toLowerCase();
      for (const opt of options) {
        if (
          opt.toLowerCase() === lower ||
          opt.toLowerCase().includes(lower) ||
          lower.includes(opt.toLowerCase())
        ) {
          return opt;
        }
      }
      return options[0]; // Fallback to first option
    }

    return answer;
  } catch {
    return null;
  }
}

export interface BatchField {
  id: string;
  question: string;
  options?: string[];
  constraints?: BackendAnswerRequest['constraints'];
}

export interface BatchResult {
  answer: string | null;
  missing: boolean;
}

export async function askClaudeBatch(
  fields: BatchField[],
  jobTitle: string,
  backendUrl: string,
  baseProfile?: string
): Promise<Record<string, BatchResult> | null> {
  if (!backendUrl || fields.length === 0) return null;

  try {
    const response = await fetch(`${backendUrl}/api/answer-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, jobTitle, baseProfile })
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.results || null;
  } catch {
    return null;
  }
}


export async function generateTailoredContent(
  jobInfo: { title: string; company: string; description: string },
  baseCv: string,
  baseCoverLetter: string,
  backendUrl: string
): Promise<any> {
  if (!backendUrl) throw new Error('Backend URL not configured');

  const body: BackendTailorRequest = {
    jobTitle: jobInfo.title,
    jobCompany: jobInfo.company,
    jobDescription: jobInfo.description.substring(0, 4000),
    baseCv,
    baseCoverLetter
  };

  const response = await fetch(`${backendUrl}/api/tailor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Backend tailor error (${response.status}): ${err}`);
  }

  return response.json();
}

/**
 * Convert HTML to PDF via backend (Playwright).
 * Returns the PDF as an ArrayBuffer.
 */
export async function generatePdfFromHtml(
  html: string,
  backendUrl: string,
  filename?: string
): Promise<ArrayBuffer> {
  if (!backendUrl) throw new Error('Backend URL not configured');

  const response = await fetch(`${backendUrl}/api/generate-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, filename })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PDF generation error (${response.status}): ${err}`);
  }

  return response.arrayBuffer();
}

/**
 * Try to fetch an existing PDF from the backend output/ folder.
 * Returns the PDF ArrayBuffer if found, or null if not.
 */
export async function fetchExistingPdf(
  backendUrl: string,
  filename: string
): Promise<ArrayBuffer | null> {
  if (!backendUrl || !filename) return null;

  try {
    const response = await fetch(`${backendUrl}/api/pdf/${encodeURIComponent(filename)}`);
    if (!response.ok) return null;
    return response.arrayBuffer();
  } catch {
    return null;
  }
}
