import { BrowserWindow, ipcMain, session, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import {
  IPC,
  WPROVIDER_SERVICES,
  WPROVIDER_SERVICE_INFO,
  type ChatResult,
  type WProviderAuthorization,
  type WProviderChatParams,
  type WProviderCheckResult,
  type WProviderLoginResult,
  type WProviderService
} from '@shared/ipc'
import {
  closeActiveBrowser,
  ensureExternalWProviderPage,
  importExternalCookies,
  reloadActiveExternalPage,
  runExternalWProviderLogin,
  type ExternalAuthPage,
  type ExternalAuthStorage,
  type ExternalDriverPage
} from './external-auth'
import { getStore } from '../store'

/**
 * Ascora WProvider — an "API emulator" that drives a provider's web chat
 * inside an offscreen Electron BrowserWindow:
 *
 *  1. The user signs in on the provider's page in a real installed browser.
 *     Portable provider state is copied into WProvider's persistent Electron
 *     partition; device-bound sessions stay in that browser as a fallback.
 *  2. Each agent turn is typed into the site's own composer (React-safe value
 *     setter + input event + Enter), so the page itself builds and signs the
 *     request exactly like a human user would.
 *  3. The reply is captured from the site's streaming response: the window's
 *     preload (src/preload/wprovider.ts) tees the `chat/completions` fetch and
 *     forwards raw SSE text here, where the answer deltas are parsed out.
 *     The DOM is only a last-resort fallback — some providers render code
 *     blocks in virtualized editors, so innerText can truncate long code.
 *
 * The web chat keeps its own history, so per conversation (ADE task) we track
 * the site chat URL and how many transcript messages were already relayed —
 * only the unseen tail is sent on each turn.
 */

const PARTITION = 'persist:ascora-wprovider'
const NET_CHANNEL = 'wprovider:net'

/** How long to wait for the site's composer to appear after navigation. */
const UI_READY_TIMEOUT_MS = 45_000
/** DeepSeek can briefly mount a hidden/covered composer before the chat page is actually usable. */
const DEEPSEEK_PROMPT_STABLE_MS = 2500
/** How long after "send" to wait for the completion request to start. */
const START_TIMEOUT_MS = 25_000
/** Rendered-DOM providers can show a queued/thinking turn before any answer text exists. */
const RENDERED_START_TIMEOUT_MS = 60_000
/** Some services do not expose a stable OpenAI-style stream; wait for rendered markdown to stop changing. */
const RENDERED_DOM_STABLE_MS = 4000
/** Abort a generation when the stream goes silent for this long. */
const INACTIVITY_TIMEOUT_MS = 180_000
/** Absolute cap on a single turn. */
const HARD_TIMEOUT_MS = 15 * 60_000
/** Cookie names that indicate a signed-in Qwen session. */
const QWEN_AUTH_COOKIES = ['token', 'auth_token', 'authorization']
/** DeepSeek stores its web-chat bearer token in localStorage. */
const DEEPSEEK_AUTH_STORAGE_KEY = 'userToken'

interface NetEvent {
  kind: 'start' | 'chunk' | 'done' | 'error'
  url: string
  text?: string
}

interface ChatSession {
  chatUrl: string | null
  /** Transcript messages already relayed to the site. */
  sent: number
}

type DeepSeekPhase = 'answer' | 'think' | 'skip'
type AliceAuthState = 'logged-in' | 'logged-out' | 'unknown'

interface ActiveOp {
  id: string
  service: WProviderService
  webContentsId: number
  sseBuffer: string
  content: string
  thinking: string
  /** Where a bare DeepSeek `{"v": "token"}` frame appends (patch-protocol cursor). */
  dsCursor: DeepSeekPhase
  started: boolean
  doneStreams: number
  openStreams: number
  aborted: boolean
  onDelta: (delta: string) => void
  finish: (result: ChatResult) => void
  touch: () => void
}

class WProviderError extends Error {}

let hiddenWin: BrowserWindow | null = null
let authWin: BrowserWindow | null = null
let activeOp: ActiveOp | null = null
/** Serializes hidden-browser work — one shared window, one navigation at a time. */
let queue: Promise<unknown> = Promise.resolve()
const sessions = new Map<string, ChatSession>()
/** Request ids cancelled while they are still waiting in the shared browser queue. */
const cancelledOps = new Set<string>()
let netListenerInstalled = false
let sessionHeadersInstalled = false
let externalLoginActive = false
const externalDriverServices = new Set<WProviderService>()
const EXTERNAL_DRIVER_SERVICES_SETTING = 'wprovider.externalDriverServices'
const AUTHORIZATIONS_SETTING = 'wprovider.authorizations'
let externalDriverServicesLoaded = false
let authorizationsLoaded = false
const authorizations = new Map<WProviderService, WProviderAuthorization>()

function isWProviderService(value: unknown): value is WProviderService {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(WPROVIDER_SERVICE_INFO, value)
  )
}

function loadExternalDriverServices(): void {
  if (externalDriverServicesLoaded) return
  externalDriverServicesLoaded = true
  const saved = getStore().getSetting<unknown>(EXTERNAL_DRIVER_SERVICES_SETTING)
  if (!Array.isArray(saved)) return
  for (const value of saved) {
    if (isWProviderService(value)) externalDriverServices.add(value)
  }
}

function usesExternalDriver(service: WProviderService): boolean {
  loadExternalDriverServices()
  return externalDriverServices.has(service)
}

function setExternalDriver(service: WProviderService, enabled: boolean): boolean {
  loadExternalDriverServices()
  let changed: boolean
  if (enabled) {
    changed = !externalDriverServices.has(service)
    if (changed) externalDriverServices.add(service)
  } else {
    changed = externalDriverServices.delete(service)
  }
  if (changed) {
    getStore().setSetting(EXTERNAL_DRIVER_SERVICES_SETTING, [...externalDriverServices])
  }
  return changed
}

function authorizationSnapshot(): WProviderAuthorization[] {
  return WPROVIDER_SERVICES.flatMap((service) => {
    const authorization = authorizations.get(service)
    return authorization ? [{ ...authorization }] : []
  })
}

function persistAuthorizations(): void {
  try {
    getStore().setSetting(AUTHORIZATIONS_SETTING, authorizationSnapshot())
  } catch (err) {
    // This list is UI metadata. A persistence failure must never turn a
    // successful provider login, check or chat response into an error.
    console.warn('[wprovider] Could not persist authorization registry:', err)
  }
}

function notifyAuthorizationsChanged(): void {
  const snapshot = authorizationSnapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(IPC.wprovider.authorizationsChanged, snapshot)
    } catch {
      // A window may disappear between getAllWindows() and send().
    }
  }
}

function loadAuthorizations(): void {
  if (authorizationsLoaded) return
  authorizationsLoaded = true
  const saved = getStore().getSetting<unknown>(AUTHORIZATIONS_SETTING)
  if (Array.isArray(saved)) {
    for (const value of saved) {
      if (!value || typeof value !== 'object') continue
      const candidate = value as Partial<WProviderAuthorization>
      if (
        !isWProviderService(candidate.service) ||
        (candidate.driver !== 'electron' && candidate.driver !== 'external') ||
        typeof candidate.verifiedAt !== 'number' ||
        !Number.isFinite(candidate.verifiedAt)
      ) {
        continue
      }
      authorizations.set(candidate.service, {
        service: candidate.service,
        driver: candidate.driver,
        verifiedAt: candidate.verifiedAt
      })
    }
  }

  // External-driver markers were persisted before the authorization registry
  // existed. They were created only after a completed OAuth flow, so they are
  // safe positive migration seeds and require no browser navigation here. A
  // zero timestamp means the exact confirmation time predates this registry.
  loadExternalDriverServices()
  let migrated = false
  for (const service of externalDriverServices) {
    if (authorizations.has(service)) continue
    authorizations.set(service, {
      service,
      driver: 'external',
      verifiedAt: 0
    })
    migrated = true
  }
  if (migrated) persistAuthorizations()
}

function confirmAuthorization(
  service: WProviderService,
  driver: WProviderAuthorization['driver']
): void {
  loadAuthorizations()
  authorizations.set(service, { service, driver, verifiedAt: Date.now() })
  persistAuthorizations()
  notifyAuthorizationsChanged()
}

function forgetAuthorization(service: WProviderService): void {
  loadAuthorizations()
  if (!authorizations.delete(service)) return
  persistAuthorizations()
  notifyAuthorizationsChanged()
}

/** Cheap persisted snapshot for settings UI; never drives or opens a browser. */
export function listWProviderAuthorizations(): WProviderAuthorization[] {
  loadAuthorizations()
  return authorizationSnapshot()
}

function enqueueWProviderOp<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(
    () => run(),
    () => run()
  )
  queue = next.catch(() => undefined)
  return next
}

function serviceOrigin(service: WProviderService): string {
  return WPROVIDER_SERVICE_INFO[service].origin
}

function urlOnService(url: string, service: WProviderService): boolean {
  try {
    return new URL(url).origin === serviceOrigin(service)
  } catch {
    return false
  }
}

function serviceChatUrl(service: WProviderService): string {
  const origin = serviceOrigin(service)
  if (service === 'gemini') return `${origin}/app`
  if (service === 'claude') return `${origin}/new`
  if (service === 'mistral') return `${origin}/work`
  return `${origin}/`
}

function serviceLoginUrl(service: WProviderService): string {
  const origin = serviceOrigin(service)
  if (service === 'mistral') return `${origin}/chat`
  return serviceChatUrl(service)
}

/**
 * Cookie domains that can establish a session for each provider after a login
 * completed in the dedicated real-browser profile. Keep this allowlist narrow:
 * the broker must never copy unrelated browsing cookies into Electron.
 */
function serviceAuthCookieDomains(service: WProviderService): string[] {
  switch (service) {
    case 'qwen':
      return ['qwen.ai']
    case 'deepseek':
      return ['deepseek.com']
    case 'alice':
      return ['yandex.ru']
    case 'mistral':
      return ['mistral.ai']
    case 'claude':
      return ['claude.ai']
    case 'grok':
      return ['grok.com', 'x.ai', 'x.com', 'twitter.com']
    case 'gemini':
      return ['google.com', 'youtube.com']
    case 'chatgpt':
      return ['chatgpt.com', 'openai.com']
  }
}

function usesRenderedDomCapture(service: WProviderService): boolean {
  return (
    service === 'alice' ||
    service === 'mistral' ||
    service === 'claude' ||
    service === 'grok' ||
    service === 'gemini' ||
    service === 'chatgpt'
  )
}

