import { registerWindowHandlers } from './window'
import { registerDialogHandlers } from './dialog'
import { registerFsHandlers } from './fs'
import { registerSettingsHandlers } from './settings'
import { registerLlmHandlers } from './llm'
import { registerCodexHandlers } from './codex'
import { registerClaudeHandlers } from './claude'
import { registerGlmHandlers } from './glm'
import { registerAnalyticsHandlers } from './analytics'
import { registerGitHandlers } from './git'
import { registerTerminalHandlers } from './terminal'
import { registerAgentHandlers } from './agent'
import { registerLiveHandlers } from './live'

/** Register every IPC handler. Called once after the app is ready. */
export function registerIpc(): void {
  registerWindowHandlers()
  registerDialogHandlers()
  registerFsHandlers()
  registerSettingsHandlers()
  registerLlmHandlers()
  registerCodexHandlers()
  registerClaudeHandlers()
  registerGlmHandlers()
  registerAnalyticsHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerAgentHandlers()
  registerLiveHandlers()
}
