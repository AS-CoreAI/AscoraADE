import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  type ChatParams,
  type ChatResult,
  type CodexSandbox,
  type LlmConfig,
  type LlmProvider,
  type ListModelsResult
} from '@shared/ipc'
import { getStore } from '../store'
import { LmStudioClient, LmStudioError } from '../llm/client'

let client: LmStudioClient | null = null
/** In-flight chat requests, keyed by the renderer-supplied request id. */
const aborters = new Map<string, AbortController>()

function readConfig(): LlmConfig {
  const store = getStore()
  return {
    provider: store.getSetting<LlmProvider>('llm.provider') ?? DEFAULT_LLM_CONFIG.provider,
    baseUrl: store.getSetting<string>('llm.baseUrl') ?? DEFAULT_LLM_CONFIG.baseUrl,
    model: store.getSetting<string>('llm.model') ?? DEFAULT_LLM_CONFIG.model,
    codexPath: store.getSetting<string>('codex.path') ?? DEFAULT_LLM_CONFIG.codexPath,
    codexModel: store.getSetting<string>('codex.model') ?? DEFAULT_LLM_CONFIG.codexModel,
    codexSandbox: store.getSetting<CodexSandbox>('codex.sandbox') ?? DEFAULT_LLM_CONFIG.codexSandbox
  }
}

function getClient(): LmStudioClient {
  const config = readConfig()
  if (!client) client = new LmStudioClient(config)
  else client.update(config)
  return client
}

function errorMessage(err: unknown): string {
  if (err instanceof LmStudioError) return err.message
  return err instanceof Error ? err.message : String(err)
}

export function registerLlmHandlers(): void {
  ipcMain.handle(IPC.llm.config, (): LlmConfig => readConfig())

  ipcMain.handle(IPC.llm.setConfig, (_e, patch: Partial<LlmConfig>) => {
    const store = getStore()
    if (typeof patch.provider === 'string') store.setSetting('llm.provider', patch.provider)
    if (typeof patch.baseUrl === 'string') store.setSetting('llm.baseUrl', patch.baseUrl.trim())
    if (typeof patch.model === 'string') store.setSetting('llm.model', patch.model)
    if (typeof patch.codexPath === 'string') store.setSetting('codex.path', patch.codexPath.trim())
    if (typeof patch.codexModel === 'string') store.setSetting('codex.model', patch.codexModel.trim())
    if (typeof patch.codexSandbox === 'string') store.setSetting('codex.sandbox', patch.codexSandbox)
    getClient() // refresh the cached client with the new config
  })

  ipcMain.handle(IPC.llm.listModels, async (): Promise<ListModelsResult> => {
    try {
      const models = await getClient().listModels()
      return { ok: true, models }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle(
    IPC.llm.chat,
    async (e, id: string, params: ChatParams): Promise<ChatResult> => {
      const controller = new AbortController()
      aborters.set(id, controller)
      let content = ''
      try {
        // Iterate manually so we can read the generator's *return* value, which
        // carries the assembled native tool calls + finish reason.
        const gen = getClient().streamChat(params, controller.signal)
        for (;;) {
          const { value, done } = await gen.next()
          if (done) {
            return {
              ok: true,
              content,
              toolCalls: value.toolCalls,
              finishReason: value.finishReason
            }
          }
          content += value
          if (!e.sender.isDestroyed()) e.sender.send(IPC.llm.chunk, { id, delta: value })
        }
      } catch (err) {
        if (err instanceof LmStudioError && err.kind === 'aborted') {
          return { ok: true, content, aborted: true }
        }
        return { ok: false, content, error: errorMessage(err) }
      } finally {
        aborters.delete(id)
      }
    }
  )

  ipcMain.handle(IPC.llm.abort, (_e, id: string) => {
    aborters.get(id)?.abort()
  })
}
