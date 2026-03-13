import { getProvider, extractJson } from '@jobpilot/ai'
import { MODEL_FAST } from '@jobpilot/config'
import type { BrowserSandbox } from './sandbox.js'
import type { Job } from '@jobpilot/types'
import { buildApplyPrompt } from './prompts.js'

const MAX_STEPS = 30

interface AgentResult {
  status: 'applied' | 'captcha' | 'login_required' | 'antibot' | 'failed' | 'skipped'
  reason: string
}

interface AgentAction {
  thought?: string
  action: string
  selector?: string
  value?: string
  reason?: string
}

function parseAction(raw: string): AgentAction | null {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text
      .split('\n')
      .filter((l) => !l.startsWith('```'))
      .join('\n')
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}') + 1
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end)) as AgentAction
  } catch {
    return null
  }
}

export async function runAgent(opts: {
  job: Job
  profileText: string
  cvPdfPath: string
  coverPdfPath: string
  sandbox: BrowserSandbox
  dryRun?: boolean
}): Promise<AgentResult> {
  const { job, profileText, cvPdfPath, coverPdfPath, sandbox, dryRun = false } = opts
  const ai = getProvider()
  const history: { step: number; action: string; selector?: string; value?: string }[] = []

  // Navigate
  try {
    await sandbox.navigate(job.url)
    await sandbox.wait(2000)
  } catch (err) {
    return { status: 'failed', reason: `Navigation failed: ${err}` }
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    let ctx: string
    try {
      ctx = await sandbox.getPageContext()
    } catch (err) {
      ctx = `Error reading page: ${err}`
    }

    const prompt = buildApplyPrompt({
      job,
      profileText,
      pageContext: ctx,
      step,
      maxSteps: MAX_STEPS,
      history,
      cvPath: cvPdfPath,
      coverPath: coverPdfPath,
      dryRun,
    })

    let raw: string
    try {
      raw = await ai.complete(prompt, { model: MODEL_FAST })
    } catch (err) {
      console.error(`[agent] AI call failed at step ${step}: ${err}`)
      continue
    }

    const action = parseAction(raw)
    if (!action) {
      console.warn(`[agent] Unparseable AI response: ${raw.slice(0, 200)}`)
      continue
    }

    const { action: act, selector: sel = '', value: val = '', reason = '' } = action
    history.push({ step, action: act, selector: sel, value: val })

    // Terminal actions
    if (act === 'done' || act === 'applied') {
      return { status: 'applied', reason }
    }
    if (['captcha', 'login_required', 'antibot', 'failed'].includes(act)) {
      return { status: act as AgentResult['status'], reason }
    }

    // Execute browser action
    try {
      if (act === 'click') await sandbox.click(sel)
      else if (act === 'fill') await sandbox.fill(sel, val)
      else if (act === 'select') await sandbox.selectOption(sel, val)
      else if (act === 'upload') {
        const lower = (sel + val + reason).toLowerCase()
        const path = ['cover', 'carta', 'letter'].some((k) => lower.includes(k))
          ? coverPdfPath
          : cvPdfPath
        await sandbox.uploadFile(sel, path)
      } else if (act === 'wait') {
        await sandbox.wait(2000)
      }
    } catch (err) {
      console.warn(`[agent] Action ${act} on ${sel} failed: ${err}`)
    }

    await sandbox.wait(1000)
  }

  return { status: 'failed', reason: 'Max steps exceeded' }
}
