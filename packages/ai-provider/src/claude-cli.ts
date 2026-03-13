import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { AIProvider } from '@jobpilot/types'

export class ClaudeCLI implements AIProvider {
  private bin: string
  private nodeBin: string | null = null

  constructor() {
    this.bin = this.findBinary()
    const binDir = dirname(this.bin)
    const nodeCandidate = join(binDir, 'node')
    if (existsSync(nodeCandidate)) {
      this.nodeBin = nodeCandidate
    }
  }

  private findBinary(): string {
    const envPath = process.env.CLAUDE_CLI_PATH
    if (envPath && existsSync(envPath)) return envPath

    // Check PATH via which
    const { execSync } = require('node:child_process')
    try {
      const result = execSync('which claude', { encoding: 'utf-8' }).trim()
      if (result) return result
    } catch {
      // fall through
    }

    // Fallback: common nvm location
    const nvmPath = join(homedir(), '.nvm', 'versions', 'node')
    if (existsSync(nvmPath)) {
      const versions = readdirSync(nvmPath).sort().reverse()
      for (const version of versions) {
        const candidate = join(nvmPath, version, 'bin', 'claude')
        if (existsSync(candidate)) return candidate
      }
    }

    throw new Error('claude CLI not found. Install it or set CLAUDE_CLI_PATH env var.')
  }

  async complete(
    prompt: string,
    opts?: { maxTokens?: number; model?: string }
  ): Promise<string> {
    const args: string[] = [
      '-p',
      '-',
      '--no-session-persistence',
      '--output-format',
      'json',
    ]
    if (opts?.model) args.push('--model', opts.model)
    if (opts?.maxTokens) args.push('--max-budget-usd', '1')

    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE')
    )

    const bin = this.nodeBin ? this.nodeBin : this.bin
    const spawnArgs = this.nodeBin ? [this.bin, ...args] : args

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(bin, spawnArgs, {
        env,
        cwd: '/tmp',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300_000,
      })

      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      proc.on('error', (err) => reject(err))
      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`))
        }
        if (!stdout.trim()) {
          return reject(new Error(`claude CLI returned empty output. stderr: ${stderr}`))
        }
        try {
          const wrapper = JSON.parse(stdout.trim())
          if (typeof wrapper === 'object' && wrapper !== null && 'result' in wrapper) {
            return resolve((wrapper.result as string).trim())
          }
        } catch {
          // not JSON
        }
        resolve(stdout.trim())
      })

      proc.stdin.write(prompt)
      proc.stdin.end()
    })
  }
}
