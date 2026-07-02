import { ipcMain } from 'electron'
import {
  IPC,
  DEFAULT_LLM_CONFIG,
  normalizeOpenRouterApiKey,
  type ChatParams,
  type ChatResult,
  type ClaudePermissionMode,
  type CopilotPermissionMode,
  type CopilotReasoning,
  type GeminiApprovalMode,
  type CodexReasoning,
  type CodexSandbox,
  type GlmMode,
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
  const openRouterEnabled =
    store.getSetting<boolean>('openrouter.enabled') ?? DEFAULT_LLM_CONFIG.openRouterEnabled
  const openRouterApiKey =
    normalizeOpenRouterApiKey(
      store.getSetting<string>('openrouter.apiKey') ?? DEFAULT_LLM_CONFIG.openRouterApiKey
    )
  const savedProvider = store.getSetting<LlmProvider>('llm.provider') ?? DEFAULT_LLM_CONFIG.provider
  const provider =
    savedProvider === 'openrouter' && (!openRouterEnabled || !openRouterApiKey.trim())
      ? DEFAULT_LLM_CONFIG.provider
      : savedProvider
  return {
    provider,
    baseUrl: store.getSetting<string>('llm.baseUrl') ?? DEFAULT_LLM_CONFIG.baseUrl,
    model: store.getSetting<string>('llm.model') ?? DEFAULT_LLM_CONFIG.model,
    ollamaBaseUrl:
      store.getSetting<string>('ollama.baseUrl') ?? DEFAULT_LLM_CONFIG.ollamaBaseUrl,
    ollamaModel: store.getSetting<string>('ollama.model') ?? DEFAULT_LLM_CONFIG.ollamaModel,
    openRouterEnabled,
    openRouterApiKey,
    openRouterModel:
      store.getSetting<string>('openrouter.model') ?? DEFAULT_LLM_CONFIG.openRouterModel,
    codexPath: store.getSetting<string>('codex.path') ?? DEFAULT_LLM_CONFIG.codexPath,
    codexModel: store.getSetting<string>('codex.model') ?? DEFAULT_LLM_CONFIG.codexModel,
    codexSandbox: store.getSetting<CodexSandbox>('codex.sandbox') ?? DEFAULT_LLM_CONFIG.codexSandbox,
    codexReasoning:
      store.getSetting<CodexReasoning | ''>('codex.reasoning') ?? DEFAULT_LLM_CONFIG.codexReasoning,
    copilotPath: store.getSetting<string>('copilot.path') ?? DEFAULT_LLM_CONFIG.copilotPath,
    copilotModel: store.getSetting<string>('copilot.model') ?? DEFAULT_LLM_CONFIG.copilotModel,
    copilotPermission:
      store.getSetting<CopilotPermissionMode>('copilot.permission') ?? DEFAULT_LLM_CONFIG.copilotPermission,
    copilotReasoning:
      store.getSetting<CopilotReasoning | ''>('copilot.reasoning') ?? DEFAULT_LLM_CONFIG.copilotReasoning,
    claudePath: store.getSetting<string>('claude.path') ?? DEFAULT_LLM_CONFIG.claudePath,
    claudeModel: store.getSetting<string>('claude.model') ?? DEFAULT_LLM_CONFIG.claudeModel,
    claudePermission:
      store.getSetting<ClaudePermissionMode>('claude.permission') ?? DEFAULT_LLM_CONFIG.claudePermission,
    geminiPath: store.getSetting<string>('gemini.path') ?? DEFAULT_LLM_CONFIG.geminiPath,
    geminiModel: store.getSetting<string>('gemini.model') ?? DEFAULT_LLM_CONFIG.geminiModel,
    geminiPermission:
      store.getSetting<GeminiApprovalMode>('gemini.permission') ?? DEFAULT_LLM_CONFIG.geminiPermission,
    glmPath: store.getSetting<string>('glm.path') ?? DEFAULT_LLM_CONFIG.glmPath,
    glmMode: store.getSetting<GlmMode>('glm.mode') ?? DEFAULT_LLM_CONFIG.glmMode
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
    if (typeof patch.ollamaBaseUrl === 'string') {
      store.setSetting('ollama.baseUrl', patch.ollamaBaseUrl.trim())
    }
    if (typeof patch.ollamaModel === 'string') store.setSetting('ollama.model', patch.ollamaModel.trim())
    if (typeof patch.openRouterEnabled === 'boolean') {
      store.setSetting('openrouter.enabled', patch.openRouterEnabled)
    }
    if (typeof patch.openRouterApiKey === 'string') {
      store.setSetting('openrouter.apiKey', normalizeOpenRouterApiKey(patch.openRouterApiKey))
    }
    if (typeof patch.openRouterModel === 'string') {
      store.setSetting('openrouter.model', patch.openRouterModel.trim())
    }
    if (typeof patch.codexPath === 'string') store.setSetting('codex.path', patch.codexPath.trim())
    if (typeof patch.codexModel === 'string') store.setSetting('codex.model', patch.codexModel.trim())
    if (typeof patch.codexSandbox === 'string') store.setSetting('codex.sandbox', patch.codexSandbox)
    if (typeof patch.codexReasoning === 'string') store.setSetting('codex.reasoning', patch.codexReasoning)
    if (typeof patch.copilotPath === 'string') store.setSetting('copilot.path', patch.copilotPath.trim())
    if (typeof patch.copilotModel === 'string') store.setSetting('copilot.model', patch.copilotModel.trim())
    if (typeof patch.copilotPermission === 'string') store.setSetting('copilot.permission', patch.copilotPermission)
    if (typeof patch.copilotReasoning === 'string') store.setSetting('copilot.reasoning', patch.copilotReasoning)
    if (typeof patch.claudePath === 'string') store.setSetting('claude.path', patch.claudePath.trim())
    if (typeof patch.claudeModel === 'string') store.setSetting('claude.model', patch.claudeModel.trim())
    if (typeof patch.claudePermission === 'string') store.setSetting('claude.permission', patch.claudePermission)
    if (typeof patch.geminiPath === 'string') store.setSetting('gemini.path', patch.geminiPath.trim())
    if (typeof patch.geminiModel === 'string') store.setSetting('gemini.model', patch.geminiModel.trim())
    if (typeof patch.geminiPermission === 'string') store.setSetting('gemini.permission', patch.geminiPermission)
    if (typeof patch.glmPath === 'string') store.setSetting('glm.path', patch.glmPath.trim())
    if (typeof patch.glmMode === 'string') store.setSetting('glm.mode', patch.glmMode)
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

  // Probe LM Studio specifically (provider forced) so the renderer can tell
  // whether the local server is up even while another backend is active. Uses a
  // throwaway client and a short timeout so a down server fails fast.
  ipcMain.handle(IPC.llm.checkLmStudio, async (): Promise<boolean> => {
    const probe = new LmStudioClient({ ...readConfig(), provider: 'lmstudio' })
    try {
      await probe.listModels(AbortSignal.timeout(2500))
      return true
    } catch {
      return false
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
              finishReason: value.finishReason,
              usage: value.usage
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
