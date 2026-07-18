import {
  normalizeOpenRouterApiKey,
  type ChatParams,
  type LlmConfig,
  type LlmModel,
  type ToolCall,
  type TokenUsage
} from '@shared/ipc'

/** What `streamChat` resolves to once the stream ends (its generator return). */
export interface StreamReturn {
  toolCalls: ToolCall[]
  finishReason?: string
  /** Token usage from the final stream frame, when the server reports it. */
  usage?: TokenUsage
}

/** Partial tool_call fragment as it streams in (OpenAI delta shape). */
interface ToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/**
 * Minimal client for OpenAI-compatible backends (LM Studio, Ollama,
 * OpenRouter, and the bundled OmniRoute gateway).
 *
 *  - GET  {baseUrl}/models           → list available models
 *  - POST {baseUrl}/chat/completions → chat, with Server-Sent-Events streaming
 *
 * Connection / HTTP / parse failures are normalised to `LmStudioError` so the
 * UI can show something friendly instead of a raw stack trace.
 */

export type LmErrorKind = 'connection' | 'http' | 'parse' | 'aborted'

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
  return config.provider === 'openrouter'
    ? 'OpenRouter'
    : config.provider === 'ollama'
      ? 'Ollama'
      : config.provider === 'omniroute'
        ? 'OmniRoute'
      : 'LM Studio'
}

function connectionError(name: string, url: string, err: unknown): LmStudioError {
  if (isAbort(err)) return new LmStudioError('Request aborted', 'aborted')
  const code =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code
  const suffix = code ? ` (${code})` : ''
  return new LmStudioError(
    `Cannot reach ${name} at ${url}${suffix}. Check the connection settings and try again.`,
    'connection'
  )
}

async function httpError(name: string, url: string, res: Response): Promise<LmStudioError> {
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

  get baseUrl(): string {
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
    if (this.config.provider === 'openrouter') {
      const apiKey = normalizeOpenRouterApiKey(this.config.openRouterApiKey)
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`
      headers['HTTP-Referer'] = 'https://ade.ascoreai.com'
      headers['X-OpenRouter-Title'] = 'Ascora ADE'
    }
    return headers
  }

  private requireOpenRouterKey(): void {
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
    if (this.config.provider === 'openrouter') return this.config.openRouterModel || 'openrouter/free'
    if (this.config.provider === 'ollama') return this.config.ollamaModel
    if (this.config.provider === 'omniroute') return this.config.omnirouteModel || 'auto'
    return this.config.model
  }

  /** GET /models — never throws for empty lists, only for real failures. */
  async listModels(signal?: AbortSignal): Promise<LlmModel[]> {
    this.requireOpenRouterKey()
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
  async *streamChat(params: ChatParams, signal?: AbortSignal): AsyncGenerator<string, StreamReturn> {
    this.requireOpenRouterKey()
    this.requireOmniroute()
    const name = this.providerName
    const url = `${this.baseUrl}/chat/completions`
    const basePayload: Record<string, unknown> = {
      model: this.model(params),
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {})
    }
    const body = JSON.stringify({
      ...basePayload,
      stream: true,
      // Ask OpenAI-compatible servers to append a final usage frame.
      ...(this.config.provider === 'openrouter' ? {} : { stream_options: { include_usage: true } })
    })

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body,
        signal
      })
    } catch (err) {
      throw connectionError(name, url, err)
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

    const assembled = (): StreamReturn => ({
      toolCalls: [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, t]) => ({ id: t.id, name: t.name, arguments: t.arguments }))
        .filter((t) => t.name),
      finishReason,
      usage
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
            const content: unknown = choice?.delta?.content
            if (typeof content === 'string' && content.length > 0) { yielded = true; yield content }

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
      if (isAbort(err)) throw new LmStudioError('Request aborted', 'aborted')
      throw err
    } finally {
      reader.releaseLock()
    }

    // OmniRoute routes some web/free providers that ignore `stream: true` and
    // return an empty SSE stream even though a non-streaming request answers
    // (the native Playground uses stream:false and works). Fall back once so the
    // chat turn isn't a blank "(no content returned)". Scoped to OmniRoute only.
    if (this.config.provider === 'omniroute' && !yielded && toolAcc.size === 0) {
      try {
        const fbRes = await fetch(url, {
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
