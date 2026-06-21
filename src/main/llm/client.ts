import type { ChatParams, LlmConfig, LlmModel, ToolCall, TokenUsage } from '@shared/ipc'

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

/**
 * Minimal client for an LM Studio (OpenAI-compatible) server.
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

function connectionError(url: string, err: unknown): LmStudioError {
  if (isAbort(err)) return new LmStudioError('Request aborted', 'aborted')
  const code =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code
  const suffix = code ? ` (${code})` : ''
  return new LmStudioError(
    `Cannot reach LM Studio at ${url}${suffix}. Is the local server running and the URL correct?`,
    'connection'
  )
}

async function httpError(url: string, res: Response): Promise<LmStudioError> {
  const text = await res.text().catch(() => '')
  let detail = text
  try {
    const json = JSON.parse(text)
    detail = json?.error?.message ?? json?.error ?? text
  } catch {
    /* not JSON */
  }
  const tail = detail ? ` — ${String(detail).slice(0, 300)}` : ''
  return new LmStudioError(`LM Studio responded ${res.status} for ${url}${tail}`, 'http', res.status)
}

export class LmStudioClient {
  constructor(private config: LlmConfig) {}

  update(patch: Partial<LlmConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  get baseUrl(): string {
    return stripTrailingSlash(this.config.baseUrl)
  }

  /** GET /models — never throws for empty lists, only for real failures. */
  async listModels(signal?: AbortSignal): Promise<LlmModel[]> {
    const url = `${this.baseUrl}/models`
    let res: Response
    try {
      res = await fetch(url, { signal })
    } catch (err) {
      throw connectionError(url, err)
    }
    if (!res.ok) throw await httpError(url, res)
    let json: { data?: { id: string }[] }
    try {
      json = (await res.json()) as { data?: { id: string }[] }
    } catch (err) {
      throw new LmStudioError(`Could not parse model list from LM Studio: ${String(err)}`, 'parse')
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
    const url = `${this.baseUrl}/chat/completions`
    const body = JSON.stringify({
      model: params.model || this.config.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      stream: true,
      // Ask OpenAI-compatible servers to append a final usage frame.
      stream_options: { include_usage: true },
      ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {})
    })

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal
      })
    } catch (err) {
      throw connectionError(url, err)
    }
    if (!res.ok) throw await httpError(url, res)
    if (!res.body) throw new LmStudioError('LM Studio returned an empty response body', 'parse')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // Tool calls stream in fragments keyed by index; assemble them in order.
    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>()
    let finishReason: string | undefined
    let usage: TokenUsage | undefined

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
          if (data === '[DONE]') return assembled()
          try {
            const json = JSON.parse(data)
            const choice = json?.choices?.[0]
            const content: unknown = choice?.delta?.content
            if (typeof content === 'string' && content.length > 0) yield content

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
      }
    } catch (err) {
      if (isAbort(err)) throw new LmStudioError('Request aborted', 'aborted')
      throw err
    } finally {
      reader.releaseLock()
    }

    return assembled()
  }
}
