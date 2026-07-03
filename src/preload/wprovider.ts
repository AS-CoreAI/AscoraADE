import { ipcRenderer } from 'electron'

/**
 * Preload for the WProvider browser windows (the hidden Qwen driver and the
 * visible sign-in window). It runs with contextIsolation OFF so patching
 * `window.fetch` here replaces the function the page's own scripts call.
 *
 * The patch tees the streaming body of the site's chat-completion request and
 * forwards the raw SSE text to the main process, which parses out the answer.
 * Reading the network stream (instead of scraping the rendered DOM) matters:
 * Qwen renders code blocks in virtualized Monaco editors, so the DOM only ever
 * contains the visible lines — but the stream carries the full raw markdown.
 *
 * Nothing is exposed to the page: `ipcRenderer` stays inside this closure.
 */

const NET_CHANNEL = 'wprovider:net'

/** Chat-completion endpoints across Qwen / Open-WebUI-style backends. */
const COMPLETION_URL = /chat\/completions/i

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
const page = globalThis as unknown as { fetch: FetchFn }

const originalFetch: FetchFn = page.fetch.bind(globalThis)

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
    if (method === 'POST' && COMPLETION_URL.test(url) && response.body) {
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
