import {
  GIGACHAT_BASE_URL,
  GIGACHAT_OAUTH_URL,
  normalizeGigachatAuthKey,
  normalizeOpenRouterApiKey,
  type ChatParams,
  type LlmConfig,
  type LlmMessage,
  type LlmModel,
  type LmStudioModelInfo,
  type LmStudioReasoning,
  type ToolCall,
  type ToolDef,
  type TokenUsage
} from '@shared/ipc'
import { normalizeUnslothApiKey, normalizeUnslothBaseUrl } from '@shared/unsloth'
import { Agent, fetch as undiciFetch, type RequestInit as ChatRequestInit, type Response as ChatResponse } from 'undici'
import type { ComputerSupport } from '@shared/computer'
import { randomUUID } from 'node:crypto'

/** What `streamChat` resolves to once the stream ends (its generator return). */
export interface StreamReturn {
  toolCalls: ToolCall[]
  finishReason?: string
  /** Token usage from the final stream frame, when the server reports it. */
  usage?: TokenUsage
  thinking?: string
  thinkingMs?: number
}

/** Partial tool_call fragment as it streams in (OpenAI delta shape). */
interface ToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// Local prefill can take arbitrarily long without sending response bytes.
// Only generation waits indefinitely; discovery/connect errors and Stop still
// work normally. Hosted routes retain their existing inactivity timeout.
const localChatDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
const chatDispatcher = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 })

// GigaChat (Sber) serves both its OAuth endpoint and its OpenAI-compatible API
// behind the Russian Trusted Root CA, which is not part of Node's default trust
// store. Verification is relaxed for these two Sber hosts only.
const gigachatDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
  headersTimeout: 30 * 60_000,
  bodyTimeout: 30 * 60_000
})

function gigachatFetch(url: string, init: ChatRequestInit): Promise<ChatResponse> {
  return undiciFetch(url, { ...init, dispatcher: gigachatDispatcher })
}

/** Cached GigaChat OAuth access token, keyed by the credentials it was minted for. */
let gigachatTokenCache: { key: string; token: string; expiresAt: number } | null = null

function chatFetch(url: string, init: ChatRequestInit, provider: LlmConfig['provider']): Promise<ChatResponse> {
  if (provider === 'gigachat') return gigachatFetch(url, init)
  const local = provider === 'lmstudio' || provider === 'ollama' || provider === 'unsloth'
  return undiciFetch(url, { ...init, dispatcher: local ? localChatDispatcher : chatDispatcher })
}

/** Parse an OpenAI-style JSON tool-call argument string into an object (or {}). */
function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** GigaChat's /v1 API predates OpenAI's tool protocol: it takes `functions` and
 *  answers with `message.function_call` (arguments as an object). Translate the
 *  shared OpenAI-shaped tool defs into that contract. */
function gigachatFunctions(tools: ToolDef[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters
  }))
}

/** Translate the shared OpenAI-shaped history into GigaChat's message shape:
 *  an assistant tool call becomes `function_call`, and a `tool` result becomes a
 *  `function` message named after the call it answers. */
function gigachatMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  const namesById = new Map<string, string>()
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      if (call.id) namesById.set(call.id, call.function.name)
    }
  }
  return messages.map((message) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const call = message.tool_calls[0]
      return {
        role: 'assistant',
        content: message.content,
        function_call: { name: call.function.name, arguments: parseArguments(call.function.arguments) }
      }
    }
    if (message.role === 'tool') {
      // GigaChat validates a function result as JSON and rejects raw text with
      // `422 INVALID_PARAMS: ... json string ..., error: JSON parse error`.
      // OpenAI's protocol carries the result as a plain string, so wrap it in a
      // JSON object before handing it back.
      return {
        role: 'function',
        name: namesById.get(message.tool_call_id ?? '') ?? '',
        content: JSON.stringify({ output: message.content })
      }
    }
    return { role: message.role, content: message.content }
  })
}

/** Some templates put a leading <think> block in content instead of a field. */
class ThinkingParser {
  private pending = ''
  private phase: 'start' | 'thinking' | 'answer' = 'start'
  private closing = '</think>'

