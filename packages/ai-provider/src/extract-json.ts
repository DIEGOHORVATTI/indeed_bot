export function extractJson(text: string): Record<string, unknown> {
  let cleaned = text.trim()

  // Remove ```json ... ``` fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '')
  cleaned = cleaned.replace(/\n?```\s*$/, '')
  cleaned = cleaned.trim()

  // Find first { ... last }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}') + 1

  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end)) as Record<string, unknown>
  }

  throw new SyntaxError('No JSON object found in AI output')
}
