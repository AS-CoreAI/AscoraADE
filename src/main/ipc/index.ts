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
import { registerOmnirouteHandlers } from './omniroute'
import { registerAnalyticsHandlers } from './analytics'
import { registerGitHandlers } from './git'
import { registerTerminalHandlers } from './terminal'
import { registerAgentHandlers } from './agent'
import { registerWebHandlers } from './web'
import { registerLiveHandlers } from './live'
import { registerSshHandlers } from './ssh'
import { registerUpdateHandlers } from './update'
import { registerBlueprintHandlers } from './blueprint'
import { registerNetworkVpnHandlers } from './network-vpn'

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
  registerOmnirouteHandlers()
  registerBlueprintHandlers()
  registerAnalyticsHandlers()
  registerGitHandlers()
  registerTerminalHandlers()
  registerAgentHandlers()
  registerWebHandlers()
  registerLiveHandlers()
  registerSshHandlers()
  registerUpdateHandlers()
  registerNetworkVpnHandlers()
}
