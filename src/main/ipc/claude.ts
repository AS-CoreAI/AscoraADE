import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type CodexCheckResult,
  type CodexRunResult,
  type ClaudeEffort,
  type ClaudePermissionMode,
  type ClaudeRunParams,
  type ClaudeUsageResult,
  type CopilotLoginResult
} from '@shared/ipc'
import { getStore } from '../store'
import { checkClaude, killRun, logoutClaude, openClaudeLogin, runClaude } from '../claude/runner'
import { fetchClaudeUsage } from '../claude/usage'

function readClaudeConfig(): {
  claudePath: string
  claudeModel: string
  claudePermission: ClaudePermissionMode
  claudeEffort: ClaudeEffort | ''
  claudeThinking: boolean
} {
  const store = getStore()
  return {
    claudePath: store.getSetting<string>('claude.path') ?? DEFAULT_LLM_CONFIG.claudePath,
    claudeModel: store.getSetting<string>('claude.model') ?? DEFAULT_LLM_CONFIG.claudeModel,
    claudePermission:
      store.getSetting<ClaudePermissionMode>('claude.permission') ?? DEFAULT_LLM_CONFIG.claudePermission,
    claudeEffort: store.getSetting<ClaudeEffort | ''>('claude.effort') ?? DEFAULT_LLM_CONFIG.claudeEffort,
    claudeThinking: store.getSetting<boolean>('claude.thinking') ?? DEFAULT_LLM_CONFIG.claudeThinking
  }
}

export function registerClaudeHandlers(): void {
  ipcMain.handle(IPC.claude.check, (): Promise<CodexCheckResult> => checkClaude(readClaudeConfig().claudePath))

  ipcMain.handle(IPC.claude.login, (): CopilotLoginResult => openClaudeLogin(readClaudeConfig().claudePath))

  ipcMain.handle(IPC.claude.logout, (): CopilotLoginResult => logoutClaude())

  ipcMain.handle(
    IPC.claude.run,
    (e, id: string, params: ClaudeRunParams): Promise<CodexRunResult> =>
      runClaude(id, e.sender, params, readClaudeConfig())
  )

  ipcMain.handle(IPC.claude.abort, (_e, id: string) => killRun(id))

  ipcMain.handle(IPC.claude.usage, (): Promise<ClaudeUsageResult> => fetchClaudeUsage())
}
