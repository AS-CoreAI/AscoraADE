import { registerWindowHandlers } from './window'
import { registerDialogHandlers } from './dialog'
import { registerFsHandlers } from './fs'
import { registerSettingsHandlers } from './settings'
import { registerLlmHandlers } from './llm'
import { registerCodexHandlers } from './codex'
import { registerGitHandlers } from './git'
import { registerTerminalHandlers } from './terminal'
import { registerAgentHandlers } from './agent'

/** Register every IPC handler. Called once after the app is ready. */
export function registerIpc(): void {
  registerWindowHandlers()
  registerDialogHandlers()
  registerFsHandlers()
  registerSettingsHandlers()
  registerLlmHandlers()
  registerCodexHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerAgentHandlers()
}