function wpSession(): Session {
  const ses = session.fromPartition(PARTITION)
  // Provider pages still run in Electron after a portable login succeeds, but
  // Google authentication itself never does. Keep the real Chromium identity
  // and remove only Electron/application product tokens that needlessly trip
  // generic embedded-browser filters.
  const ua = ses
    .getUserAgent()
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\sascora-ade\/[\d.]+/i, '')
  if (ua !== ses.getUserAgent()) ses.setUserAgent(ua)
  if (!sessionHeadersInstalled) {
    sessionHeadersInstalled = true
    const chromeMajor = /Chrome\/(\d+)/i.exec(ua)?.[1] ?? '150'
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://grok.com/*', 'https://*.grok.com/*', 'https://*.x.ai/*'] },
      (details, callback) => {
        const headers = { ...details.requestHeaders }
        const setHeader = (name: string, value: string): void => {
          for (const existing of Object.keys(headers)) {
            if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing]
          }
          headers[name] = value
        }
        setHeader('User-Agent', ua)
        setHeader(
          'Sec-CH-UA',
          `"Google Chrome";v="${chromeMajor}", "Chromium";v="${chromeMajor}", "Not_A Brand";v="24"`
        )
        setHeader('Sec-CH-UA-Mobile', '?0')
        setHeader(
          'Sec-CH-UA-Platform',
          process.platform === 'win32' ? '"Windows"' : process.platform === 'darwin' ? '"macOS"' : '"Linux"'
        )
        callback({ requestHeaders: headers })
      }
    )
  }
  return ses
}

/**
 * Rejected sign-in attempts ("This browser or app may not be secure") leave
 * anti-abuse and half-established session cookies on google.com that make
 * accounts.google.com silently 302 the next attempt straight back to Gemini —
 * the sign-in form never appears. The user reaches this path only when no
 * usable session exists, so drop every Google cookie and start clean.
 */
async function clearStaleGoogleAuthCookies(): Promise<void> {
  const ses = wpSession()
  for (const domain of ['google.com', 'youtube.com']) {
    const cookies = await ses.cookies.get({ domain })
    await Promise.all(
      cookies.map((cookie) =>
        ses.cookies.remove(
          `https://${cookie.domain?.replace(/^\./, '') || domain}${cookie.path || '/'}`,
          cookie.name
        )
      )
    )
  }
  // A rejected embedded attempt can also leave a registered service worker and
  // cached storage. Clear only Electron's obsolete copy; the dedicated real
  // browser profile intentionally keeps its valid Google SSO state.
  for (const origin of [
    'https://accounts.google.com',
    'https://google.com',
    'https://gemini.google.com'
  ]) {
    try {
      await ses.clearStorageData({
        origin,
        storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      })
    } catch {
      /* best effort — a missing origin is fine */
    }
  }
}

async function clearStaleGrokChallengeCookies(): Promise<void> {
  const ses = wpSession()
  const cookies = await ses.cookies.get({ domain: '.grok.com' })
  const stale = cookies.filter((cookie) => /^cf_chl_/i.test(cookie.name))
  await Promise.all(
    stale.map((cookie) =>
      ses.cookies.remove(`https://${cookie.domain?.replace(/^\./, '') || 'grok.com'}${cookie.path || '/'}`, cookie.name)
    )
  )
}

/**
 * Window flavors:
 *  - `tap`: hidden driver window; patches window.fetch/XHR to read completion
 *    streams. Only this one needs a hooked fetch, which bot-management commonly
 *    fingerprints (toString() no longer native), so the sign-in windows avoid it.
 *  - `plain`: visible sign-in window kept as close to a stock, sandboxed
 *    Chromium tab as possible — no preload, no Node. (DeepSeek's login modal
 *    closed itself into a "verifying" challenge when a preload was present.)
 */
type WindowVariant = 'tap' | 'plain'

function createWindow(show: boolean, variant: WindowVariant = 'tap'): BrowserWindow {
  wpSession() // make sure the partition exists with the cleaned UA
  const webPreferences =
    variant === 'plain'
      ? {
          partition: PARTITION,
          contextIsolation: true,
          // The visible authentication surface needs no preload or Node APIs;
          // keep it equivalent to a sandboxed browser tab.
          sandbox: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      : {
          partition: PARTITION,
          preload: join(__dirname, '../preload/wprovider.js'),
          // The preload must patch the PAGE's globals, so no isolation here.
          // Nothing is exposed to the page — ipcRenderer stays in the preload's
          // closure — and the window only ever navigates to the provider's site.
          contextIsolation: false,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: false
        }
  const win = new BrowserWindow({
    show,
    width: 1180,
    height: 840,
    title: 'Ascora WProvider',
    autoHideMenuBar: true,
    webPreferences
  })
  return win
}

function ensureHiddenWindow(): BrowserWindow {
  if (hiddenWin && !hiddenWin.isDestroyed()) return hiddenWin
  hiddenWin = createWindow(false)
  hiddenWin.on('closed', () => {
    hiddenWin = null
  })
  return hiddenWin
}

function installNetListener(): void {
  if (netListenerInstalled) return
  netListenerInstalled = true
  ipcMain.on(NET_CHANNEL, (event, payload: NetEvent) => {
    const op = activeOp
    if (!op || event.sender.id !== op.webContentsId) return
    if (!payload || typeof payload !== 'object') return
    if (usesRenderedDomCapture(op.service)) return
    op.touch()
    if (payload.kind === 'start') {
      op.started = true
      op.openStreams += 1
    } else if (payload.kind === 'chunk') {
      consumeSse(op, payload.text ?? '')
    } else if (payload.kind === 'done' || payload.kind === 'error') {
      op.doneStreams += 1
      // The turn is over once every completion stream that started has ended.
      if (op.started && op.doneStreams >= op.openStreams) {
        finalizeActiveOp()
      }
    }
  })
}

/**
 * Feed raw SSE text into the op, extracting answer deltas. Qwen streams
 * OpenAI-style frames whose delta carries a `phase` ("think" for reasoning,
 * "answer" for the reply); untagged deltas count as answer. DeepSeek streams
 * a patch protocol instead — see extractDeepSeekDeltas.
 */
function consumeSse(op: ActiveOp, text: string): void {
  op.sseBuffer += text
  let newline: number
  while ((newline = op.sseBuffer.indexOf('\n')) >= 0) {
    const line = op.sseBuffer.slice(0, newline).trim()
    op.sseBuffer = op.sseBuffer.slice(newline + 1)
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const json = JSON.parse(data) as Record<string, unknown>
      for (const delta of extractDeltas(op, json)) {
        if (delta.phase === 'think') {
          op.thinking += delta.text
        } else if (delta.text) {
          op.content += delta.text
          op.onDelta(delta.text)
        }
      }
    } catch {
      /* keep-alive / partial frame */
    }
  }
}

/** Pull `{ text, phase }` deltas out of one SSE JSON frame, shape-tolerantly. */
function extractDeltas(
  op: ActiveOp,
  json: Record<string, unknown>
): { text: string; phase?: string }[] {
  const out: { text: string; phase?: string }[] = []
  const choices = json.choices
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const delta = (choice as { delta?: unknown })?.delta
      if (delta && typeof delta === 'object') {
        const d = delta as { content?: unknown; phase?: unknown }
        if (typeof d.content === 'string' && d.content.length > 0) {
          out.push({ text: d.content, phase: typeof d.phase === 'string' ? d.phase : undefined })
        }
        if (typeof (d as { reasoning_content?: unknown }).reasoning_content === 'string') {
          const reasoning = (d as { reasoning_content: string }).reasoning_content
          if (reasoning) out.push({ text: reasoning, phase: 'think' })
        }
        continue
      }
      // Non-streaming shape: choices[0].message.content
      const message = (choice as { message?: unknown })?.message
      if (message && typeof message === 'object') {
        const content = (message as { content?: unknown }).content
        if (typeof content === 'string' && content) out.push({ text: content })
      }
    }
    return out
  }
  // The patch-protocol parser keeps cursor state on the op, so only run it
  // for the service that actually speaks that protocol.
  if (op.service === 'deepseek') {
    for (const delta of extractDeepSeekDeltas(op, json)) out.push(delta)
  }
  // Bare shapes some backends use: { content: "..." } / { response: "..." }
  if (typeof json.reasoning_content === 'string' && json.reasoning_content) {
    out.push({ text: json.reasoning_content, phase: 'think' })
  }
  if (typeof json.content === 'string' && json.content) out.push({ text: json.content })
  else if (typeof json.response === 'string' && json.response) out.push({ text: json.response })
  return out
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/**
 * DeepSeek streams the answer as a patch protocol: each SSE frame is
 * `{ v, p?, o? }` where `p` is a path ("response/content", "response/fragments",
 * "title", ...) and `o` an operation (APPEND / SET / PATCH / BATCH). Only the
 * frame that switches targets carries `p` — the token frames that follow are
 * bare `{ "v": "token" }` and mean "keep appending at the last declared path",
 * so the parser keeps that cursor on the op across frames. Strings default to
 * APPEND; SET/PATCH carry snapshots of already-accumulated state, so they are
 * reconciled — only the tail that extends what already streamed is emitted.
 * The FIRST answer/think tokens often arrive as such a snapshot; dropping
 * them outright cut the opening characters of every DeepSeek reply.
 */
function extractDeepSeekDeltas(
  op: ActiveOp,
  json: Record<string, unknown>
): { text: string; phase?: string }[] {
  const out: { text: string; phase?: string }[] = []
  // Emitted for this frame but not yet folded into op.content/op.thinking.
  const pending = { answer: '', think: '' }
  const emit = (text: string, phase: DeepSeekPhase): void => {
    if (!text || phase === 'skip') return
    pending[phase] += text
    out.push({ text, phase: phase === 'think' ? 'think' : undefined })
  }
  const reconcile = (snapshot: string, phase: DeepSeekPhase): void => {
    if (!snapshot || phase === 'skip') return
    const have = (phase === 'think' ? op.thinking : op.content) + pending[phase]
    if (snapshot.length > have.length && snapshot.startsWith(have)) {
      emit(snapshot.slice(have.length), phase)
    }
  }

  const visitUpdate = (value: unknown, parentPath: string): void => {
    const update = record(value)
    if (!update) return
    const rawPath = typeof update.p === 'string' ? update.p : null
    const path = [parentPath, rawPath ?? ''].filter(Boolean).join('/')
    const oper = typeof update.o === 'string' ? update.o.toUpperCase() : ''
    const payload = update.v

    // Any frame with an explicit path moves the append cursor.
    if (rawPath !== null) op.dsCursor = deepSeekPathPhase(path)

    if (oper === 'BATCH' && Array.isArray(payload)) {
      for (const child of payload) visitUpdate(child, path)
      return
    }
    if (typeof payload === 'string') {
      if (oper === '' || oper === 'APPEND') emit(payload, op.dsCursor)
      else reconcile(payload, op.dsCursor)
      return
    }
    if (oper === 'APPEND') appendFragment(payload, path, emit)
    else if (oper === 'SET' || oper === 'PATCH') appendFragment(payload, path, reconcile)
  }

  // A fragment appended to "response/fragments" carries the text type (THINK /
  // RESPONSE / ...); bare token frames that follow extend that fragment.
  const appendFragment = (
    value: unknown,
    path: string,
    sink: (text: string, phase: DeepSeekPhase) => void
  ): void => {
    if (Array.isArray(value)) {
      for (const item of value) appendFragment(item, path, sink)
      return
    }
    const obj = record(value)
    if (!obj) return
    const type = typeof obj.type === 'string' ? obj.type : undefined
    const phase = deepSeekFragmentPhase(type, path)
    op.dsCursor = phase
    for (const key of ['content', 'text', 'markdown']) {
      const text = obj[key]
      if (typeof text === 'string') {
        sink(text, phase)
        return
      }
    }
    if (obj.v !== undefined) appendFragment(obj.v, path, sink)
  }

  visitUpdate(json, '')
  return out
}

