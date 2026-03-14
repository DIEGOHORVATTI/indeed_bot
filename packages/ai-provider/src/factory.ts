import type { AIProvider } from '@jobpilot/types'
import { ClaudeCLI } from './claude-cli.js'

let provider: AIProvider | null = null

export function getProvider(): AIProvider {
  if (!provider) {
    provider = new ClaudeCLI()
  }
  return provider
}
