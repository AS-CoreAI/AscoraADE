import {
  normalizeOpenRouterApiKey,
  type ChatParams,
  type LlmConfig,
  type LlmModel,
  type LmStudioModelInfo,
  type LmStudioReasoning,
  type ToolCall,
  type TokenUsage
} from '@shared/ipc'
import { normalizeUnslothApiKey, normalizeUnslothBaseUrl } from '@shared/unsloth'
import { Agent, fetch as undiciFetch, type RequestInit as ChatRequestInit, type Response as ChatResponse } from 'undici'
import type { ComputerSupport } from '@shared/computer'

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

// Local prefill/reasoning can be silent for longer than Undici's 5-minute
// defaults. Apply a 30-minute inactivity limit only to generation requests;
// model discovery keeps its short timeout and Stop still aborts immediately.
const chatDispatcher = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 })

function chatFetch(url: string, init: ChatRequestInit): Promise<ChatResponse> {
  return undiciFetch(url, { ...init, dispatcher: chatDispatcher })
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
    if (this.config.provider === 'openrouter') return OPENROUTER_BASE_URL
    if (this.config.provider === 'ollama') return stripTrailingSlash(this.config.ollamaBaseUrl)
    if (this.config.provider === 'omniroute') return stripTrailingSlash(this.config.omnirouteBaseUrl)
    return stripTrailingSlash(this.config.baseUrl)
  }

  private get providerName(): string {
    return providerName(this.config)
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.config.provider === 'unsloth') {
      headers.Authorization = `Bearer ${normalizeUnslothApiKey(this.config.unslothApiKey)}`
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
    if (this.config.provider !== 'openrouter') return
    if (!this.config.openRouterEnabled || !normalizeOpenRouterApiKey(this.config.openRouterApiKey)) {
      throw new LmStudioError('OpenRouter is not enabled or its API key is empty.', 'connection')
    }
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
    let res: Response
    try {
      res = await fetch(url, { headers: this.headers(), signal })
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
    const basePayload: Record<string, unknown> = {
      model: this.model(params),
      messages: params.messages.map(({ images, ...message }) => images?.length
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
      ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {})
    }
    const body = JSON.stringify({
      ...basePayload,
      stream: true,
      // Ask OpenAI-compatible servers to append a final usage frame.
      ...(this.config.provider === 'openrouter' ? {} : { stream_options: { include_usage: true } })
    })

    let res: ChatResponse
    try {
      res = await chatFetch(url, {
        method: 'POST',
        headers: this.headers(),
        body,
        signal
      })
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
          method: 'POST', headers: this.headers(), signal,
          body: JSON.stringify({ ...basePayload, stream: true, stream_options: { include_usage: true } })
        })
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
          headers: this.headers(),
          body: JSON.stringify({ ...basePayload, stream: false }),
          signal
        })
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
