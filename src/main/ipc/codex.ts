import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type CodexCheckResult,
  type CodexReasoning,
  type CodexRunParams,
  type CodexRunResult,
  type CodexSandbox,
  type CodexUsageResult,
  type CopilotLoginResult
} from '@shared/ipc'
import { getStore } from '../store'
import { checkCodex, killRun, logoutCodex, openCodexLogin, runCodex } from '../codex/runner'
import { fetchCodexUsage } from '../codex/usage'

function readCodexConfig(): {
  codexPath: string
  codexModel: string
  codexSandbox: CodexSandbox
  codexReasoning: CodexReasoning | ''
} {
  const store = getStore()
  return {
    codexPath: store.getSetting<string>('codex.path') ?? DEFAULT_LLM_CONFIG.codexPath,
    codexModel: store.getSetting<string>('codex.model') ?? DEFAULT_LLM_CONFIG.codexModel,
    codexSandbox: store.getSetting<CodexSandbox>('codex.sandbox') ?? DEFAULT_LLM_CONFIG.codexSandbox,
    codexReasoning:
      store.getSetting<CodexReasoning | ''>('codex.reasoning') ?? DEFAULT_LLM_CONFIG.codexReasoning
  }
}

export function registerCodexHandlers(): void {
  ipcMain.handle(IPC.codex.check, (): Promise<CodexCheckResult> => checkCodex(readCodexConfig().codexPath))

  ipcMain.handle(IPC.codex.login, (): CopilotLoginResult => openCodexLogin(readCodexConfig().codexPath))

  ipcMain.handle(IPC.codex.logout, (): Promise<CopilotLoginResult> => logoutCodex(readCodexConfig().codexPath))

  ipcMain.handle(
    IPC.codex.run,
    (e, id: string, params: CodexRunParams): Promise<CodexRunResult> =>
      runCodex(id, e.sender, params, readCodexConfig())
  )

  ipcMain.handle(IPC.codex.abort, (_e, id: string) => killRun(id))

  ipcMain.handle(IPC.codex.usage, (): Promise<CodexUsageResult> => fetchCodexUsage(readCodexConfig().codexPath))
}
