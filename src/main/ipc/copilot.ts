import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type CodexCheckResult,
  type CodexRunResult,
  type CopilotLoginResult,
  type CopilotPermissionMode,
  type CopilotReasoning,
  type CopilotRunParams
} from '@shared/ipc'
import { getStore } from '../store'
import { checkCopilot, killRun, openCopilotLogin, runCopilot } from '../copilot/runner'

function readCopilotConfig(): {
  copilotPath: string
  copilotModel: string
  copilotPermission: CopilotPermissionMode
  copilotReasoning: CopilotReasoning | ''
} {
  const store = getStore()
  return {
    copilotPath: store.getSetting<string>('copilot.path') ?? DEFAULT_LLM_CONFIG.copilotPath,
    copilotModel: store.getSetting<string>('copilot.model') ?? DEFAULT_LLM_CONFIG.copilotModel,
    copilotPermission:
      store.getSetting<CopilotPermissionMode>('copilot.permission') ?? DEFAULT_LLM_CONFIG.copilotPermission,
    copilotReasoning:
      store.getSetting<CopilotReasoning | ''>('copilot.reasoning') ?? DEFAULT_LLM_CONFIG.copilotReasoning
  }
}

export function registerCopilotHandlers(): void {
  ipcMain.handle(IPC.copilot.check, (_e, verifyAuth = false): Promise<CodexCheckResult> =>
    checkCopilot(readCopilotConfig().copilotPath, verifyAuth)
  )

  ipcMain.handle(IPC.copilot.login, (): CopilotLoginResult =>
    openCopilotLogin(readCopilotConfig().copilotPath)
  )

  ipcMain.handle(
    IPC.copilot.run,
    (e, id: string, params: CopilotRunParams): Promise<CodexRunResult> =>
      runCopilot(id, e.sender, params, readCopilotConfig())
  )

  ipcMain.handle(IPC.copilot.abort, (_e, id: string) => killRun(id))
}
