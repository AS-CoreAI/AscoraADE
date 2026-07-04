import { ipcRenderer } from 'electron'

/**
 * Preload for the WProvider browser windows (the hidden web-chat driver and the
 * visible sign-in window). It runs with contextIsolation OFF so patching
 * `window.fetch` / XHR here replaces the functions the page's own scripts call.
 *
 * The patch tees the streaming body of the site's chat-completion request and
 * forwards the raw SSE text to the main process, which parses out the answer.
 * Reading the network stream (instead of scraping the rendered DOM) matters:
 * Some providers render code blocks through virtualized editors, so the DOM can
 * contain only visible lines — but the stream carries the full raw markdown.
 *
 * Nothing is exposed to the page: `ipcRenderer` stays inside this closure.
 */

const NET_CHANNEL = 'wprovider:net'

/** Chat-completion endpoints across Qwen / DeepSeek / Open-WebUI-style backends. */
const COMPLETION_PATHS = [
  /\/chat\/completions(?:[/?#]|$)/i,
  /\/v\d+\/chat\/completions(?:[/?#]|$)/i,
  /\/api\/v\d+\/chat\/completion(?:[/?#]|$)/i,
  /\/api\/v\d+\/chat\/(?:edit_message|regenerate|continue|resume_stream)(?:[/?#]|$)/i
]

function send(kind: 'start' | 'chunk' | 'done' | 'error', url: string, text?: string): void {
  try {
    ipcRenderer.send(NET_CHANNEL, { kind, url, text })
  } catch {
    /* window is going away — nothing to report to */
  }
}

async function pump(stream: ReadableStream<Uint8Array>, url: string): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value && value.length > 0) send('chunk', url, decoder.decode(value, { stream: true }))
    }
    send('done', url)
  } catch (err) {
    send('error', url, err instanceof Error ? err.message : String(err))
  }
}

// This file is compiled with the node tsconfig (no DOM lib), but runs in the
// page context — reach the page's window through globalThis.
type FetchFn = (input: unknown, init?: RequestInit) => Promise<Response>

interface WProviderXHR {
  addEventListener: (type: string, listener: () => void, options?: boolean) => void
  getResponseHeader: (name: string) => string | null
  readyState: number
  responseText: string
  responseURL: string
  status: number
  __wpMethod?: string
  __wpUrl?: string
  __wpStarted?: boolean
  __wpDone?: boolean
  __wpSeen?: number
}

interface WProviderXHRPrototype {
  open: (this: WProviderXHR, method: string, url: string, ...args: unknown[]) => unknown
  send: (this: WProviderXHR, ...args: unknown[]) => unknown
}

const page = globalThis as unknown as {
  fetch: FetchFn
  location?: { href?: string }
  XMLHttpRequest?: {
    new (): WProviderXHR
    prototype: WProviderXHRPrototype
  }
}

const originalFetch: FetchFn = page.fetch.bind(globalThis)

function absoluteUrl(url: string): string {
  try {
    return new URL(url, page.location?.href).href
  } catch {
    return url
  }
}

function shouldTap(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'POST') return false
  const href = absoluteUrl(url)
  let path = href
  try {
    const parsed = new URL(href)
    path = parsed.pathname
  } catch {
    /* relative or otherwise unparsable; test the raw URL */
  }
  return COMPLETION_PATHS.some((pattern) => pattern.test(path))
}

/**
 * Sites move their completion endpoint around (Qwen's path has changed more
 * than once), so the URL allowlist above is a fast path, not the only path —
 * any POST response that comes back as an SSE stream is a completion stream
 * by construction and is tapped regardless of its path.
 */
function looksLikeEventStream(contentType: string | null | undefined): boolean {
  return /text\/event-stream/i.test(contentType ?? '')
}

page.fetch = async function patchedFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : ((input as { url?: string })?.url ?? String(input))
  const method = (init?.method ?? (input as { method?: string })?.method ?? 'GET').toUpperCase()
  const response = await originalFetch(input, init)

  try {
    const tap = shouldTap(method, url) || (method === 'POST' && looksLikeEventStream(response.headers.get('content-type')))
    if (tap && response.body) {
      const [forPage, forTap] = response.body.tee()
      send('start', url)
      void pump(forTap, url)
      // Hand the page a clone backed by its half of the tee; status/headers
      // are preserved so the site's own stream handling keeps working.
      return new Response(forPage, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    }
  } catch {
    /* tap failed — never break the page's own request */
  }
  return response
}

const xhr = page.XMLHttpRequest
if (xhr?.prototype) {
  const originalOpen = xhr.prototype.open
  const originalSend = xhr.prototype.send

  xhr.prototype.open = function patchedOpen(
    this: WProviderXHR,
    method: string,
    url: string,
    ...args: unknown[]
  ): unknown {
    this.__wpMethod = method
    this.__wpUrl = absoluteUrl(url)
    this.__wpStarted = false
    this.__wpDone = false
    this.__wpSeen = 0
    return originalOpen.call(this, method, url, ...args)
  }

  xhr.prototype.send = function patchedSend(this: WProviderXHR, ...args: unknown[]): unknown {
    const method = this.__wpMethod ?? 'GET'
    const url = this.__wpUrl ?? this.responseURL ?? ''
    // The URL allowlist may not match (endpoints move); headers aren't known
    // until readyState >= 2, so tapping is decided lazily, same as fetch.
    let tapping = shouldTap(method, url)
    const read = (): void => {
      const currentUrl = this.responseURL || url
      if (!tapping && this.readyState >= 2) {
        try {
          if (looksLikeEventStream(this.getResponseHeader('content-type'))) tapping = true
        } catch {
          /* getResponseHeader can throw before headers are received */
        }
      }
      if (!tapping) return
      if (!this.__wpStarted && this.readyState >= 2) {
        this.__wpStarted = true
        send('start', currentUrl)
      }
      if (this.readyState >= 3) {
        try {
          const text = this.responseText || ''
          const seen = this.__wpSeen ?? 0
          if (text.length > seen) {
            send('chunk', currentUrl, text.slice(seen))
            this.__wpSeen = text.length
          }
        } catch {
          /* responseText can throw for non-text responses */
        }
      }
      if (this.readyState === 4 && this.__wpStarted && !this.__wpDone) {
        this.__wpDone = true
        send('done', currentUrl)
      }
    }
    this.addEventListener('readystatechange', read, true)
    this.addEventListener(
      'error',
      () => {
        if (tapping && !this.__wpDone) {
          this.__wpDone = true
          send('error', this.responseURL || url)
        }
      },
      true
    )
    this.addEventListener(
      'abort',
      () => {
        if (tapping && !this.__wpDone) {
          this.__wpDone = true
          send('error', this.responseURL || url, 'aborted')
        }
      },
      true
    )
    return originalSend.call(this, ...args)
  }
}
