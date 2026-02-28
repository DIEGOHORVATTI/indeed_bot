/**
 * Claude API client — calls backend proxy that handles model selection and API keys.
 * The user never sees which model or API key is used.
 */

interface BackendAnswerRequest {
  question: string;
  options?: string[];
  jobTitle?: string;
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
  backendUrl: string
): Promise<string | null> {
  if (!backendUrl) return null;

  try {
    const body: BackendAnswerRequest = { question, jobTitle };
    if (options && options.length > 0) body.options = options;

    const response = await fetch(`${backendUrl}/api/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

/**
 * Generate tailored CV/cover letter content via backend.
 */
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
    baseCoverLetter,
  };

  const response = await fetch(`${backendUrl}/api/tailor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Backend tailor error (${response.status}): ${err}`);
  }

  return response.json();
}
