import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  WPROVIDER_SERVICES,
  type ChatResult,
  type WProviderChatParams,
  type WProviderCheckResult,
  type WProviderLoginResult,
  type WProviderService
} from '@shared/ipc'
import { getStore } from '../store'
import {
  abortWProvider,
  chatWProvider,
  checkWProvider,
  loginWProvider,
  logoutWProvider
} from '../wprovider/runner'

/** The configured WProvider web service. */
function configuredService(): WProviderService {
  const saved = getStore().getSetting<WProviderService>('wprovider.service')
  return saved && WPROVIDER_SERVICES.includes(saved) ? saved : DEFAULT_LLM_CONFIG.wproviderService
}

export function registerWProviderHandlers(): void {
  ipcMain.handle(
    IPC.wprovider.check,
    (_e, service?: WProviderService): Promise<WProviderCheckResult> =>
      checkWProvider(service && WPROVIDER_SERVICES.includes(service) ? service : configuredService())
  )
  ipcMain.handle(IPC.wprovider.login, (): Promise<WProviderLoginResult> =>
    loginWProvider(configuredService())
  )
  ipcMain.handle(IPC.wprovider.logout, (): Promise<WProviderCheckResult> =>
    logoutWProvider(configuredService())
  )
  ipcMain.handle(
    IPC.wprovider.chat,
    (e, id: string, params: WProviderChatParams): Promise<ChatResult> =>
      chatWProvider(id, configuredService(), params, e.sender)
  )
  ipcMain.handle(IPC.wprovider.abort, (_e, id: string): void => abortWProvider(id))
}