function deepSeekPathPhase(path: string): DeepSeekPhase {
  if (/reason|think/i.test(path)) return 'think'
  if (/content|markdown|text/i.test(path)) return 'answer'
  // title, status, search results, timings, ... — not part of the answer.
  return 'skip'
}

function deepSeekFragmentPhase(type: string | undefined, path: string): DeepSeekPhase {
  if (/reason|think/i.test(`${path}/${type ?? ''}`)) return 'think'
  // Untyped fragments count as answer; typed ones must be the response itself
  // (SUMMARY / TIP / STATUS / QUOTE / SEARCH fragments are chrome, not answer).
  return type && !/^response$/i.test(type) ? 'skip' : 'answer'
}

function finalizeActiveOp(error?: string): void {
  const op = activeOp
  if (!op) return
  activeOp = null
  if (op.aborted) {
    op.finish({ ok: true, content: op.content, aborted: true })
  } else if (error && !op.content) {
    op.finish({ ok: false, content: '', error })
  } else {
    op.finish({ ok: true, content: op.content })
  }
}

/**
 * `executeJavaScript`'s promise can hang forever (never resolve or reject) if
 * the frame navigates/reloads mid-execution — a known Electron quirk. Every
 * caller here polls in a loop with its own deadline, so a stuck call must not
 * be allowed to block that loop forever; race it against a hard timeout.
 */
async function runJs<T>(win: BrowserWindow, code: string, timeoutMs = 8000): Promise<T> {
  return Promise.race([
    win.webContents.executeJavaScript(code, true) as Promise<T>,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('runJs timed out')), timeoutMs)
      timer.unref?.()
    })
  ])
}

