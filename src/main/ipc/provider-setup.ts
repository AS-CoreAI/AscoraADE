import { ipcMain } from 'electron'
import crossSpawn from 'cross-spawn'
import { spawn } from 'node:child_process'
import { IPC, normalizeOpenRouterApiKey, type LlmProvider } from '@shared/ipc'
import type { ProviderCreditInfo, ProviderInstallResult, ProviderSoftwareInfo } from '@shared/provider-setup'
import { getStore } from '../store'

// Package names and commands are owned by the main process, never supplied by IPC.
const PACKAGES: Partial<Record<LlmProvider, string>> = {
  codex: '@openai/codex', claude: '@anthropic-ai/claude-code',
  copilot: '@github/copilot', gemini: '@google/gemini-cli', grok: '@xai-official/grok'
}
const DOWNLOADS: Partial<Record<LlmProvider, string>> = {
  codex: 'https://developers.openai.com/codex/cli/',
  claude: 'https://code.claude.com/docs/en/setup',
  copilot: 'https://docs.github.com/en/copilot/get-started/cli-quickstart',
  gemini: 'https://geminicli.com/docs/', grok: 'https://x.ai/cli',
  glm: 'https://zcode.z.ai/', antigravity: 'https://antigravity.google/download',
  lmstudio: 'https://lmstudio.ai/download', ollama: 'https://ollama.com/download'
}
const WINGET: Partial<Record<LlmProvider, string>> = { lmstudio: 'ElementLabs.LMStudio', ollama: 'Ollama.Ollama' }
const installs = new Map<string, Promise<ProviderInstallResult>>()

function run(file: string, args: string[], timeout = 8000): Promise<ProviderInstallResult> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const child = crossSpawn(file, args, { windowsHide: true, env: { ...process.env } })
    const done = (result: ProviderInstallResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
      } else child.kill('SIGTERM')
      done({ ok: false, error: 'Installation or software check timed out.' })
    }, timeout)
    const append = (data: Buffer): void => { output = (output + data.toString()).slice(-4000) }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', (error) => done({ ok: false, error: error.message }))
    child.on('close', (code) => done({ ok: code === 0, error: code === 0 ? undefined : output || `Exit code ${code}` }))
  })
}

async function plan(provider: LlmProvider): Promise<ProviderSoftwareInfo & { file?: string; args?: string[] }> {
  if (typeof provider !== 'string' || !Object.hasOwn(DOWNLOADS, provider)) return { available: false }
  const url = DOWNLOADS[provider]
  const pkg = Object.hasOwn(PACKAGES, provider) ? PACKAGES[provider] : undefined
  if (pkg) {
    const npm = await run('npm', ['--version'])
    return npm.ok
      ? { available: true, url, file: 'npm', args: ['install', '-g', pkg], command: `npm install -g ${pkg}` }
      : { available: false, url, error: 'Node.js / npm is required for automatic installation.' }
  }
  const wingetId = Object.hasOwn(WINGET, provider) ? WINGET[provider] : undefined
  if (process.platform === 'win32' && wingetId) {
    const winget = await run('winget', ['--version'])
    if (winget.ok) return { available: true, url, file: 'winget', args: ['install', '--id', wingetId, '-e', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], command: `winget install --id ${wingetId} -e` }
  }
  return { available: false, url }
}

export function registerProviderSetupHandlers(): void {
  ipcMain.handle(IPC.providerSetup.credits, async (_event, provider: LlmProvider): Promise<ProviderCreditInfo> => {
    if (provider !== 'openrouter') return { ok: false, error: 'Credit reporting is unavailable for this provider.' }
    const key = normalizeOpenRouterApiKey(getStore().getSetting<string>('openrouter.apiKey') ?? '')
    if (!key) return { ok: false, error: 'Save an OpenRouter API key to check its remaining credits.' }
    try {
      // https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
      const response = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) return { ok: false, error: `OpenRouter: HTTP ${response.status}` }
      const body = await response.json() as { data?: { limit_remaining?: number | null; limit?: number | null; usage?: number } }
      const data = body.data
      if (!data) return { ok: false, error: 'OpenRouter returned no credit information.' }
      return { ok: true, remaining: data.limit_remaining, limit: data.limit, used: data.usage }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle(IPC.providerSetup.inspect, async (_event, provider: LlmProvider): Promise<ProviderSoftwareInfo> => {
    const { file: _file, args: _args, ...info } = await plan(provider)
    return info
  })
  ipcMain.handle(IPC.providerSetup.install, (_event, provider: LlmProvider): Promise<ProviderInstallResult> => {
    const existing = installs.get(provider)
    if (existing) return existing
    const pending = (async () => {
      const info = await plan(provider)
      if (!info.available || !info.file || !info.args) return { ok: false, error: info.error ?? 'Automatic installation is unavailable. Use the official download page.' }
      return run(info.file, info.args, 10 * 60_000)
    })().finally(() => installs.delete(provider))
    installs.set(provider, pending)
    return pending
  })
}
