import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type CodexCheckResult,
  type CodexRunResult,
  type CopilotLoginResult,
  type GrokPermissionMode,
  type GrokReasoning,
  type GrokRunParams
} from '@shared/ipc'
import { getStore } from '../store'
import { checkGrok, killRun, logoutGrok, openGrokLogin, runGrok } from '../grok/runner'

function readGrokConfig(): {
  grokPath: string
  grokModel: string
  grokPermission: GrokPermissionMode
  grokReasoning: GrokReasoning | ''
} {
  const store = getStore()
  return {
    grokPath: store.getSetting<string>('grok.path') ?? DEFAULT_LLM_CONFIG.grokPath,
    grokModel: store.getSetting<string>('grok.model') ?? DEFAULT_LLM_CONFIG.grokModel,
    grokPermission:
      store.getSetting<GrokPermissionMode>('grok.permission') ?? DEFAULT_LLM_CONFIG.grokPermission,
    grokReasoning:
      store.getSetting<GrokReasoning | ''>('grok.reasoning') ?? DEFAULT_LLM_CONFIG.grokReasoning
  }
}

export function registerGrokHandlers(): void {
  ipcMain.handle(IPC.grok.check, (): Promise<CodexCheckResult> => checkGrok(readGrokConfig().grokPath))

  ipcMain.handle(IPC.grok.login, (): CopilotLoginResult => openGrokLogin(readGrokConfig().grokPath))

  ipcMain.handle(
    IPC.grok.logout,
    (): Promise<CopilotLoginResult> => logoutGrok(readGrokConfig().grokPath)
  )

  ipcMain.handle(
    IPC.grok.run,
    (e, id: string, params: GrokRunParams): Promise<CodexRunResult> =>
      runGrok(id, e.sender, params, readGrokConfig())
  )

  ipcMain.handle(IPC.grok.abort, (_e, id: string) => killRun(id))
}
