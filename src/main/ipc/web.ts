import { ipcMain } from 'electron'
import { IPC, type WebFetchResult, type WebSearchItem, type WebSearchResult } from '@shared/ipc'

/**
 * Outbound HTTP tools for the agent loop (see store.ts). `web_fetch` pulls a URL
 * and returns readable text; `web_search` runs a DuckDuckGo query and returns a
 * small ranked list. Both are read-only, time-boxed, and size-capped so a run
 * can consult the web without a provider-native browser tool.
 */

const FETCH_TIMEOUT_MS = 20_000
const FETCH_MAX_CHARS = 40_000 // keep extracted text within token budgets
const SEARCH_TIMEOUT_MS = 15_000
const SEARCH_MAX_RESULTS = 8
// A plain desktop UA — DuckDuckGo's HTML endpoint rejects obvious bot agents.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function errMsg(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Request timed out.'
    return err.message
  }
  return String(err)
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' '
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? whole
  })
}

/** Strip an HTML document down to readable text (drops script/style/markup). */
function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : undefined
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text }
}

async function fetchUrl(rawUrl: string, maxChars?: number): Promise<WebFetchResult> {
  let target: URL
  try {
    target = new URL(rawUrl.trim())
  } catch {
    return { ok: false, error: 'Invalid URL.' }
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are supported.' }
  }
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      return { ok: false, url: res.url, contentType, error: `HTTP ${res.status} ${res.statusText}`.trim() }
    }
    const body = await res.text()
    const isHtml = /html|xml/.test(contentType) || /^\s*<(?:!doctype|html)/i.test(body)
    const { title, text } = isHtml ? htmlToText(body) : { title: undefined, text: body.trim() }
    const cap = Math.min(FETCH_MAX_CHARS, Math.max(500, Math.floor(maxChars ?? FETCH_MAX_CHARS)))
    const truncated = text.length > cap
    return {
      ok: true,
      url: res.url,
      title,
      content: truncated ? text.slice(0, cap) : text,
      contentType,
      truncated
    }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

/** DuckDuckGo wraps outbound links as /l/?uddg=<encoded>; unwrap to the real URL. */
function unwrapDdgLink(href: string): string {
  try {
    const u = new URL(href, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    return u.href
  } catch {
    return href
  }
}

const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/**
 * Parse DuckDuckGo's full HTML SERP (`html.duckduckgo.com/html/`). Results use
 * `result__a` title anchors and `result__snippet` blocks. Class attributes are
 * double-quoted on this endpoint.
 */
function parseHtmlResults(html: string): WebSearchItem[] {
  const results: WebSearchItem[] = []
  const anchor = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchor.exec(html)) && results.length < SEARCH_MAX_RESULTS) {
    const url = unwrapDdgLink(m[1])
    const title = stripTags(m[2])
    if (!title || !/^https?:/i.test(url)) continue
    const rest = html.slice(m.index, m.index + 2000)
    const snipMatch = rest.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    results.push({ title, url, snippet: snipMatch ? stripTags(snipMatch[1]) : '' })
  }
  return results
}

/**
 * Parse the lightweight SERP (`lite.duckduckgo.com/lite/`) used as a fallback.
 * There each hit is a `result-link` anchor followed by a `result-snippet` cell;
 * class attributes are single-quoted here.
 */
function parseLiteResults(html: string): WebSearchItem[] {
  const results: WebSearchItem[] = []
  const anchor = /<a[^>]+class=['"][^'"]*result-link[^'"]*['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>|<a[^>]+href=['"]([^'"]+)['"][^>]*class=['"][^'"]*result-link[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchor.exec(html)) && results.length < SEARCH_MAX_RESULTS) {
    const url = unwrapDdgLink(m[1] ?? m[3] ?? '')
    const title = stripTags(m[2] ?? m[4] ?? '')
    if (!title || !/^https?:/i.test(url)) continue
    const rest = html.slice(m.index, m.index + 2500)
    const snipMatch = rest.match(/class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]*?)<\/td>/i)
    results.push({ title, url, snippet: snipMatch ? stripTags(snipMatch[1]) : '' })
  }
  return results
}

async function ddgGet(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  })
  // DuckDuckGo answers a bot-challenged request with 202 and a stub page; only
  // a real 200 carries results, so treat anything else as a miss to fall back.
  return res.status === 200 ? res.text() : null
}

async function searchWeb(query: string): Promise<WebSearchResult> {
  const q = (query ?? '').trim()
  if (!q) return { ok: false, error: 'A non-empty search query is required.' }
  const enc = encodeURIComponent(q)
  try {
    // Primary: the full HTML endpoint over GET (POST gets a 202 bot challenge).
    const html = await ddgGet(`https://html.duckduckgo.com/html/?q=${enc}`)
    let results = html ? parseHtmlResults(html) : []
    if (results.length === 0) {
      // Fallback: the lite endpoint, which survives when the full page is blocked.
      const lite = await ddgGet(`https://lite.duckduckgo.com/lite/?q=${enc}`)
      if (lite) results = parseLiteResults(lite)
    }
    return { ok: true, query: q, results }
  } catch (err) {
    return { ok: false, query: q, error: errMsg(err) }
  }
}

export function registerWebHandlers(): void {
  ipcMain.handle(IPC.web.fetch, (_e, url: string, maxChars?: number): Promise<WebFetchResult> =>
    fetchUrl(url, maxChars)
  )
  ipcMain.handle(IPC.web.search, (_e, query: string): Promise<WebSearchResult> => searchWeb(query))
}