  push(text: string, final = false): { content: string; thinking: string } {
    this.pending += text
    if (this.phase === 'start') {
      const start = this.pending.trimStart()
      const tag = ['<think>', '<analysis>'].find((opening) => start.startsWith(opening))
      if (tag) {
        this.closing = tag === '<think>' ? '</think>' : '</analysis>'
        this.pending = start.slice(tag.length)
        this.phase = 'thinking'
      } else if (!final && (!start || ['<think>', '<analysis>'].some((opening) => opening.startsWith(start)))) {
        return { content: '', thinking: '' }
      } else {
        this.phase = 'answer'
      }
    }
    if (this.phase === 'thinking') {
      const end = this.pending.indexOf(this.closing)
      if (end >= 0) {
        const thinking = this.pending.slice(0, end)
        const content = this.pending.slice(end + this.closing.length)
        this.pending = ''
        this.phase = 'answer'
        return { thinking, content }
      }
      // Hold only a possible split closing tag; stream the rest immediately.
      let keep = 0
      if (!final) {
        for (let n = 1; n < this.closing.length; n += 1) {
          if (this.pending.endsWith(this.closing.slice(0, n))) keep = n
        }
      }
      const thinking = this.pending.slice(0, this.pending.length - keep)
      this.pending = this.pending.slice(this.pending.length - keep)
      return { thinking, content: '' }
    }
    const content = this.pending
    this.pending = ''
    return { content, thinking: '' }
  }
}

/**
 * Minimal client for OpenAI-compatible backends (LM Studio, Ollama, Unsloth,
 * OpenRouter, and the bundled OmniRoute gateway).
 *
 *  - GET  {baseUrl}/models           → list available models
 *  - POST {baseUrl}/chat/completions → chat, with Server-Sent-Events streaming
 *
 * Connection / HTTP / parse failures are normalised to `LmStudioError` so the
 * UI can show something friendly instead of a raw stack trace.
 */

export type LmErrorKind = 'connection' | 'http' | 'parse' | 'aborted' | 'timeout'

