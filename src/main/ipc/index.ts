import { registerWindowHandlers } from './window'
import { registerDialogHandlers } from './dialog'
import { registerFsHandlers } from './fs'
import { registerSettingsHandlers } from './settings'
import { registerLlmHandlers } from './llm'
import { registerCodexHandlers } from './codex'
import { registerCopilotHandlers } from './copilot'
import { registerClaudeHandlers } from './claude'
import { registerGeminiHandlers } from './gemini'
import { registerGlmHandlers } from './glm'
import { registerWProviderHandlers } from './wprovider'
import { registerAnalyticsHandlers } from './analytics'
import { registerGitHandlers } from './git'
import { registerTerminalHandlers } from './terminal'
import { registerAgentHandlers } from './agent'
import { registerLiveHandlers } from './live'
import { registerSshHandlers } from './ssh'
import { registerUpdateHandlers } from './update'

/** Register every IPC handler. Called once after the app is ready. */
export function registerIpc(): void {
  registerWindowHandlers()
  registerDialogHandlers()
  registerFsHandlers()
  registerSettingsHandlers()
  registerLlmHandlers()
  registerCodexHandlers()
  registerCopilotHandlers()
  registerClaudeHandlers()
  registerGeminiHandlers()
  registerGlmHandlers()
  registerWProviderHandlers()
  registerAnalyticsHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerAgentHandlers()
  registerLiveHandlers()
  registerSshHandlers()
  registerUpdateHandlers()
}
