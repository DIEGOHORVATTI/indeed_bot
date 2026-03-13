import { Redis } from 'ioredis'
import { REDIS_URL } from '@jobpilot/config'

const pub = new Redis(REDIS_URL)
const sub = new Redis(REDIS_URL)

type ExtensionCommand =
  | { type: 'cmd:start'; payload: { searchUrls: string[]; maxApplies: number } }
  | { type: 'cmd:stop' }
  | { type: 'cmd:pause' }
  | { type: 'cmd:resume' }
  | {
      type: 'cmd:apply'
      payload: {
        jobId: number
        url: string
        title: string
        company: string
        cvPdfUrl?: string
        coverPdfUrl?: string
      }
    }

let extensionConnected = false
const responseHandlers = new Map<string, (data: unknown) => void>()

sub.subscribe('extension:response', 'sandbox:state')
sub.on('message', (_channel: string, message: string) => {
  try {
    const data = JSON.parse(message)
    extensionConnected = true
    void data
    void responseHandlers
  } catch {}
})

export async function sendCommand(command: ExtensionCommand): Promise<void> {
  await pub.publish('extension:command', JSON.stringify(command))
}

export async function isExtensionConnected(): Promise<boolean> {
  const result = await pub.get('extension:connected')
  return result === 'true'
}

export async function startDiscovery(searchUrls: string[], maxApplies: number): Promise<void> {
  await sendCommand({
    type: 'cmd:start',
    payload: { searchUrls, maxApplies },
  })
}

export async function requestApply(
  jobId: number,
  url: string,
  title: string,
  company: string,
  cvPdfUrl?: string,
  coverPdfUrl?: string
): Promise<void> {
  await sendCommand({
    type: 'cmd:apply',
    payload: { jobId, url, title, company, cvPdfUrl, coverPdfUrl },
  })
}

export async function stopExtension(): Promise<void> {
  await sendCommand({ type: 'cmd:stop' })
}

export function cleanup(): void {
  void extensionConnected
  pub.quit()
  sub.unsubscribe()
  sub.quit()
}