export class LmStudioError extends Error {
  constructor(
    message: string,
    readonly kind: LmErrorKind,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LmStudioError'
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function providerName(config: LlmConfig): string {
  if (config.provider === 'unsloth') return 'Unsloth'
  if (config.provider === 'gigachat') return 'GigaChat'
  return config.provider === 'openrouter'
    ? 'OpenRouter'
    : config.provider === 'ollama'
      ? 'Ollama'
      : config.provider === 'omniroute'
        ? 'OmniRoute'
      : 'LM Studio'
}

function connectionError(name: string, url: string, err: unknown, signal?: AbortSignal, streaming = false): LmStudioError {
  if (signal?.aborted || isAbort(err)) return new LmStudioError('Request aborted', 'aborted')
  const code =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code
  const suffix = code ? ` (${code})` : ''
  if (code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new LmStudioError(
      `Timed out waiting for data from ${name}${suffix}. The model may still be processing the prompt. Reduce the context size or check the server logs and try again.`,
      'timeout'
    )
  }
  if (streaming) {
    return new LmStudioError(
      `The response stream from ${name} was interrupted${suffix}. Check the server logs and connection, then try again.`,
      'connection'
    )
  }
  return new LmStudioError(
    `Cannot reach ${name} at ${url}${suffix}. Check the connection settings and try again.`,
    'connection'
  )
}

async function httpError(name: string, url: string, res: Response | ChatResponse): Promise<LmStudioError> {
  if (name === 'Unsloth' && res.status === 401) {
    await res.body?.cancel()
    return new LmStudioError('Unsloth rejected the API key. Create a key in Unsloth Settings → API and save it in the Unsloth connection settings.', 'http', 401)
  }
  const text = await res.text().catch(() => '')
  let detail = text
  try {
    const json = JSON.parse(text)
    detail = json?.error?.message ?? json?.error ?? text
  } catch {
    /* not JSON */
  }
  if (name === 'OpenRouter' && res.status === 401 && /missing authentication header/i.test(detail)) {
    return new LmStudioError(
      'OpenRouter did not receive an Authorization header. Re-save the OpenRouter API key in Agent backend settings and try again.',
      'http',
      res.status
    )
  }
  const tail = detail ? ` — ${String(detail).slice(0, 300)}` : ''
  return new LmStudioError(`${name} responded ${res.status} for ${url}${tail}`, 'http', res.status)
}

export class LmStudioClient {
  constructor(private config: LlmConfig) {}

  update(patch: Partial<LlmConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  /** The loaded instance's window, not the model's theoretical maximum. */
  async contextLength(model: string, signal?: AbortSignal): Promise<number | null> {
    return (await this.modelInfo(model, signal))?.contextLength ?? null
  }

  async modelInfo(model: string, signal?: AbortSignal): Promise<LmStudioModelInfo | null> {
    const url = this.baseUrl.replace(/\/v1$/, '') + '/api/v1/models'
    try {
      const response = await fetch(url, { signal })
      if (!response.ok) return null
      const json = await response.json() as { models?: {
        key: string; loaded_instances?: { id: string; config?: { context_length?: number } }[]
        capabilities?: { reasoning?: { allowed_options?: string[]; default?: string } }
      }[] }
      const info = json.models?.find(item => item.key === model || item.loaded_instances?.some(instance => instance.id === model))
      if (!info) return null
      const instances = info.loaded_instances ?? []
      // A key with several differently configured instances is ambiguous. Do not
      // guess the first one's window or substitute the theoretical model maximum.
      const instance = instances.find(item => item.id === model) ?? (instances.length === 1 ? instances[0] : undefined)
      const length = instance?.config?.context_length
      const reasoning = info.capabilities?.reasoning
      const supported = ['off', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh']
      const options = [...new Set(reasoning?.allowed_options?.filter(value => supported.includes(value)) ?? [])] as LmStudioReasoning[]
      // Graded models already expose their enabled levels; a redundant "on"
      // cannot be represented faithfully by Chat Completions' effort enum.
      const graded = options.some(value => !['off', 'on'].includes(value))
      return {
        contextLength: typeof length === 'number' && Number.isSafeInteger(length) && length > 0 ? length : null,
        reasoningOptions: options.filter(value => value !== 'on' || !graded),
        reasoningDefault: supported.includes(reasoning?.default ?? '') ? reasoning!.default as LmStudioReasoning : undefined
      }
    } catch { return null }
  }

  async computerSupport(model: string, signal?: AbortSignal): Promise<ComputerSupport> {
    if (this.config.provider !== 'lmstudio') return { available: false, reason: 'provider' }
    try {
      const url = this.baseUrl.replace(/\/v1$/, '') + '/api/v1/models'
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`LM Studio returned HTTP ${response.status}`)
      const json = await response.json() as { models?: { key: string; type: string; loaded_instances?: { id: string }[]; capabilities?: { vision?: boolean; trained_for_tool_use?: boolean } }[] }
      const info = json.models?.find(item => item.key === model || item.loaded_instances?.some(instance => instance.id === model))
      if (!info?.capabilities) return { available: false, reason: 'unknown' }
      return { available: info.type === 'llm' && info.capabilities.vision === true && info.capabilities.trained_for_tool_use === true, reason: 'model' }
    } catch (error) {
      return { available: false, reason: 'unknown', error: error instanceof Error ? error.message : String(error) }
    }
  }

  get baseUrl(): string {
    if (this.config.provider === 'unsloth') return normalizeUnslothBaseUrl(this.config.unslothBaseUrl)
    if (this.config.provider === 'gigachat') return GIGACHAT_BASE_URL
    if (this.config.provider === 'openrouter') return OPENROUTER_BASE_URL
    if (this.config.provider === 'ollama') return stripTrailingSlash(this.config.ollamaBaseUrl)
    if (this.config.provider === 'omniroute') return stripTrailingSlash(this.config.omnirouteBaseUrl)
    return stripTrailingSlash(this.config.baseUrl)
  }

  private get providerName(): string {
    return providerName(this.config)
  }

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.config.provider === 'unsloth') {
      headers.Authorization = `Bearer ${normalizeUnslothApiKey(this.config.unslothApiKey)}`
    }
    if (this.config.provider === 'gigachat' && token) {
      headers.Authorization = `Bearer ${token}`
    }
    if (this.config.provider === 'openrouter') {
      const apiKey = normalizeOpenRouterApiKey(this.config.openRouterApiKey)
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`
      headers['HTTP-Referer'] = 'https://ade.ascoreai.com'
      headers['X-OpenRouter-Title'] = 'Ascora ADE'
    }
    return headers
  }

  private requireApiKey(): void {
    if (this.config.provider === 'unsloth' && !normalizeUnslothApiKey(this.config.unslothApiKey)) {
      throw new LmStudioError('Unsloth requires an API key. Create one in Unsloth Settings → API and save it in the Unsloth connection settings.', 'connection')
    }
    if (this.config.provider === 'gigachat' && !normalizeGigachatAuthKey(this.config.gigachatAuthKey)) {
      throw new LmStudioError('GigaChat requires an authorization key. Copy the "Authorization key" from the GigaChat developer cabinet and save it in the GigaChat connection settings.', 'connection')
    }
    if (this.config.provider !== 'openrouter') return
    if (!this.config.openRouterEnabled || !normalizeOpenRouterApiKey(this.config.openRouterApiKey)) {
      throw new LmStudioError('OpenRouter is not enabled or its API key is empty.', 'connection')
    }
  }

  /** Mint (or reuse) a GigaChat OAuth access token using the Basic-auth flow. */
  private async ensureGigachatToken(signal?: AbortSignal): Promise<string> {
    const authKey = normalizeGigachatAuthKey(this.config.gigachatAuthKey)
    const scope = this.config.gigachatScope.trim() || 'GIGACHAT_API_PERS'
    const key = `${authKey}|${scope}`
    const cached = gigachatTokenCache
    if (cached && cached.key === key && cached.expiresAt - Date.now() > 30_000) return cached.token
    let res: ChatResponse
    try {
      res = await gigachatFetch(GIGACHAT_OAUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          RqUID: randomUUID(),
          Authorization: `Basic ${authKey}`
        },
        body: new URLSearchParams({ scope }).toString(),
        signal
      })
    } catch (err) {
      throw connectionError('GigaChat', GIGACHAT_OAUTH_URL, err, signal)
    }
    if (!res.ok) throw await httpError('GigaChat', GIGACHAT_OAUTH_URL, res)
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_at?: number }
    if (!json.access_token) {
      throw new LmStudioError('GigaChat did not return an access token. Check the authorization key and scope, then try again.', 'parse')
    }
    const expiresAt = typeof json.expires_at === 'number' && json.expires_at > Date.now()
      ? json.expires_at
      : Date.now() + 25 * 60_000
    gigachatTokenCache = { key, token: json.access_token, expiresAt }
    return json.access_token
  }

  private requireOmniroute(): void {
    if (this.config.provider === 'omniroute' && !this.config.omnirouteBaseUrl) {
      throw new LmStudioError(
        'OmniRoute is not running yet. Start it in Agent backend settings and try again.',
        'connection'
      )
    }
  }

  private model(params: ChatParams): string {
    if (params.model) return params.model
    if (this.config.provider === 'unsloth') {
      if (!this.config.unslothModel) throw new LmStudioError('Load a model in Unsloth, then refresh the model list in connection settings.', 'connection')
      return this.config.unslothModel
    }
    if (this.config.provider === 'gigachat') return this.config.gigachatModel || 'GigaChat-2'
    if (this.config.provider === 'openrouter') return this.config.openRouterModel || 'openrouter/free'
    if (this.config.provider === 'ollama') return this.config.ollamaModel
    if (this.config.provider === 'omniroute') return this.config.omnirouteModel || 'auto'
    return this.config.model
  }

  /** GET /models — never throws for empty lists, only for real failures. */
  async listModels(signal?: AbortSignal): Promise<LlmModel[]> {
    this.requireApiKey()
    this.requireOmniroute()
    const name = this.providerName
    const url = `${this.baseUrl}/models`
    const token = this.config.provider === 'gigachat' ? await this.ensureGigachatToken(signal) : undefined
    let res: Response | ChatResponse
    try {
      res = this.config.provider === 'gigachat'
        ? await gigachatFetch(url, { headers: this.headers(token), signal })
        : await fetch(url, { headers: this.headers(), signal })
    } catch (err) {
      throw connectionError(name, url, err)
    }
    if (!res.ok) throw await httpError(name, url, res)
    let json: { data?: { id: string }[] }
    try {
      json = (await res.json()) as { data?: { id: string }[] }
    } catch (err) {
      throw new LmStudioError(`Could not parse model list from ${name}: ${String(err)}`, 'parse')
    }
    return (json.data ?? []).map((m) => ({ id: m.id }))
  }

  /**
   * POST /chat/completions with stream:true, yielding content deltas as they
   * arrive. Native tool calls (`delta.tool_calls`) are assembled across frames
   * and returned as the generator's *return value* alongside the finish reason.
   * Throws `LmStudioError` (kind 'aborted' when cancelled via signal).
   */
  async *streamChat(
    params: ChatParams,
    signal?: AbortSignal,
    onThinking?: (delta: string) => void
  ): AsyncGenerator<string, StreamReturn> {
    this.requireApiKey()
    this.requireOmniroute()
    const name = this.providerName
    const url = `${this.baseUrl}/chat/completions`
    const reasoning = params.reasoning ?? this.config.lmStudioReasoning
    const isGigachat = this.config.provider === 'gigachat'
    const withTools = !!params.tools && params.tools.length > 0
    const token = isGigachat ? await this.ensureGigachatToken(signal) : undefined
    const basePayload: Record<string, unknown> = {
      model: this.model(params),
      messages: isGigachat
        ? gigachatMessages(params.messages)
        : params.messages.map(({ images, ...message }) => images?.length
          ? { ...message, content: [
              { type: 'text', text: message.content },
              ...images.map(url => ({ type: 'image_url', image_url: { url } }))
            ] }
          : message),
      temperature: params.temperature ?? 0.7,
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      // LM Studio's native model metadata says off/on; its OpenAI endpoint
      // accepts none/high for toggle models, and the named levels otherwise.
      ...(this.config.provider === 'lmstudio' && reasoning
        ? { reasoning_effort: reasoning === 'off' ? 'none' : reasoning === 'on' ? 'high' : reasoning } : {}),
      // GigaChat predates OpenAI's tool protocol and takes `functions` +
      // `function_call`; every other backend uses the `tools` array.
      ...(withTools
        ? isGigachat
          ? { functions: gigachatFunctions(params.tools ?? []), function_call: 'auto' }
          : { tools: params.tools }
        : {})
    }
    const body = JSON.stringify({
      ...basePayload,
      stream: true,
      // Ask OpenAI-compatible servers to append a final usage frame.
      ...(this.config.provider === 'openrouter' || this.config.provider === 'gigachat' ? {} : { stream_options: { include_usage: true } })
    })

    let res: ChatResponse
    try {
      res = await chatFetch(url, {
        method: 'POST',
        headers: this.headers(token),
        body,
        signal
      }, this.config.provider)
    } catch (err) {
      throw connectionError(name, url, err, signal)
    }
    // Some Unsloth GGUF templates accept text but reject even the presence of
    // native tools. Retry only that explicit rejection, before any generation,
    // using Ascora's existing text-tool protocol. Never discard tool history.
    if (this.config.provider === 'unsloth' && res.status === 400 && params.tools?.length &&
        !params.messages.some((message) => message.role === 'tool' || message.tool_calls?.length)) {
      const error = await httpError(name, url, res)
      if (!/does not advertise tools|does not support (?:native )?tool/i.test(error.message)) throw error
      delete basePayload.tools
      try {
        res = await chatFetch(url, {
          method: 'POST', headers: this.headers(token), signal,
          body: JSON.stringify({ ...basePayload, stream: true, stream_options: { include_usage: true } })
        }, this.config.provider)
      } catch (err) { throw connectionError(name, url, err, signal) }
    }
    // Some GigaChat models (and older accounts) reject a request that carries
    // `functions` with a validation error. Retry once without them, before any
    // generation, so plain chat keeps working; the text-tool protocol still
    // lets the agent request tools.
    if (isGigachat && withTools && (res.status === 400 || res.status === 422) &&
        !params.messages.some((message) => message.role === 'tool' || message.tool_calls?.length)) {
      const error = await httpError(name, url, res)
      if (!/function/i.test(error.message)) throw error
      delete basePayload.functions
      delete basePayload.function_call
      try {
        res = await chatFetch(url, {
          method: 'POST', headers: this.headers(token), signal,
          body: JSON.stringify({ ...basePayload, stream: true })
        }, this.config.provider)
      } catch (err) { throw connectionError(name, url, err, signal) }
    }
    if (!res.ok) throw await httpError(name, url, res)

    if (!res.body) throw new LmStudioError(`${name} returned an empty response body`, 'parse')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // Tool calls stream in fragments keyed by index; assemble them in order.
    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>()
    let finishReason: string | undefined
    let usage: TokenUsage | undefined
    let yielded = false
    let streamDone = false
    const thinkingParser = new ThinkingParser()
    let thinking = ''
    let thinkingStartedAt: number | undefined
    let thinkingUpdatedAt: number | undefined
    const addThinking = (delta: string): void => {
      if (!delta) return
      thinkingStartedAt ??= Date.now()
      thinkingUpdatedAt = Date.now()
      thinking += delta
      onThinking?.(delta)
    }

    const assembled = (): StreamReturn => ({
      toolCalls: [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, t]) => ({ id: t.id, name: t.name, arguments: t.arguments }))
        .filter((t) => t.name),
      finishReason,
      usage,
      ...(thinking ? { thinking, thinkingMs: thinkingUpdatedAt! - thinkingStartedAt! } : {})
    })

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') { streamDone = true; break }
          try {
            const json = JSON.parse(data)
            const choice = json?.choices?.[0]
            const reasoning: unknown = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
            if (typeof reasoning === 'string') addThinking(reasoning)
            const content: unknown = choice?.delta?.content
            if (typeof content === 'string' && content.length > 0) {
              const parsed = thinkingParser.push(content)
              addThinking(parsed.thinking)
              if (parsed.content) { yielded = true; yield parsed.content }
            }

            const calls: unknown = choice?.delta?.tool_calls
            if (Array.isArray(calls)) {
              for (const raw of calls as ToolCallDelta[]) {
                const idx = raw.index ?? 0
                const entry = toolAcc.get(idx) ?? { id: '', name: '', arguments: '' }
                if (raw.id) entry.id = raw.id
                if (raw.function?.name) entry.name = raw.function.name
                if (raw.function?.arguments) entry.arguments += raw.function.arguments
                toolAcc.set(idx, entry)
              }
            }
            // GigaChat streams its tool decision as `delta.function_call`, with
            // arguments delivered as a whole object (not incremental string
            // fragments like OpenAI), so replace rather than append for those.
            const fnCall = choice?.delta?.function_call
            if (fnCall && typeof fnCall === 'object') {
              const raw = fnCall as { name?: unknown; arguments?: unknown }
              const entry = toolAcc.get(0) ?? { id: '', name: '', arguments: '' }
              if (typeof raw.name === 'string' && raw.name) entry.name = raw.name
              if (typeof raw.arguments === 'string') entry.arguments += raw.arguments
              else if (raw.arguments !== undefined) entry.arguments = JSON.stringify(raw.arguments)
              toolAcc.set(0, entry)
            }

            if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason

            const rawUsage = json?.usage as
              | { prompt_tokens?: number; completion_tokens?: number }
              | undefined
            if (rawUsage && typeof rawUsage === 'object') {
              usage = {
                inputTokens: rawUsage.prompt_tokens ?? 0,
                outputTokens: rawUsage.completion_tokens ?? 0
              }
            }
          } catch {
            /* keep-alive or partial frame — ignore */
          }
        }
        if (streamDone) break
      }
    } catch (err) {
      throw connectionError(name, url, err, signal, true)
    } finally {
      // [DONE] can arrive before the socket closes. Release the connection even
      // on cancellation or if a consumer stops iterating the generator early.
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const tail = thinkingParser.push('', true)
    addThinking(tail.thinking)
    if (tail.content) { yielded = true; yield tail.content }

    // OmniRoute routes some web/free providers that ignore `stream: true` and
    // return an empty SSE stream even though a non-streaming request answers
    // (the native Playground uses stream:false and works). Fall back once so the
    // chat turn isn't a blank "(no content returned)". Scoped to OmniRoute only.
    if (this.config.provider === 'omniroute' && !yielded && !thinking && toolAcc.size === 0) {
      try {
        const fbRes = await chatFetch(url, {
          method: 'POST',
          headers: this.headers(token),
          body: JSON.stringify({ ...basePayload, stream: false }),
          signal
        }, this.config.provider)
        if (fbRes.ok) {
          const fbJson = (await fbRes.json()) as {
            choices?: { message?: { content?: unknown }; finish_reason?: string }[]
            usage?: { prompt_tokens?: number; completion_tokens?: number }
          }
          const fbChoice = fbJson?.choices?.[0]
          let fbContent: unknown = fbChoice?.message?.content
          if (Array.isArray(fbContent)) {
            fbContent = fbContent
              .map((part) => (part && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
              .join('')
          }
          if (typeof fbContent === 'string' && fbContent.length > 0) yield fbContent
          if (typeof fbChoice?.finish_reason === 'string') finishReason = fbChoice.finish_reason
          if (fbJson?.usage && typeof fbJson.usage === 'object') {
            usage = { inputTokens: fbJson.usage.prompt_tokens ?? 0, outputTokens: fbJson.usage.completion_tokens ?? 0 }
          }
        }
      } catch (err) {
        if (isAbort(err)) throw new LmStudioError('Request aborted', 'aborted')
        // Fallback failed — return whatever the stream produced.
      }
    }

    return assembled()
  }
}
