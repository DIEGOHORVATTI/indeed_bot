/** Delay ranges in seconds [min, max] */
export const DELAY_APPLY: [number, number] = [45, 90]
export const DELAY_PAGE: [number, number] = [2, 5]
export const DELAY_DISCOVER: [number, number] = [3, 8]

/**
 * Sleep for a random duration between min and max seconds.
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const ms = (Math.random() * (max - min) + min) * 1000
  return new Promise((resolve) => setTimeout(resolve, ms))
}
