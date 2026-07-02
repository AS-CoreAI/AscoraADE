import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type CodexCheckResult,
  type CodexRunResult,
  type GeminiApprovalMode,
  type GeminiRunParams
} from '@shared/ipc'
import { getStore } from '../store'
import { checkGemini, killRun, runGemini } from '../gemini/runner'

function readGeminiConfig(): {
  geminiPath: string
  geminiModel: string
  geminiPermission: GeminiApprovalMode
} {
  const store = getStore()
  return {
    geminiPath: store.getSetting<string>('gemini.path') ?? DEFAULT_LLM_CONFIG.geminiPath,
    geminiModel: store.getSetting<string>('gemini.model') ?? DEFAULT_LLM_CONFIG.geminiModel,
    geminiPermission:
      store.getSetting<GeminiApprovalMode>('gemini.permission') ?? DEFAULT_LLM_CONFIG.geminiPermission
  }
}

export function registerGeminiHandlers(): void {
  ipcMain.handle(IPC.gemini.check, (): Promise<CodexCheckResult> =>
    checkGemini(readGeminiConfig().geminiPath)
  )

  ipcMain.handle(
    IPC.gemini.run,
    (e, id: string, params: GeminiRunParams): Promise<CodexRunResult> =>
      runGemini(id, e.sender, params, readGeminiConfig())
  )

  ipcMain.handle(IPC.gemini.abort, (_e, id: string) => killRun(id))
}
