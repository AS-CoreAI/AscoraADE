import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type CodexCheckResult,
  type CodexRunResult,
  type GlmCaptchaConfigResult,
  type GlmMode,
  type GlmRunParams
} from '@shared/ipc'
import { getStore } from '../store'
import { checkGlm, getGlmCaptchaConfig, killRun, runGlm } from '../glm/runner'

function readGlmConfig(): { glmPath: string; glmMode: GlmMode } {
  const store = getStore()
  return {
    glmPath: store.getSetting<string>('glm.path') ?? DEFAULT_LLM_CONFIG.glmPath,
    glmMode: store.getSetting<GlmMode>('glm.mode') ?? DEFAULT_LLM_CONFIG.glmMode
  }
}

export function registerGlmHandlers(): void {
  ipcMain.handle(IPC.glm.check, (): Promise<CodexCheckResult> => checkGlm(readGlmConfig().glmPath))

  ipcMain.handle(
    IPC.glm.captchaConfig,
    (): Promise<GlmCaptchaConfigResult> => getGlmCaptchaConfig(readGlmConfig().glmPath)
  )

  ipcMain.handle(
    IPC.glm.run,
    (e, id: string, params: GlmRunParams): Promise<CodexRunResult> =>
      runGlm(id, e.sender, params, readGlmConfig())
  )

  ipcMain.handle(IPC.glm.abort, (_e, id: string) => killRun(id))
}
