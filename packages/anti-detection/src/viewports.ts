export const VIEWPORTS: [number, number][] = [
  [1366, 768],
  [1440, 900],
  [1280, 720],
  [1536, 864],
  [1920, 1080],
]

export function randomViewport(): { width: number; height: number } {
  const [width, height] = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]
  return { width, height }
}