async function loadURLBestEffort(win: BrowserWindow, url: string, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      win.loadURL(url).catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const COMPOSER_SELECTORS = [
  'div.ProseMirror[contenteditable="true"]',
  'rich-textarea .ql-editor[contenteditable="true"]',
  '.ql-editor[contenteditable="true"][role="textbox"]',
  '[data-test-id="textarea-inner"] [contenteditable="true"]',
  '[contenteditable="true"][aria-label*="Gemini" i]',
  '#prompt-textarea[contenteditable="true"]',
  '[contenteditable="true"][aria-label*="ChatGPT" i]',
  '[contenteditable="true"][data-placeholder*="Wpisz" i]',
  '.ProseMirror[contenteditable="true"]',
  'textarea[data-testid="inputbase-textarea"]',
  '[data-highlight-id="alice-input"] textarea',
  '.AliceInput-TextareaWrapper textarea',
  'textarea[placeholder*="Спросите" i]',
  'textarea[placeholder*="DeepSeek" i]',
  'textarea[name="search"]',
  'textarea.message-input-textarea',
  '#message-input-container textarea',
  'textarea[placeholder]',
  'textarea'
]

const SEND_BUTTON_SELECTORS = [
  '#oknyx-button',
  '[data-testid="oknyx"]',
  '[data-highlight-id="alice-oknyx-button"]',
  'button[aria-label*="Wyślij" i]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="Submit" i]',
  'button[aria-label*="Отправ" i]',
  'button.bg-state-primary[aria-label]:not([aria-label*="głos" i]):not([aria-label*="voice" i])',
  '#send-message-button',
  '[role="button"].ds-button--primary.ds-button--circle',
  'button[aria-label*="send" i]',
  '.message-input-right-button-send .omni-button-content-btn',
  '.message-input-right-button-send button',
  '.message-input-right-button-send [class*="btn"]',
  '.message-input-right-button-send',
  '[class*="send-button"]',
  'button[type="submit"]'
]

const QWEN_PENDING_ACTIVATION_MESSAGE =
  'Qwen reports that this account is pending activation. Activate the account through the verification email in your inbox, then try Ascora WProvider again.'

function composerLookupJs(): string {
  return `(() => {
    const selectors = ${JSON.stringify(COMPOSER_SELECTORS)};
    // Cloudflare Turnstile injects a hidden textarea into the provider page.
    // It is a challenge response transport, not the web chat's composer.
    const isChallengeField = (el) => {
      const identity = [
        el.id,
        el.getAttribute?.('name'),
        el.getAttribute?.('class'),
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ');
      if (/turnstile|captcha|challenge/i.test(identity)) return true;
      return Boolean(
        el.closest?.(
          '[class*="turnstile" i], [id*="turnstile" i], [class*="captcha" i], [id*="captcha" i], [class*="challenge" i], [id*="challenge" i]'
        )
      );
    };
    let hiddenCandidate = null;
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.disabled || el.getAttribute?.('aria-disabled') === 'true' || isChallengeField(el)) continue;
        if (el.offsetParent !== null) return el;
        hiddenCandidate ||= el;
      }
    }
    return hiddenCandidate;
  })()`
}

async function throwIfProviderBlocked(win: BrowserWindow, service: WProviderService): Promise<void> {
  if (service === 'deepseek') {
    if (isDeepSeekSignInUrl(win.webContents.getURL())) {
      throw new WProviderError(
        'DeepSeek session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    return
  }
  if (service === 'mistral') {
    if (!windowOnService(win, service)) {
      throw new WProviderError(
        'Mistral session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    const loginVisible = await runJs<boolean>(
      win,
      `(() => {
        if (${composerLookupJs()}) return false;
        const text = document.body?.innerText || '';
        return /Zaloguj\\s+się|Log\\s+in|Sign\\s+in|Se\\s+connecter|Anmelden/i.test(text);
      })()`
    ).catch(() => false)
    if (loginVisible) {
      throw new WProviderError(
        'Mistral session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    return
  }
  if (service === 'claude') {
    if (!windowOnService(win, service)) {
      throw new WProviderError(
        'Claude session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    const loginVisible = await runJs<boolean>(
      win,
      `(() => {
        if (${composerLookupJs()}) return false;
        const text = document.body?.innerText || '';
        return /Log\\s+in|Sign\\s+in|Continue\\s+with\\s+Google|Continue\\s+with\\s+email/i.test(text);
      })()`
    ).catch(() => false)
    if (loginVisible) {
      throw new WProviderError(
        'Claude session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    return
  }
  if (service === 'grok') {
    if (!windowOnService(win, service)) {
      throw new WProviderError(
        'Grok session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    const loginVisible = await runJs<boolean>(
      win,
      `(() => {
        if (${composerLookupJs()}) return false;
        const text = document.body?.innerText || '';
        return /Log\\s+in|Sign\\s+in|Continue\\s+with|Войти|Продолжить/i.test(text);
      })()`
    ).catch(() => false)
    if (loginVisible) {
      throw new WProviderError(
        'Grok session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    return
  }
  if (service === 'gemini') {
    if (!windowOnService(win, service)) {
      throw new WProviderError(
        'Gemini session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    const loginVisible = await runJs<boolean>(
      win,
      `(() => {
        if (${composerLookupJs()}) return false;
        const text = document.body?.innerText || '';
        return /Log\\s+in|Sign\\s+in|Continue\\s+with|Zaloguj|Войти|Продолжить/i.test(text);
      })()`
    ).catch(() => false)
    if (loginVisible) {
      throw new WProviderError(
        'Gemini session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    return
  }
  if (service === 'chatgpt') {
    if (!windowOnService(win, service)) {
      throw new WProviderError(
        'ChatGPT session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    const loginVisible = await runJs<boolean>(
      win,
      `(() => {
        if (${composerLookupJs()}) return false;
        const text = document.body?.innerText || '';
        return /Log\\s+in|Sign\\s+in|Continue\\s+with|Войти|Зарегистр|Продолжить/i.test(text);
      })()`
    ).catch(() => false)
    if (loginVisible) {
      throw new WProviderError(
        'ChatGPT session expired. Open Agent backend settings → Ascora WProvider and sign in again.'
      )
    }
    return
  }
  if (service !== 'qwen') return
  const pendingActivation = await runJs<boolean>(
    win,
    `(() => {
      const pendingNode = document.querySelector('.account-pending-overlay, .account-pending-description');
      const text = ((pendingNode && (pendingNode.innerText || pendingNode.textContent)) || document.body?.innerText || '').trim();
      return Boolean(pendingNode) || /account\\s+is\\s+pending\\s+activation/i.test(text);
    })()`
  ).catch(() => false)
  if (pendingActivation) throw new WProviderError(QWEN_PENDING_ACTIVATION_MESSAGE)
}

async function readComposerDebug(win: BrowserWindow): Promise<string> {
  return runJs<string>(
    win,
    `(() => {
      const textareas = Array.from(document.querySelectorAll('textarea')).map((ta) => ({
        className: ta.className || '',
        placeholder: ta.getAttribute('placeholder') || '',
        disabled: Boolean(ta.disabled),
        hidden: ta.offsetParent === null,
        valueLength: (ta.value || '').length
      }));
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map((el) => ({
        className: el.className || '',
        placeholder: el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '',
        hidden: el.offsetParent === null,
        textLength: ((el.innerText || el.textContent) || '').trim().length
      }));
      const sendControls = ${JSON.stringify(SEND_BUTTON_SELECTORS)}.map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { selector: sel, found: false };
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          selector: sel,
          found: true,
          className: el.className || '',
          text: (el.innerText || '').trim().slice(0, 80),
          disabled: Boolean(
            el.disabled ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList.contains('ds-button--disabled')
          ),
          visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
          pointerEvents: style.pointerEvents,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        };
      });
      const assistantCandidates = Array.from(
        document.querySelectorAll(
          '[class*="Markdown" i], [class*="message" i], [class*="Message"], [data-message-part-type], [data-testid*="message" i], [data-role], .prose, [role="article"], article'
        )
      )
        .filter((el) => {
          const t = ((el.innerText || el.textContent) || '').trim();
          return t.length > 0 && t.length < 8000;
        })
        .slice(-8)
        .map((el) => ({
          tag: el.tagName,
          className: String(el.className || '').slice(0, 140),
          dataAttrs: Object.fromEntries(
            Array.from(el.attributes)
              .filter((a) => a.name.startsWith('data-') || a.name === 'role')
              .map((a) => [a.name, a.value])
          ),
          textLength: ((el.innerText || el.textContent) || '').trim().length,
          textHead: ((el.innerText || el.textContent) || '').trim().slice(0, 60)
        }));
      const snapshot = {
        url: location.href,
        readyState: document.readyState,
        hasMain: Boolean(document.querySelector('main')),
        hasRoot: Boolean(document.querySelector('#root')),
        assistantCandidates,
        activeElement: document.activeElement
          ? {
              tagName: document.activeElement.tagName,
              className: document.activeElement.className || '',
              id: document.activeElement.id || ''
            }
          : null,
        bodyText: (document.body?.innerText || '').trim().slice(0, 180),
        textareas,
        editables,
        sendControls
      };
      return JSON.stringify(snapshot);
    })()`
  ).catch((err) => `diagnostics unavailable: ${err instanceof Error ? err.message : String(err)}`)
}

async function waitForComposer(win: BrowserWindow, service: WProviderService): Promise<void> {
  const deadline = Date.now() + UI_READY_TIMEOUT_MS
  for (;;) {
    await throwIfProviderBlocked(win, service)
    const found = await hasComposer(win)
    if (found) return
    if (Date.now() > deadline) {
      const debug = await readComposerDebug(win)
      throw new WProviderError(
        `The web chat did not finish loading (no message box found). Diagnostics: ${debug}`
      )
    }
    await sleep(500)
  }
}

async function hasComposer(win: BrowserWindow): Promise<boolean> {
  if (win.isDestroyed()) return false
  return runJs<boolean>(win, `!!${composerLookupJs()}`).catch(() => false)
}

async function hasDeepSeekPromptComposer(win: BrowserWindow): Promise<boolean> {
  if (win.isDestroyed()) return false
  return runJs<boolean>(
    win,
    `(() => {
      const selectors = [
        'textarea[placeholder*="DeepSeek" i]',
        'textarea[name="search"]',
        'textarea.message-input-textarea',
        '#message-input-container textarea',
        'textarea[placeholder]',
        'textarea'
      ];
      const sendSelectors = ${JSON.stringify(SEND_BUTTON_SELECTORS)};
      const isVisible = (el) => {
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width >= 80 &&
          rect.height >= 18 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      };
      const isAuthSurface = (el) => {
        for (let node = el; node && node !== document.body; node = node.parentElement) {
          const idClass = String(node.id || '') + ' ' + String(node.className || '');
          const role = node.getAttribute?.('role') || '';
          if (/captcha|login|sign[-_\\s]?in|auth|verify|verification/i.test(idClass)) return true;
          if (role === 'dialog' && !/composer|message|chat|input|textarea/i.test(idClass)) return true;
        }
        return false;
      };
      const allTextareas = selectors.flatMap((sel) => Array.from(document.querySelectorAll(sel)));
      const textareas = Array.from(new Set(allTextareas)).filter((el) => isVisible(el) && !isAuthSurface(el));
      if (textareas.length === 0) return false;
      const sendControls = sendSelectors
        .map((sel) => document.querySelector(sel))
        .filter((el) => el && isVisible(el) && !isAuthSurface(el));
      const hasNearbySend = textareas.some((ta) => {
        const taRect = ta.getBoundingClientRect();
        return sendControls.some((btn) => {
          const btnRect = btn.getBoundingClientRect();
          const sameBand = Math.abs((btnRect.top + btnRect.bottom) / 2 - (taRect.top + taRect.bottom) / 2) < 160;
          return sameBand || Boolean(ta.closest('form, [class*="input" i], [class*="composer" i], [class*="message" i]')?.contains(btn));
        });
      });
      const hasPromptHint = textareas.some((ta) =>
        /deepseek|message|ask|prompt|search|chat/i.test(
          [
            ta.getAttribute('placeholder') || '',
            ta.getAttribute('aria-label') || '',
            String(ta.className || ''),
            String(ta.id || ''),
            String(ta.name || '')
          ].join(' ')
        )
      );
      return hasNearbySend || hasPromptHint;
    })()`
  ).catch(() => false)
}

async function waitForDeepSeekPromptReady(win: BrowserWindow, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let readySince = 0
  for (;;) {
    if (win.isDestroyed() || !windowOnService(win, 'deepseek')) return false
    if (isDeepSeekSignInUrl(win.webContents.getURL())) return false
    const token = await readDeepSeekToken(win)
    const ready = token.length > 8 && (await hasDeepSeekPromptComposer(win))
    if (ready) {
      if (!readySince) readySince = Date.now()
      if (Date.now() - readySince >= DEEPSEEK_PROMPT_STABLE_MS) return true
    } else {
      readySince = 0
    }
    if (Date.now() >= deadline) return false
    await sleep(500)
  }
}

async function loadChat(win: BrowserWindow, service: WProviderService, url: string): Promise<void> {
  const current = win.webContents.getURL()
  if (current !== url) {
    await win.loadURL(url).catch((err) => {
      throw new WProviderError(`Could not open ${url}: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
  await waitForComposer(win, service)
}

function windowOnService(win: BrowserWindow | null, service: WProviderService): boolean {
  if (!win || win.isDestroyed()) return false
  return urlOnService(win.webContents.getURL(), service)
}

async function readDeepSeekToken(win: BrowserWindow): Promise<string> {
  return runJs<string>(
    win,
    `(() => {
      try {
        return String(window.localStorage?.getItem(${JSON.stringify(DEEPSEEK_AUTH_STORAGE_KEY)}) || '');
      } catch {
        return '';
      }
    })()`
  ).catch(() => '')
}

/**
 * `userToken` in localStorage outlives the server-side session — DeepSeek
 * keeps the old value around and only actually invalidates it by redirecting
 * the page to /sign_in. So a present token is necessary but not sufficient;
 * sitting on /sign_in overrides it regardless of what's in storage.
 */
function isDeepSeekSignInUrl(url: string): boolean {
  return /\/sign_in(?:[/?#]|$)/i.test(url)
}

async function isDeepSeekPromptReady(win: BrowserWindow, waitMs = 0): Promise<boolean> {
  if (!windowOnService(win, 'deepseek')) return false
  if (isDeepSeekSignInUrl(win.webContents.getURL())) return false
  const token = await readDeepSeekToken(win)
  if (token.length <= 8) return false
  return waitMs > 0 ? waitForDeepSeekPromptReady(win, waitMs) : hasDeepSeekPromptComposer(win)
}

async function checkDeepSeekLoggedIn(): Promise<boolean> {
  for (const win of [authWin, hiddenWin]) {
    if (!win || !windowOnService(win, 'deepseek')) continue
    if (await isDeepSeekPromptReady(win)) return true
  }

  // Do not navigate the hidden driver out from under an in-flight generation.
  if (activeOp) return false

  const win = ensureHiddenWindow()
  if (!windowOnService(win, 'deepseek')) {
    await loadURLBestEffort(win, serviceOrigin('deepseek'), 10_000)
    // A logged-out session redirects to /sign_in client-side, after the
    // initial load already resolved — give that redirect a moment to land.
    await sleep(1200)
  }
  return isDeepSeekPromptReady(win, 5000)
}

/**
 * Services where a composer alone is not reliable proof of authentication —
 * some expose anonymous input, retain a covered composer on login/challenge
 * screens, or A/B-test that behavior. For these services we also require the
 * absence of visible login UI (and use a structural account marker where one
 * is stable).
 */
const COMPOSER_NOT_ENOUGH_SERVICES: ReadonlySet<WProviderService> = new Set([
  'qwen',
  'mistral',
  'claude',
  'grok',
  'gemini',
  'chatgpt'
])

/**
 * Structural (language-independent) proof of a signed-in session, keyed by
 * service. Mistral's UI locale rotates per session (RU/UK/DE/EN observed), so
 * matching translated "Log in"/"Sign up" text is a losing game — instead we
 * look for the account sidebar, which only the shadcn/ui `data-sidebar`
 * component renders once the workspace/account is loaded.
 */
const SIGNED_IN_MARKER_SELECTORS: Partial<Record<WProviderService, string>> = {
  mistral: '[data-sidebar="menu-button"]',
  gemini: 'img.mavatar-image, [data-test-id="mavatar-footer-settings-button"]'
}

/** Structural UI that Gemini renders only for anonymous visitors. */
const SIGNED_OUT_MARKER_SELECTORS: Partial<Record<WProviderService, string>> = {
  gemini: '[data-test-id="mavatar-sign-in-icon-button"], .signed-out-buttons'
}

function isAuthPageUrl(url: string): boolean {
  try {
    return /\/(auth|log-?in|sign-?in|sign-?up)(?:\/|$)/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** Detect visible sign-in controls without depending on the page locale. */
function signedOutUiJs(): string {
  return `(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    };
    const explicit = document.querySelectorAll(
      '[data-testid="login-button"], [data-testid="signup-button"], [data-testid="mobile-login-button"], [data-testid="mobile-signup-button"]'
    );
    const hitExplicit = Array.from(explicit).find(isVisible);
    if (hitExplicit) return true;
    // Contains, not exact-match: real buttons read "Log in to Mistral", "Continue with Google", etc.
    const loginText = /log\\s?in|sign\\s?in|sign\\s?up|create\\s+account|continue\\s+with\\s+(google|apple|microsoft|email)|zaloguj(\\s+się)?|załóż\\s+konto|se\\s+connecter|anmelden|войти|зарегистрироваться/i;
    const loginHref = /\\/auth\\/log-?in|\\/log-?in(?:[/?#]|$)|\\/sign-?in(?:[/?#]|$)|auth\\.openai\\.com/i;
    for (const el of Array.from(document.querySelectorAll('a, button'))) {
      if (!isVisible(el)) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (text && text.length <= 40 && loginText.test(text)) return true;
      const href = typeof el.getAttribute === 'function' ? el.getAttribute('href') || '' : '';
      if (href && loginHref.test(href)) return true;
    }
    return false;
  })()`
}

/**
 * "Composer present" plus, for COMPOSER_NOT_ENOUGH_SERVICES, "and the page is
 * not an auth screen and shows no visible login/signup controls".
 */
type JsEvaluator = <T>(code: string) => Promise<T>

async function serviceComposerSignedInWith(
  url: string,
  service: WProviderService,
  evaluate: JsEvaluator
): Promise<boolean> {
  if (!urlOnService(url, service)) return false
  const composerPresent = await evaluate<boolean>(`!!${composerLookupJs()}`).catch(() => false)
  if (!composerPresent) return false
  if (!COMPOSER_NOT_ENOUGH_SERVICES.has(service)) return true

  const signedOutMarker = SIGNED_OUT_MARKER_SELECTORS[service]
  if (signedOutMarker) {
    // The selector targets component identity rather than translated button
    // text, so it works for every Gemini locale. Probe failures deliberately
    // count as signed out to avoid closing the login window prematurely.
    const isSignedOut = await evaluate<boolean>(
      `!!document.querySelector(${JSON.stringify(signedOutMarker)})`
    ).catch(() => true)
    if (isSignedOut) return false
  }

  const marker = SIGNED_IN_MARKER_SELECTORS[service]
  if (marker) {
    return evaluate<boolean>(`!!document.querySelector(${JSON.stringify(marker)})`).catch(() => false)
  }

  if (isAuthPageUrl(url)) return false
  // On probe failure err on "signed out": a false "signed in" closes the login
  // window under the user's cursor, which is the failure mode being avoided.
  const signedOut = await evaluate<boolean>(signedOutUiJs()).catch(() => true)
  return !signedOut
}

async function serviceComposerSignedIn(win: BrowserWindow, service: WProviderService): Promise<boolean> {
  if (win.isDestroyed()) return false
  return serviceComposerSignedInWith(
    win.webContents.getURL(),
    service,
    <T>(code: string): Promise<T> => runJs<T>(win, code)
  )
}

async function waitForServiceComposerReady(
  win: BrowserWindow,
  service: WProviderService,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (win.isDestroyed() || !windowOnService(win, service)) return false
    if (await serviceComposerSignedIn(win, service)) return true
    if (Date.now() >= deadline) return false
    await sleep(500)
  }
}

function aliceAuthStateJs(): string {
  return `(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    };
    const textOf = (el) => ((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim());
    const hasHeaderLogin = Array.from(
      document.querySelectorAll('.LandingHeader button, .LandingHeader .AliceButton')
    ).some((el) => isVisible(el) && /^Войти$/i.test(textOf(el)));
    const hasSidebarLogin =
      Array.from(document.querySelectorAll('nav.ChatSidebar-ChatsList_unlogged, .ChatListLoginPanel')).some(isVisible) ||
      Array.from(document.querySelectorAll('nav.ChatSidebar-ChatsList_unlogged button, .ChatListLoginPanel button')).some(
        (el) => isVisible(el) && /^Войти$/i.test(textOf(el))
      );
    if (hasHeaderLogin || hasSidebarLogin) return 'logged-out';
    if (document.readyState === 'loading') return 'unknown';
    if (document.body && (document.body.innerText || '').trim()) return 'logged-in';
    return 'unknown';
  })()`
}

async function externalPageSignedIn(
  page: ExternalAuthPage,
  service: WProviderService
): Promise<boolean> {
  if (!urlOnService(page.url, service)) return false
  if (service === 'alice') {
    const state = await page.evaluate<string>(aliceAuthStateJs()).catch(() => 'unknown')
    return state === 'logged-in'
  }
  if (service === 'deepseek') {
    if (isDeepSeekSignInUrl(page.url)) return false
    return page
      .evaluate<boolean>(
        `(() => {
          const token = String(window.localStorage?.getItem(${JSON.stringify(DEEPSEEK_AUTH_STORAGE_KEY)}) || '');
          return token.length > 8 && Boolean(${composerLookupJs()});
        })()`
      )
      .catch(() => false)
  }
  return serviceComposerSignedInWith(
    page.url,
    service,
    <T>(code: string): Promise<T> => page.evaluate<T>(code)
  )
}

async function restoreExternalStorage(
  win: BrowserWindow,
  storage: ExternalAuthStorage
): Promise<void> {
  const local = JSON.stringify(storage.local)
  const sessionValues = JSON.stringify(storage.session)
  await runJs(
    win,
    `(() => {
      for (const [key, value] of Object.entries(${local})) window.localStorage.setItem(key, String(value));
      for (const [key, value] of Object.entries(${sessionValues})) window.sessionStorage.setItem(key, String(value));
    })()`
  )
}

async function readAliceAuthState(win: BrowserWindow): Promise<AliceAuthState> {
  if (!windowOnService(win, 'alice')) return 'unknown'
  const state = await runJs<string>(win, aliceAuthStateJs()).catch(() => 'unknown')
  return state === 'logged-in' || state === 'logged-out' ? state : 'unknown'
}

async function waitForAliceAuthState(win: BrowserWindow, timeoutMs: number): Promise<AliceAuthState> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (win.isDestroyed() || !windowOnService(win, 'alice')) return 'unknown'
    const state = await readAliceAuthState(win)
    if (state !== 'unknown') return state
    if (Date.now() >= deadline) return 'unknown'
    await sleep(500)
  }
}

async function checkAliceLoggedIn(): Promise<boolean> {
  let sawLoggedOut = false
  for (const win of [authWin, hiddenWin]) {
    if (!win || !windowOnService(win, 'alice')) continue
    const state = await readAliceAuthState(win)
    if (state === 'logged-in') return true
    if (state === 'logged-out') sawLoggedOut = true
  }
  if (sawLoggedOut) return false

  // Do not navigate the hidden driver out from under an in-flight generation.
  if (activeOp) return false

  const win = ensureHiddenWindow()
  if (!windowOnService(win, 'alice')) {
    await loadURLBestEffort(win, serviceChatUrl('alice'), 10_000)
    await sleep(1200)
  }
  return (await waitForAliceAuthState(win, 8000)) === 'logged-in'
}

async function checkMistralLoggedIn(): Promise<boolean> {
  for (const win of [authWin, hiddenWin]) {
    if (!win || !windowOnService(win, 'mistral')) continue
    if (await serviceComposerSignedIn(win, 'mistral')) return true
  }

  // Do not navigate the hidden driver out from under an in-flight generation.
  if (activeOp) return false

  const win = ensureHiddenWindow()
  if (!windowOnService(win, 'mistral')) {
    await loadURLBestEffort(win, serviceChatUrl('mistral'), 10_000)
    await sleep(1200)
  }
  return waitForServiceComposerReady(win, 'mistral', 8000)
}

async function checkClaudeLoggedIn(): Promise<boolean> {
  for (const win of [authWin, hiddenWin]) {
    if (!win || !windowOnService(win, 'claude')) continue
    if (await serviceComposerSignedIn(win, 'claude')) return true
  }

  // Do not navigate the hidden driver out from under an in-flight generation.
  if (activeOp) return false

  const win = ensureHiddenWindow()
  if (!windowOnService(win, 'claude')) {
    await loadURLBestEffort(win, serviceChatUrl('claude'), 10_000)
    await sleep(1200)
  }
  return waitForServiceComposerReady(win, 'claude', 8000)
}

async function checkGrokLoggedIn(): Promise<boolean> {
  for (const win of [authWin, hiddenWin]) {
    if (!win || !windowOnService(win, 'grok')) continue
    if (await hasComposer(win)) return true
  }

  // Do not navigate the hidden driver out from under an in-flight generation.
  if (activeOp) return false

  const win = ensureHiddenWindow()
  if (!windowOnService(win, 'grok')) {
    await loadURLBestEffort(win, serviceChatUrl('grok'), 10_000)
    await sleep(1200)
  }
  return waitForServiceComposerReady(win, 'grok', 8000)
}

async function checkGeminiLoggedIn(): Promise<boolean> {
  for (const win of [authWin, hiddenWin]) {
    if (!win || !windowOnService(win, 'gemini')) continue
    if (await serviceComposerSignedIn(win, 'gemini')) return true
  }

  // Do not navigate the hidden driver out from under an in-flight generation.
  if (activeOp) return false

  const win = ensureHiddenWindow()
  if (!windowOnService(win, 'gemini')) {
    await loadURLBestEffort(win, serviceChatUrl('gemini'), 10_000)
    await sleep(1200)
  }
  return waitForServiceComposerReady(win, 'gemini', 8000)
}

async function checkChatGptLoggedIn(): Promise<boolean> {
  for (const win of [authWin, hiddenWin]) {
    if (!win || !windowOnService(win, 'chatgpt')) continue
    if (await serviceComposerSignedIn(win, 'chatgpt')) return true
  }

  // Do not navigate the hidden driver out from under an in-flight generation.
  if (activeOp) return false

  const win = ensureHiddenWindow()
  if (!windowOnService(win, 'chatgpt')) {
    await loadURLBestEffort(win, serviceChatUrl('chatgpt'), 10_000)
    await sleep(1200)
  }
  return waitForServiceComposerReady(win, 'chatgpt', 8000)
}

/** Set the composer's value the React-safe way and confirm it stuck. */
async function typePrompt(win: BrowserWindow, text: string): Promise<void> {
  const focusResult = await runJs<string>(
    win,
    `(() => {
      const el = ${composerLookupJs()};
      if (!el) return 'no-composer';
      el.focus();
      if (el.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('delete');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
        return document.activeElement === el || el.contains(document.activeElement) ? 'ok' : 'not-focused';
      }
      const proto = Object.getPrototypeOf(el);
      const desc =
        Object.getOwnPropertyDescriptor(proto, 'value') ||
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(el, '');
      else el.value = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
      return document.activeElement === el ? 'ok' : 'not-focused';
    })()`
  )
  if (focusResult === 'no-composer') throw new WProviderError('Could not find the message box on the chat page.')

  // Prefer a real text insertion so Qwen's React state and send-control state
  // change the same way they do for a human typing into the composer.
  win.webContents.focus()
  await win.webContents.insertText(text).catch(() => undefined)
  await sleep(150)

  let result = await runJs<string>(
    win,
    `(() => {
      const el = ${composerLookupJs()};
      if (!el) return 'no-composer';
      const value = el.isContentEditable ? (el.innerText || el.textContent || '').trim() : (el.value || '');
      return value.length > 0 ? 'ok' : 'empty';
    })()`
  )

  if (result === 'empty') {
    result = await runJs<string>(
      win,
      `(() => {
        const el = ${composerLookupJs()};
        if (!el) return 'no-composer';
        el.focus();
        if (el.isContentEditable) {
          el.textContent = ${JSON.stringify(text)};
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return (el.innerText || el.textContent || '').trim().length > 0 ? 'ok' : 'empty';
        }
        const proto = Object.getPrototypeOf(el);
        const desc =
          Object.getOwnPropertyDescriptor(proto, 'value') ||
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(el, ${JSON.stringify(text)});
        else el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value.length > 0 ? 'ok' : 'empty';
      })()`
    )
  }

  if (result !== 'ok') {
    throw new WProviderError(
      result === 'no-composer'
        ? 'Could not find the message box on the chat page.'
        : 'Could not type the prompt into the chat page.'
    )
  }
}

async function pressEnter(win: BrowserWindow): Promise<void> {
  await runJs(
    win,
    `(() => {
      const ta = ${composerLookupJs()};
      if (!ta) return 'no-composer';
      ta.focus();
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      ta.dispatchEvent(new KeyboardEvent('keydown', opts));
      ta.dispatchEvent(new KeyboardEvent('keypress', opts));
      ta.dispatchEvent(new KeyboardEvent('keyup', opts));
      return 'ok';
    })()`
  )
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
}

async function clickSendButton(win: BrowserWindow): Promise<string> {
  const target = await runJs<{ selector: string; x: number; y: number } | null>(
    win,
    `(() => {
      // Only click when the prompt is still sitting in the composer. Once the
      // message went out the composer is empty and the same control may mean
      // something else — Alice's Oknyx button becomes "stop generation" while
      // answering and a microphone toggle when idle, so a retry click there
      // cancels the reply or starts voice input.
      const composer = ${composerLookupJs()};
      if (composer) {
        const pending = composer.isContentEditable
          ? (composer.innerText || composer.textContent || '').trim()
          : (composer.value || '').trim();
        if (!pending) return null;
      }
      const selectors = ${JSON.stringify(SEND_BUTTON_SELECTORS)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const disabled = Boolean(
          el.disabled ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.classList.contains('ds-button--disabled')
        );
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.pointerEvents !== 'none';
        if (!disabled && visible) {
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const nextRect = el.getBoundingClientRect();
          return {
            selector: sel,
            x: Math.round(nextRect.left + nextRect.width / 2),
            y: Math.round(nextRect.top + nextRect.height / 2)
          };
        }
      }
      return null;
    })()`
  )
  if (!target) return 'none'
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y })
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1
  })
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1
  })
  return target.selector
}

/**
 * DOM fallback for the final answer. Alice, Mistral, Claude, Grok, Gemini, and ChatGPT use this as their
 * primary capture path because rendered Markdown is more stable there than
 * the sites' private web stream shapes.
 * Long code blocks may be truncated here — Monaco only renders visible lines.
 */
interface AssistantSnapshot {
  count: number
  text: string
}

function looksLikePromptEcho(text: string, prompt: string): boolean {
  if (text === prompt) return true
  // Broad DOM selectors can briefly pick up a truncated user bubble. Do not
  // reject a short legitimate answer merely because that word also appeared
  // in the instruction (for example: “Answer only: ГОТОВО”).
  const substantialEchoLength = Math.max(24, Math.floor(prompt.length * 0.7))
  return text.length >= substantialEchoLength && prompt.includes(text)
}

function assistantMessageSelector(service: WProviderService): string {
  // Alice's "MarkdownText" bubble class from earlier UI builds is gone in the
  // current Futuris-based redesign (confirmed via live diagnostics: assistant
  // and user turns are both `.MessageBubble-Container`, distinguished only by
  // the `_from-user` modifier on the user's own messages). Match any
  // MessageBubble-Container that is NOT the user's, plus the legacy
  // MarkdownText selector for resilience against older/A-B'd builds.
  // readAssistantSnapshot keeps only the LAST match and waitForRenderedAssistant
  // filters the echoed prompt, so once the reply renders it is the last match.
  if (service === 'alice') {
    return '.MessageBubble-Container:not(.MessageBubble-Container_from-user), [class*="MarkdownText"]'
  }
  if (service === 'claude') {
    return '.font-claude-response .standard-markdown, .font-claude-response'
  }
  if (service === 'grok') {
    return '.response-content-markdown.markdown, .response-content-markdown'
  }
  if (service === 'gemini') {
    return 'structured-content-container .markdown-main-panel, message-content .markdown-main-panel, .markdown-main-panel'
  }
  if (service === 'chatgpt') {
    return '[data-message-author-role="assistant"] .markdown, section[data-turn="assistant"] .markdown'
  }
  if (service === 'mistral') {
    // The "answer" part-type selector was reverse-engineered against Le Chat's
    // classic /chat surface. /work ("Vibe") is a separate agentic UI whose
    // reply parts may use different data-message-part-type values (e.g. plain
    // "text" instead of "answer") — cast a wider net and let the echoed-prompt
    // filter in waitForRenderedAssistant discard the user's own bubble.
    return '[data-message-part-type], [data-testid="text-message-part"], .prose'
  }
  return service === 'deepseek'
    ? '.ds-assistant-message-main-content, .ds-message .ds-markdown, [class*="assistant"] [class*="markdown"]'
    : '.qwen-chat-message-assistant .custom-qwen-markdown, .qwen-chat-message-assistant, [class*="message-assistant"]'
}

async function readAssistantSnapshot(win: BrowserWindow, service: WProviderService): Promise<AssistantSnapshot> {
  const selector = assistantMessageSelector(service)
  return runJs<AssistantSnapshot>(
    win,
    `(() => {
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const clean = (node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll?.('button, .CodeBlock-HeaderActions, .CodeBlock-StickyWrapper, .CodeBlock-Stopper, .MessageBubble-CollapserOverlay').forEach((el) => el.remove());
        return (clone.innerText || clone.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      };
      const texts = nodes.map(clean).filter(Boolean);
      return { count: nodes.length, text: texts[texts.length - 1] || '' };
    })()`
  ).catch(() => ({ count: 0, text: '' }))
}

async function readLastAssistantMessage(win: BrowserWindow, service: WProviderService): Promise<string> {
  return (await readAssistantSnapshot(win, service)).text
}

async function waitForRenderedAssistant(
  win: BrowserWindow,
  service: WProviderService,
  before: AssistantSnapshot,
  prompt: string,
  id: string
): Promise<string> {
  const startDeadline = Date.now() + RENDERED_START_TIMEOUT_MS
  let lastText = ''
  let emitted = ''
  let lastChange = Date.now()
  let nextSendAttempt = 0

  for (;;) {
    if (activeOp?.id !== id) return ''
    await throwIfProviderBlocked(win, service)

    const snapshot = await readAssistantSnapshot(win, service)
    let text =
      snapshot.count > before.count || (snapshot.text && snapshot.text !== before.text)
        ? snapshot.text
        : ''

    if (text && looksLikePromptEcho(text, prompt)) text = ''

    if (text && text !== lastText) {
      lastText = text
      lastChange = Date.now()
      const op = activeOp
      if (op?.id === id) {
        op.started = true
        op.content = text
        op.touch()
        if (text.startsWith(emitted)) {
          const delta = text.slice(emitted.length)
          emitted = text
          if (delta) op.onDelta(delta)
        } else if (!emitted) {
          emitted = text
          op.onDelta(text)
        } else {
          emitted = text
        }
      }
    }

    if (lastText && Date.now() - lastChange >= RENDERED_DOM_STABLE_MS) return lastText

    if (!lastText) {
      if (Date.now() > startDeadline) {
        const debug = await readComposerDebug(win)
        throw new WProviderError(
          `The prompt was typed but ${WPROVIDER_SERVICE_INFO[service].label} did not render an answer. Diagnostics: ${debug}`
        )
      }
      if (Date.now() >= nextSendAttempt) {
        await clickSendButton(win).catch(() => 'none')
        nextSendAttempt = Date.now() + 1000
      }
    }

    await sleep(500)
  }
}

function isProviderChatUrl(service: WProviderService, url: string): boolean {
  if (!urlOnService(url, service)) return false
  if (service === 'gemini') return /\/app\/[^/?#]+\/?/.test(url)
  if (service === 'claude') return /\/chat\/[^/?#]+\/?/.test(url)
  if (service === 'deepseek') return /\/a\/chat\/s\//.test(url)
  if (service === 'alice') return /\/chat\/[^/?#]+\/?/.test(url)
  if (service === 'mistral') return /\/(?:work|chat)(?:[/?#]|$)/.test(url)
  return /\/c\//.test(url)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------- public surface ----------------

async function checkExternalDriverLoggedIn(service: WProviderService): Promise<boolean> {
  const page = await ensureExternalWProviderPage(serviceChatUrl(service))
  const deadline = Date.now() + 12_000
  for (;;) {
    const url = await page.getUrl().catch(() => '')
    if (urlOnService(url, service)) {
      const current: ExternalAuthPage = {
        url,
        evaluate: <T>(code: string): Promise<T> => page.evaluate<T>(code)
      }
      if (await externalPageSignedIn(current, service)) return true
    }
    if (Date.now() >= deadline) return false
    await sleep(500)
  }
}

async function checkWProviderNow(service: WProviderService): Promise<WProviderCheckResult> {
  try {
    if (usesExternalDriver(service)) {
      return { ok: true, service, loggedIn: await checkExternalDriverLoggedIn(service) }
    }
    if (service === 'alice') {
      return { ok: true, service, loggedIn: await checkAliceLoggedIn() }
    }
    if (service === 'deepseek') {
      return { ok: true, service, loggedIn: await checkDeepSeekLoggedIn() }
    }
    if (service === 'mistral') {
      return { ok: true, service, loggedIn: await checkMistralLoggedIn() }
    }
    if (service === 'claude') {
      return { ok: true, service, loggedIn: await checkClaudeLoggedIn() }
    }
    if (service === 'grok') {
      return { ok: true, service, loggedIn: await checkGrokLoggedIn() }
    }
    if (service === 'gemini') {
      return { ok: true, service, loggedIn: await checkGeminiLoggedIn() }
    }
    if (service === 'chatgpt') {
      return { ok: true, service, loggedIn: await checkChatGptLoggedIn() }
    }
    const cookies = await wpSession().cookies.get({ url: serviceOrigin(service) })
    const loggedIn = cookies.some(
      (c) => QWEN_AUTH_COOKIES.includes(c.name.toLowerCase()) && (c.value ?? '').length > 8
    )
    return { ok: true, service, loggedIn }
  } catch (err) {
    return { ok: false, service, loggedIn: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function checkWProvider(service: WProviderService): Promise<WProviderCheckResult> {
  return enqueueWProviderOp(async () => {
    const result = { ...(await checkWProviderNow(service)), checkedAt: Date.now() }
    if (result.loggedIn) {
      confirmAuthorization(service, usesExternalDriver(service) ? 'external' : 'electron')
    }
    return result
  })
}

async function probeLoginReady(win: BrowserWindow, service: WProviderService): Promise<boolean> {
  if (service === 'alice') return (await waitForAliceAuthState(win, 8000)) === 'logged-in'
  if (service === 'deepseek') return isDeepSeekPromptReady(win, 8000)
  if (
    service === 'mistral' ||
    service === 'claude' ||
    service === 'grok' ||
    service === 'gemini' ||
    service === 'chatgpt'
  ) {
    return waitForServiceComposerReady(win, service, 10_000)
  }
  // Probe the Electron window we have just populated. Calling the global
  // checker here can accidentally validate a still-active external fallback
  // and then make us close it even though this imported session is unusable.
  return serviceComposerSignedIn(win, service)
}

/**
 * Complete the provider's whole interactive sign-in flow in a real installed
 * browser. Starting at the provider (instead of opening a captured Google URL)
 * preserves popup opener/state/PKCE behavior for every "Continue with Google"
 * implementation. Once the real browser reaches a usable composer, its
 * provider-scoped session is copied into WProvider's private partition and
 * verified again inside the hidden Electron driver.
 */
async function loginWProviderNow(service: WProviderService): Promise<WProviderLoginResult> {
  if (externalLoginActive) {
    return {
      ok: false,
      loggedIn: false,
      error: 'Another WProvider sign-in is already open in the real browser.'
    }
  }
  externalLoginActive = true
  try {
    // Clean only Electron's rejected/half-established state. The dedicated real
    // browser profile deliberately keeps Google SSO between provider logins.
    if (service === 'grok') await clearStaleGrokChallengeCookies()
    if (service === 'gemini') await clearStaleGoogleAuthCookies()

    const external = await runExternalWProviderLogin({
      startUrl: serviceLoginUrl(service),
      providerLabel: WPROVIDER_SERVICE_INFO[service].label,
      cookieDomains: serviceAuthCookieDomains(service),
      isSignedIn: (page) => externalPageSignedIn(page, service)
    })
    const imported = await importExternalCookies(wpSession(), external.cookies)
    if (imported.imported === 0) {
      setExternalDriver(service, true)
      confirmAuthorization(service, 'external')
      return { ok: true, loggedIn: true }
    }

    // Validate inside the actual hidden chat driver, not a disposable window.
    // sessionStorage is per-window; validating elsewhere and then closing that
    // window can turn a seemingly successful hand-off into an immediate logout.
    const win = ensureHiddenWindow()
    await loadURLBestEffort(win, serviceChatUrl(service), 20_000)
    if (!win.isDestroyed() && windowOnService(win, service)) {
      await restoreExternalStorage(win, external.storage).catch(() => undefined)
      win.webContents.reload()
      await sleep(1200)
    }
    let loggedIn = !win.isDestroyed() && (await probeLoginReady(win, service))
    if (loggedIn) {
      // Device-bound/rotating cookies can make the imported page look signed
      // in for a moment before the provider rejects it. Require a delayed
      // second proof before closing the known-good real browser.
      await sleep(service === 'gemini' ? 5000 : 1500)
      loggedIn = !win.isDestroyed() && (await probeLoginReady(win, service))
    }
    if (!loggedIn) {
      // OAuth succeeded, but this provider tied additional state to the real
      // browser (DBSC/IndexedDB/service worker/etc.). Keep that browser as the
      // canonical WProvider driver rather than reporting a false login failure.
      setExternalDriver(service, true)
      confirmAuthorization(service, 'external')
      return { ok: true, loggedIn: true }
    }
    setExternalDriver(service, false)
    await closeActiveBrowser()
    confirmAuthorization(service, 'electron')
    return { ok: true, loggedIn: true }
  } catch (err) {
    await closeActiveBrowser()
    return {
      ok: false,
      loggedIn: false,
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    const win = authWin
    authWin = null
    if (win && !win.isDestroyed()) win.close()
    externalLoginActive = false
  }
}

export function loginWProvider(service: WProviderService): Promise<WProviderLoginResult> {
  // Login, checks and chat turns all share the same private Electron session
  // and (only for a non-portable session) the same external browser. Keep the
  // lifecycle serialized so a background check cannot close or replace the
  // browser while the user is finishing OAuth.
  return enqueueWProviderOp(() => loginWProviderNow(service))
}

async function logoutWProviderNow(service: WProviderService): Promise<WProviderCheckResult> {
  try {
    if (setExternalDriver(service, false)) await closeActiveBrowser()
    const origin = serviceOrigin(service)
    if (
      hiddenWin &&
      !hiddenWin.isDestroyed() &&
      urlOnService(hiddenWin.webContents.getURL(), service)
    ) {
      hiddenWin.destroy()
      hiddenWin = null
    }
    for (const key of sessions.keys()) {
      if (key.startsWith(`${service}:`)) sessions.delete(key)
    }
    const ses = wpSession()
    await ses.clearStorageData({ origin })
    // Imported OAuth sessions can span sibling domains (for example
    // google.com for Gemini or openai.com for ChatGPT). Clear the same narrow
    // allowlist used during import, not only cookies visible at the chat URL.
    for (const domain of serviceAuthCookieDomains(service)) {
      const cookies = await ses.cookies.get({ domain })
      await Promise.all(
        cookies.map((cookie) => {
          const host = cookie.domain?.replace(/^\./, '') || domain
          return ses.cookies.remove(
            `${cookie.secure === false ? 'http' : 'https'}://${host}${cookie.path || '/'}`,
            cookie.name
          )
        })
      )
    }
    await ses.cookies.flushStore()
    forgetAuthorization(service)
    return { ok: true, service, loggedIn: false }
  } catch (err) {
    return { ok: false, service, loggedIn: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function logoutWProvider(service: WProviderService): Promise<WProviderCheckResult> {
  return enqueueWProviderOp(() => logoutWProviderNow(service))
}

export function abortWProvider(id: string): void {
  cancelledOps.add(id)
  const op = activeOp
  if (!op || op.id !== id) return
  op.aborted = true
  // Reloading the page tears down the site's fetch, which stops our tap too;
  // finalize immediately so the renderer isn't left waiting.
  finalizeActiveOp()
  if (
    op.webContentsId !== -1 &&
    hiddenWin &&
    !hiddenWin.isDestroyed() &&
    hiddenWin.webContents.id === op.webContentsId
  ) {
    hiddenWin.webContents.reload()
  } else if (op.webContentsId === -1) {
    void reloadActiveExternalPage()
  }
}

/** Drop an in-memory site-chat cursor once a short-lived Blueprint run ends. */
export function forgetWProviderSession(service: WProviderService, sessionKey: string): void {
  sessions.delete(`${service}:${sessionKey}`)
}

export function chatWProvider(
  id: string,
  service: WProviderService,
  params: WProviderChatParams,
  sender?: WebContents,
  onDelta?: (delta: string) => void
): Promise<ChatResult> {
  installNetListener()
  const turn = enqueueWProviderOp(() => {
    if (cancelledOps.delete(id)) return Promise.resolve({ ok: true, content: '', aborted: true })
    return runChatTurn(id, service, params, sender, onDelta)
  })
  return turn
    .then((result) => {
      if (result.ok && !result.aborted) {
        confirmAuthorization(service, usesExternalDriver(service) ? 'external' : 'electron')
      }
      return result
    })
    .catch((err) => ({
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err)
    }))
    .finally(() => cancelledOps.delete(id))
}

async function externalAssistantSnapshot(
  page: ExternalDriverPage,
  service: WProviderService
): Promise<AssistantSnapshot> {
  const selector = assistantMessageSelector(service)
  return page
    .evaluate<AssistantSnapshot>(
      `(() => {
        const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const clean = (node) => {
          const clone = node.cloneNode(true);
          clone.querySelectorAll?.('button, .CodeBlock-HeaderActions, .CodeBlock-StickyWrapper, .CodeBlock-Stopper, .MessageBubble-CollapserOverlay').forEach((el) => el.remove());
          return (clone.innerText || clone.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
        };
        const texts = nodes.map(clean).filter(Boolean);
        return { count: nodes.length, text: texts[texts.length - 1] || '' };
      })()`
    )
    .catch(() => ({ count: 0, text: '' }))
}

async function externalTypePrompt(page: ExternalDriverPage, text: string): Promise<void> {
  const focusResult = await page.evaluate<string>(
    `(() => {
      const el = ${composerLookupJs()};
      if (!el) return 'no-composer';
      el.focus();
      if (el.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('delete');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
        return 'ok';
      }
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (desc?.set) desc.set.call(el, ''); else el.value = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
      return 'ok';
    })()`
  )
  if (focusResult === 'no-composer') throw new WProviderError('Could not find the message box on the chat page.')

  await page.insertText(text)
  await sleep(150)
  let result = await page.evaluate<string>(
    `(() => {
      const el = ${composerLookupJs()};
      if (!el) return 'no-composer';
      const value = el.isContentEditable ? (el.innerText || el.textContent || '').trim() : (el.value || '');
      return value.length > 0 ? 'ok' : 'empty';
    })()`
  )
  if (result === 'empty') {
    result = await page.evaluate<string>(
      `(() => {
        const el = ${composerLookupJs()};
        if (!el) return 'no-composer';
        el.focus();
        if (el.isContentEditable) {
          el.textContent = ${JSON.stringify(text)};
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return (el.innerText || el.textContent || '').trim().length > 0 ? 'ok' : 'empty';
        }
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (desc?.set) desc.set.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value.length > 0 ? 'ok' : 'empty';
      })()`
    )
  }
  if (result !== 'ok') throw new WProviderError('Could not type the prompt into the real-browser chat page.')
}

async function externalClickSendButton(page: ExternalDriverPage): Promise<string> {
  const target = await page.evaluate<{ selector: string; x: number; y: number } | null>(
    `(() => {
      const composer = ${composerLookupJs()};
      if (composer) {
        const pending = composer.isContentEditable
          ? (composer.innerText || composer.textContent || '').trim()
          : (composer.value || '').trim();
        if (!pending) return null;
      }
      const selectors = ${JSON.stringify(SEND_BUTTON_SELECTORS)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const disabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('ds-button--disabled'));
        const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && style.pointerEvents !== 'none';
        if (!disabled && visible) {
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const next = el.getBoundingClientRect();
          return { selector: sel, x: Math.round(next.left + next.width / 2), y: Math.round(next.top + next.height / 2) };
        }
      }
      return null;
    })()`
  )
  if (!target) return 'none'
  await page.click(target.x, target.y)
  return target.selector
}

async function runExternalChatTurn(
  id: string,
  service: WProviderService,
  params: WProviderChatParams,
  sender?: WebContents,
  onDelta?: (delta: string) => void
): Promise<ChatResult> {
  const cancelledResult = (): ChatResult => ({ ok: true, content: '', aborted: true })
  if (cancelledOps.has(id)) return cancelledResult()
  if (!(await checkExternalDriverLoggedIn(service))) {
    throw new WProviderError(
      `Not signed in to ${WPROVIDER_SERVICE_INFO[service].label} in the real WProvider browser.`
    )
  }
  if (cancelledOps.has(id)) return cancelledResult()

  const siteSessionKey = `${service}:${params.sessionKey}`
  const sess = sessions.get(siteSessionKey) ?? { chatUrl: null, sent: 0 }
  sessions.set(siteSessionKey, sess)
  const prompt = params.messages
    .slice(sess.sent)
    .filter((message) => message.role === 'system' || message.role === 'user')
    .map((message) => (message.content ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
  if (!prompt) throw new WProviderError('Nothing new to send to the web chat.')
  if (cancelledOps.has(id)) return cancelledResult()

  const page = await ensureExternalWProviderPage(sess.chatUrl ?? serviceChatUrl(service))
  if (cancelledOps.has(id)) return cancelledResult()
  if (sess.chatUrl && (await page.getUrl()) !== sess.chatUrl) await page.navigate(sess.chatUrl)
  if (cancelledOps.has(id)) return cancelledResult()
  const readyDeadline = Date.now() + UI_READY_TIMEOUT_MS
  for (;;) {
    if (cancelledOps.has(id)) return cancelledResult()
    if (await page.evaluate<boolean>(`!!${composerLookupJs()}`).catch(() => false)) break
    if (Date.now() >= readyDeadline) throw new WProviderError('The real-browser chat composer did not become ready.')
    await sleep(500)
  }

  const before = await externalAssistantSnapshot(page, service)
  if (cancelledOps.has(id)) return cancelledResult()
  await externalTypePrompt(page, prompt)
  if (cancelledOps.has(id)) return cancelledResult()

  let abortedResult: ChatResult | null = null
  let lastActivity = Date.now()
  const op: ActiveOp = {
    id,
    service,
    webContentsId: -1,
    sseBuffer: '',
    content: '',
    thinking: '',
    dsCursor: 'skip',
    started: false,
    doneStreams: 0,
    openStreams: 0,
    aborted: false,
    onDelta: (delta) => {
      if (sender && !sender.isDestroyed()) sender.send(IPC.wprovider.chunk, { id, delta })
      onDelta?.(delta)
    },
    finish: (result) => {
      abortedResult = result
    },
    touch: () => {
      lastActivity = Date.now()
    }
  }
  activeOp = op

  const startedAt = Date.now()
  const startDeadline = startedAt + RENDERED_START_TIMEOUT_MS
  let lastText = ''
  let emitted = ''
  let lastChange = Date.now()
  let nextSendAttempt = 0
  let submissionAttempted = false
  try {
    if (activeOp !== op || cancelledOps.has(id)) {
      return abortedResult ?? { ok: true, content: op.content, aborted: true }
    }
    submissionAttempted = true
    try {
      await page.pressEnter()
    } catch (err) {
      if (activeOp !== op || op.aborted || cancelledOps.has(id)) {
        return abortedResult ?? { ok: true, content: op.content, aborted: true }
      }
      throw err
    }
    for (;;) {
      if (activeOp !== op || cancelledOps.has(id)) {
        return abortedResult ?? { ok: true, content: op.content, aborted: true }
      }
      const snapshot = await externalAssistantSnapshot(page, service)
      let text =
        snapshot.count > before.count || (snapshot.text && snapshot.text !== before.text)
          ? snapshot.text
          : ''
      if (text && looksLikePromptEcho(text, prompt)) text = ''

      if (text && text !== lastText) {
        lastText = text
        op.content = text
        op.started = true
        op.touch()
        lastChange = Date.now()
        if (text.startsWith(emitted)) {
          const delta = text.slice(emitted.length)
          emitted = text
          if (delta) op.onDelta(delta)
        } else if (!emitted) {
          emitted = text
          op.onDelta(text)
        } else {
          emitted = text
        }
      }

      if (lastText && Date.now() - lastChange >= RENDERED_DOM_STABLE_MS) break
      if (!lastText && Date.now() >= startDeadline) {
        throw new WProviderError(
          `The prompt was typed but ${WPROVIDER_SERVICE_INFO[service].label} did not render an answer in the real browser.`
        )
      }
      if (Date.now() - lastActivity >= INACTIVITY_TIMEOUT_MS) {
        if (op.content) break
        throw new WProviderError('The real-browser web chat stopped responding.')
      }
      if (Date.now() - startedAt >= HARD_TIMEOUT_MS) throw new WProviderError('The web chat took too long to answer.')
      if (!lastText && Date.now() >= nextSendAttempt) {
        await externalClickSendButton(page).catch(() => 'none')
        nextSendAttempt = Date.now() + 1000
      }
      await sleep(500)
    }

    const url = await page.getUrl().catch(() => '')
    if (url && isProviderChatUrl(service, url)) sess.chatUrl = url
    sess.sent = params.messages.length
    return { ok: true, content: lastText }
  } finally {
    // Once Enter submission has been attempted, an abort must advance the site
    // cursor: the provider may continue processing after the driver page is
    // reloaded. Leaving the old cursor would resend the same prompt next turn.
    if (submissionAttempted && (op.aborted || cancelledOps.has(id))) {
      sess.sent = params.messages.length
    }
    if (activeOp === op) activeOp = null
  }
}

async function runChatTurn(
  id: string,
  service: WProviderService,
  params: WProviderChatParams,
  sender?: WebContents,
  onDelta?: (delta: string) => void
): Promise<ChatResult> {
  if (usesExternalDriver(service)) {
    return runExternalChatTurn(id, service, params, sender, onDelta)
  }
  if (cancelledOps.has(id)) return { ok: true, content: '', aborted: true }
  const { loggedIn } = await checkWProviderNow(service)
  if (cancelledOps.has(id)) return { ok: true, content: '', aborted: true }
  if (!loggedIn) {
    throw new WProviderError(
      `Not signed in to ${WPROVIDER_SERVICE_INFO[service].label}. Open Agent backend settings → Ascora WProvider and sign in.`
    )
  }

  const siteSessionKey = `${service}:${params.sessionKey}`
  const sess = sessions.get(siteSessionKey) ?? { chatUrl: null, sent: 0 }
  sessions.set(siteSessionKey, sess)

  // Only relay what the site hasn't seen: its chat carries its own history.
  // Assistant turns are skipped — they came FROM the site.
  const unsent = params.messages
    .slice(sess.sent)
    .filter((m) => m.role === 'system' || m.role === 'user')
    .map((m) => (m.content ?? '').trim())
    .filter(Boolean)
  const prompt = unsent.join('\n\n')
  if (!prompt) throw new WProviderError('Nothing new to send to the web chat.')

  const win = ensureHiddenWindow()
  await loadChat(win, service, sess.chatUrl ?? serviceChatUrl(service))
  if (cancelledOps.has(id)) return { ok: true, content: '', aborted: true }

  const renderedBefore = usesRenderedDomCapture(service) ? await readAssistantSnapshot(win, service) : null
  await typePrompt(win, prompt)
  if (cancelledOps.has(id)) return { ok: true, content: '', aborted: true }

  const result = await new Promise<ChatResult>((resolve, reject) => {
    let inactivity: NodeJS.Timeout | undefined
    const hardCap = setTimeout(() => fail('The web chat took too long to answer.'), HARD_TIMEOUT_MS)
    const serviceLabel = WPROVIDER_SERVICE_INFO[service].label

    const cleanup = (): void => {
      clearTimeout(hardCap)
      clearTimeout(inactivity)
      if (activeOp?.id === id) activeOp = null
    }
    const fail = (message: string): void => {
      const op = activeOp
      cleanup()
      // Salvage whatever streamed before the stall instead of dropping it.
      if (op && op.content) resolve({ ok: true, content: op.content })
      else reject(new WProviderError(message))
    }
    const touch = (): void => {
      clearTimeout(inactivity)
      inactivity = setTimeout(
        () => fail('The web chat stopped responding mid-answer.'),
        INACTIVITY_TIMEOUT_MS
      )
    }

    activeOp = {
      id,
      service,
      webContentsId: win.webContents.id,
      sseBuffer: '',
      content: '',
      thinking: '',
      dsCursor: 'skip',
      started: false,
      doneStreams: 0,
      openStreams: 0,
      aborted: false,
      onDelta: (delta) => {
        if (sender && !sender.isDestroyed()) sender.send(IPC.wprovider.chunk, { id, delta })
        onDelta?.(delta)
      },
      finish: (r) => {
        cleanup()
        resolve(r)
      },
      touch
    }
    touch()

    void (async () => {
      // The initial chat page creates a site-side conversation only after the
      // current composer control is activated. Retry because the send control
      // swaps state after React processes the textarea input.
      await sleep(250)
      await pressEnter(win)
      if (usesRenderedDomCapture(service)) {
        const text = await waitForRenderedAssistant(
          win,
          service,
          renderedBefore ?? { count: 0, text: '' },
          prompt,
          id
        )
        if (activeOp?.id !== id) return
        if (!text.trim()) {
          fail('The web chat answered, but the reply could not be captured from the page.')
          return
        }
        activeOp.content = text
        finalizeActiveOp()
        return
      }
      const startDeadline = Date.now() + START_TIMEOUT_MS
      let nextSendAttempt = 0
      while (activeOp?.id === id && !activeOp.started) {
        await throwIfProviderBlocked(win, service)
        if (Date.now() > startDeadline) {
          const debug = await readComposerDebug(win)
          fail(
            `The prompt was typed but ${serviceLabel} did not create/start a chat. Diagnostics: ${debug}`
          )
          return
        }
        if (Date.now() >= nextSendAttempt) {
          await clickSendButton(win).catch(() => 'none')
          nextSendAttempt = Date.now() + 1000
        }
        await sleep(300)
      }
    })().catch((err) => fail(err instanceof Error ? err.message : String(err)))
  })

  // Remember the site-side chat so the next turn continues the conversation.
  const url = win.isDestroyed() ? '' : win.webContents.getURL()
  if (url && isProviderChatUrl(service, url)) sess.chatUrl = url
  sess.sent = params.messages.length

  if (result.ok && !result.aborted && !result.content.trim()) {
    // Network tap came up empty — try the rendered page before giving up.
    const domText = await readLastAssistantMessage(win, service)
    if (domText) return { ...result, content: domText }
    return {
      ok: false,
      content: '',
      error:
        'The web chat answered, but the reply could not be captured (stream format may have changed).'
    }
  }
  return result
}
