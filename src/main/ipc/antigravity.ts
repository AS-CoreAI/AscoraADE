import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type AntigravityModel,
  type AntigravityRunParams,
  type CodexCheckResult,
  type CodexRunResult
} from '@shared/ipc'
import { getStore } from '../store'
import { checkAntigravity, killRun, runAntigravity } from '../antigravity/runner'

function readAntigravityConfig(): { antigravityPath: string; antigravityModel: AntigravityModel } {
  const store = getStore()
  return {
    antigravityPath: store.getSetting<string>('antigravity.path') ?? DEFAULT_LLM_CONFIG.antigravityPath,
    antigravityModel:
      store.getSetting<AntigravityModel>('antigravity.model') ?? DEFAULT_LLM_CONFIG.antigravityModel
  }
}

export function registerAntigravityHandlers(): void {
  ipcMain.handle(IPC.antigravity.check, (): Promise<CodexCheckResult> =>
    checkAntigravity(readAntigravityConfig().antigravityPath)
  )

  ipcMain.handle(
    IPC.antigravity.run,
    (e, id: string, params: AntigravityRunParams): Promise<CodexRunResult> =>
      runAntigravity(id, e.sender, params, readAntigravityConfig())
  )

  ipcMain.handle(IPC.antigravity.abort, (_e, id: string) => killRun(id))
}

