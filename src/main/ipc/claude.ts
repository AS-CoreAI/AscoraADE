import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type CodexCheckResult,
  type CodexRunResult,
  type ClaudePermissionMode,
  type ClaudeRunParams
} from '@shared/ipc'
import { getStore } from '../store'
import { checkClaude, killRun, runClaude } from '../claude/runner'

function readClaudeConfig(): {
  claudePath: string
  claudeModel: string
  claudePermission: ClaudePermissionMode
} {
  const store = getStore()
  return {
    claudePath: store.getSetting<string>('claude.path') ?? DEFAULT_LLM_CONFIG.claudePath,
    claudeModel: store.getSetting<string>('claude.model') ?? DEFAULT_LLM_CONFIG.claudeModel,
    claudePermission:
      store.getSetting<ClaudePermissionMode>('claude.permission') ?? DEFAULT_LLM_CONFIG.claudePermission
  }
}

export function registerClaudeHandlers(): void {
  ipcMain.handle(IPC.claude.check, (): Promise<CodexCheckResult> => checkClaude(readClaudeConfig().claudePath))

  ipcMain.handle(
    IPC.claude.run,
    (e, id: string, params: ClaudeRunParams): Promise<CodexRunResult> =>
      runClaude(id, e.sender, params, readClaudeConfig())
  )

  ipcMain.handle(IPC.claude.abort, (_e, id: string) => killRun(id))
}
