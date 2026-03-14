import { getAppliedCount } from '@jobpilot/db'

export const MAX_HOUR = 8
export const MAX_DAY = 50

/**
 * Return true if we can apply (under rate limits), false if throttled.
 */
export function checkRateLimit(db: ReturnType<typeof import('@jobpilot/db').getDb>): boolean {
  const hourCount = getAppliedCount(db, 'hour')
  if (hourCount >= MAX_HOUR) return false

  const dayCount = getAppliedCount(db, 'day')
  if (dayCount >= MAX_DAY) return false

  return true
}
