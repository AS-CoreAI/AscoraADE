import { BrowserWindow, ipcMain, session, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import {
  IPC,
  WPROVIDER_SERVICE_INFO,
  type ChatResult,
  type WProviderChatParams,
  type WProviderCheckResult,
  type WProviderLoginResult,
  type WProviderService
} from '@shared/ipc'

/**
 * Ascora WProvider — an "API emulator" that drives a provider's web chat
 * inside an offscreen Electron BrowserWindow:
 *
 *  1. The user signs in once in a VISIBLE window; the login lives in a
 *     persistent session partition, so the hidden window inherits it.
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
/** Serializes chat turns — one hidden browser, one generation at a time. */
let queue: Promise<unknown> = Promise.resolve()
const sessions = new Map<string, ChatSession>()
let netListenerInstalled = false

function serviceOrigin(service: WProviderService): string {
  return WPROVIDER_SERVICE_INFO[service].origin
}

function wpSession(): Session {
  const ses = session.fromPartition(PARTITION)
  // Strip the Electron/app tokens: some SSO providers (Google) refuse logins
  // from user agents they classify as embedded browsers.
  const ua = ses
    .getUserAgent()
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\sascora-ade\/[\d.]+/i, '')
  if (ua !== ses.getUserAgent()) ses.setUserAgent(ua)
  return ses
}

/**
 * @param withTap Patch window.fetch/XHR to tap chat-completion streams. Only
 *   the hidden driver window needs this — bot-management on these sites
 *   commonly fingerprints a hooked fetch (toString() no longer native) or a
 *   disabled context isolation, so the visible sign-in window is kept as
 *   close to a stock Chromium tab as possible. Without this, DeepSeek's login
 *   modal was closing itself into a "verifying" challenge before sign-in
 *   could complete.
 */
