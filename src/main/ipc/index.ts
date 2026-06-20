import { registerWindowHandlers } from './window'
import { registerDialogHandlers } from './dialog'
import { registerFsHandlers } from './fs'
import { registerSettingsHandlers } from './settings'
import { registerLlmHandlers } from './llm'
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
  registerGitHandlers()
  registerTerminalHandlers()
  registerAgentHandlers()
}