function createWindow(show: boolean, withTap = true): BrowserWindow {
  wpSession() // make sure the partition exists with the cleaned UA
  const win = new BrowserWindow({
    show,
    width: 1180,
    height: 840,
    title: 'Ascora WProvider',
    autoHideMenuBar: true,
    webPreferences: withTap
      ? {
          partition: PARTITION,
          preload: join(__dirname, '../preload/wprovider.js'),
          // The preload must patch the PAGE's window.fetch, so no isolation here.
          // Nothing is exposed to the page — ipcRenderer stays in the preload's
          // closure — and the window only ever navigates to the provider's site.
          contextIsolation: false,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      : {
          partition: PARTITION,
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: false
        }
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
 * APPEND; SET/PATCH re-send state the page already rendered and are never
 * emitted (a missed answer still surfaces through the DOM fallback).
 */
function extractDeepSeekDeltas(
  op: ActiveOp,
  json: Record<string, unknown>
): { text: string; phase?: string }[] {
  const out: { text: string; phase?: string }[] = []
  const emit = (text: string, phase: DeepSeekPhase): void => {
    if (!text || phase === 'skip') return
    out.push({ text, phase: phase === 'think' ? 'think' : undefined })
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
      return
    }
    if (oper === 'APPEND') appendFragment(payload, path)
  }

  // A fragment appended to "response/fragments" carries the text type (THINK /
  // RESPONSE / ...); bare token frames that follow extend that fragment.
  const appendFragment = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) appendFragment(item, path)
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
        emit(text, phase)
        return
      }
    }
    if (obj.v !== undefined) appendFragment(obj.v, path)
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

async function runJs<T>(win: BrowserWindow, code: string): Promise<T> {
  return (await win.webContents.executeJavaScript(code, true)) as T
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
  'textarea[placeholder*="DeepSeek" i]',
  'textarea[name="search"]',
  'textarea.message-input-textarea',
  '#message-input-container textarea',
  'textarea[placeholder]',
  'textarea'
]

const SEND_BUTTON_SELECTORS = [
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
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.disabled && el.offsetParent !== null) return el;
      if (el && !el.disabled) return el;
    }
    return null;
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
      const snapshot = {
        url: location.href,
        readyState: document.readyState,
        hasMain: Boolean(document.querySelector('main')),
        hasRoot: Boolean(document.querySelector('#root')),
        activeElement: document.activeElement
          ? {
              tagName: document.activeElement.tagName,
              className: document.activeElement.className || '',
              id: document.activeElement.id || ''
            }
          : null,
        bodyText: (document.body?.innerText || '').trim().slice(0, 180),
        textareas,
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
  return win.webContents.getURL().startsWith(serviceOrigin(service))
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

/** Set the composer's value the React-safe way and confirm it stuck. */
async function typePrompt(win: BrowserWindow, text: string): Promise<void> {
  const focusResult = await runJs<string>(
    win,
    `(() => {
      const ta = ${composerLookupJs()};
      if (!ta) return 'no-composer';
      ta.focus();
      const proto = Object.getPrototypeOf(ta);
      const desc =
        Object.getOwnPropertyDescriptor(proto, 'value') ||
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(ta, '');
      else ta.value = '';
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
      return document.activeElement === ta ? 'ok' : 'not-focused';
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
      const ta = ${composerLookupJs()};
      if (!ta) return 'no-composer';
      return ta.value.length > 0 ? 'ok' : 'empty';
    })()`
  )

  if (result === 'empty') {
    result = await runJs<string>(
      win,
      `(() => {
        const ta = ${composerLookupJs()};
        if (!ta) return 'no-composer';
        ta.focus();
        const proto = Object.getPrototypeOf(ta);
        const desc =
          Object.getOwnPropertyDescriptor(proto, 'value') ||
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(ta, ${JSON.stringify(text)});
        else ta.value = ${JSON.stringify(text)};
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return ta.value.length > 0 ? 'ok' : 'empty';
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
 * DOM fallback for the final answer, used only when the network tap saw the
 * request but produced no text (site changed its stream format). Long code
 * blocks may be truncated here — Monaco only renders visible lines.
 */
async function readLastAssistantMessage(win: BrowserWindow, service: WProviderService): Promise<string> {
  const selector =
    service === 'deepseek'
      ? '.ds-assistant-message-main-content, .ds-message .ds-markdown, [class*="assistant"] [class*="markdown"]'
      : '.qwen-chat-message-assistant .custom-qwen-markdown, .qwen-chat-message-assistant, [class*="message-assistant"]'
  return runJs<string>(
    win,
    `(() => {
      const nodes = document.querySelectorAll(${JSON.stringify(selector)});
      const last = nodes[nodes.length - 1];
      return last ? (last.innerText || '').trim() : '';
    })()`
  ).catch(() => '')
}

function isProviderChatUrl(service: WProviderService, url: string): boolean {
  if (!url.startsWith(serviceOrigin(service))) return false
  return service === 'deepseek' ? /\/a\/chat\/s\//.test(url) : /\/c\//.test(url)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------- public surface ----------------

export async function checkWProvider(service: WProviderService): Promise<WProviderCheckResult> {
  try {
    if (service === 'deepseek') {
      return { ok: true, service, loggedIn: await checkDeepSeekLoggedIn() }
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

/**
 * Open a visible window on the provider's site so the user can sign in, and
 * resolve once credentials are usable by the chat composer (or the user closes
 * the window).
 */
export async function loginWProvider(service: WProviderService): Promise<WProviderLoginResult> {
  if (authWin && !authWin.isDestroyed()) {
    authWin.focus()
    return { ok: true, loggedIn: (await checkWProvider(service)).loggedIn }
  }
  authWin = createWindow(true, false)
  const win = authWin
  win.on('closed', () => {
    authWin = null
  })
  try {
    await loadURLBestEffort(win, serviceOrigin(service), 15_000)
  } catch {
    /* keep the window open anyway — the user may retry inside it */
  }

  return new Promise<WProviderLoginResult>((resolve) => {
    let settled = false
    let probing = false
    const settle = (result: WProviderLoginResult): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      resolve(result)
    }
    const timer = setInterval(() => {
      if (probing) return
      probing = true
      void (async () => {
        try {
          if (win.isDestroyed()) {
            settle({ ok: true, loggedIn: (await checkWProvider(service)).loggedIn })
            return
          }
          const loggedIn =
            service === 'deepseek'
              ? await isDeepSeekPromptReady(win, 8000)
              : (await checkWProvider(service)).loggedIn
          if (loggedIn) {
            if (service !== 'deepseek' && !win.isDestroyed()) win.close()
            settle({ ok: true, loggedIn: true })
          }
        } finally {
          probing = false
        }
      })()
    }, 1500)
    win.on('closed', () => {
      void checkWProvider(service).then((r) => settle({ ok: true, loggedIn: r.loggedIn }))
    })
    // Don't hold the IPC promise hostage forever.
    setTimeout(() => settle({ ok: true, loggedIn: false }), 10 * 60_000)
  })
}

export async function logoutWProvider(service: WProviderService): Promise<WProviderCheckResult> {
  try {
    if (hiddenWin && !hiddenWin.isDestroyed()) hiddenWin.destroy()
    hiddenWin = null
    sessions.clear()
    await wpSession().clearStorageData()
    return { ok: true, service, loggedIn: false }
  } catch (err) {
    return { ok: false, service, loggedIn: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function abortWProvider(id: string): void {
  const op = activeOp
  if (!op || op.id !== id) return
  op.aborted = true
  // Reloading the page tears down the site's fetch, which stops our tap too;
  // finalize immediately so the renderer isn't left waiting.
  finalizeActiveOp()
  if (hiddenWin && !hiddenWin.isDestroyed()) {
    hiddenWin.webContents.reload()
  }
}

export function chatWProvider(
  id: string,
  service: WProviderService,
  params: WProviderChatParams,
  sender: WebContents
): Promise<ChatResult> {
  installNetListener()
  const turn = queue.then(() => runChatTurn(id, service, params, sender))
  // Keep the queue alive even when a turn fails.
  queue = turn.catch(() => undefined)
  return turn.catch((err) => ({
    ok: false,
    content: '',
    error: err instanceof Error ? err.message : String(err)
  }))
}

async function runChatTurn(
  id: string,
  service: WProviderService,
  params: WProviderChatParams,
  sender: WebContents
): Promise<ChatResult> {
  const { loggedIn } = await checkWProvider(service)
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
  const origin = serviceOrigin(service)
  await loadChat(win, service, sess.chatUrl ?? `${origin}/`)

  await typePrompt(win, prompt)

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
        if (!sender.isDestroyed()) sender.send(IPC.wprovider.chunk, { id, delta })
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
