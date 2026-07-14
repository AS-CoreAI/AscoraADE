import { app, type Session } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'
import { createServer } from 'node:net'

/**
 * Visible sign-in broker for WProvider.
 *
 * Provider login pages are opened in a stock installed Chrome/Edge process,
 * using a dedicated persistent profile owned by Ascora. Google therefore sees
 * a real supported browser for the whole popup/redirect flow. Once the target
 * provider renders its signed-in chat, only that provider's cookies and web
 * storage are copied into Electron's private WProvider partition.
 *
 * The DevTools endpoint is bound to loopback, exists only while the dedicated
 * external browser is running, and is never exposed to the renderer process.
 */

const AUTH_TIMEOUT_MS = 10 * 60_000
const START_TIMEOUT_MS = 20_000
const NAVIGATION_TIMEOUT_MS = 20_000
const BROWSER_CLOSE_TIMEOUT_MS = 4_000
const BROWSER_KILL_TIMEOUT_MS = 2_000
const POLL_MS = 700

interface CdpError {
  code: number
  message: string
}

interface CdpEnvelope {
  id?: number
  result?: unknown
  error?: CdpError
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

class CdpClient {
  private readonly pending = new Map<number, PendingCommand>()
  private nextId = 1

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      let message: CdpEnvelope
      try {
        message = JSON.parse(event.data) as CdpEnvelope
      } catch {
        return
      }
      if (typeof message.id !== 'number') return
      const command = this.pending.get(message.id)
      if (!command) return
      this.pending.delete(message.id)
      clearTimeout(command.timer)
      if (message.error) {
        command.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`))
      } else {
        command.resolve(message.result)
      }
    })
    const failPending = (): void => {
      for (const command of this.pending.values()) {
        clearTimeout(command.timer)
        command.reject(new Error('The external browser connection was closed.'))
      }
      this.pending.clear()
    }
    socket.addEventListener('close', failPending)
    socket.addEventListener('error', failPending)
  }

  static connect(url: string, timeoutMs = 8000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('Timed out connecting to the external browser.'))
      }, timeoutMs)
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve(new CdpClient(socket))
        },
        { once: true }
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error('Could not connect to the external browser.'))
        },
        { once: true }
      )
    })
  }

  command<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('The external browser connection is not open.'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close()
    }
  }
}

interface DevToolsVersion {
  webSocketDebuggerUrl?: string
}

interface DevToolsTarget {
  id: string
  type: string
  url: string
  title: string
  webSocketDebuggerUrl?: string
}

interface RemoteObject {
  value?: unknown
  description?: string
}

interface EvaluateResult {
  result: RemoteObject
  exceptionDetails?: { text?: string; exception?: RemoteObject }
}

export interface ExternalAuthPage {
  url: string
  evaluate<T>(expression: string): Promise<T>
}

export interface ExternalDriverPage extends ExternalAuthPage {
  getUrl(): Promise<string>
  navigate(url: string): Promise<void>
  insertText(text: string): Promise<void>
  pressEnter(): Promise<void>
  click(x: number, y: number): Promise<void>
  reload(): Promise<void>
}

export interface ExternalAuthCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  expires?: number
  session?: boolean
}

export interface ExternalAuthStorage {
  local: Record<string, string>
  session: Record<string, string>
}

export interface ExternalAuthState {
  url: string
  cookies: ExternalAuthCookie[]
  storage: ExternalAuthStorage
}

interface ExternalAuthOptions {
  startUrl: string
  providerLabel: string
  cookieDomains: string[]
  isSignedIn: (page: ExternalAuthPage) => Promise<boolean>
}

interface BrowserLaunch {
  child: ChildProcess
  port: number
  browserWebSocketUrl: string
}

interface PageNavigateResult {
  errorText?: string
}

let activeLaunch: BrowserLaunch | null = null
let activeDriverTargetId: string | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function childExited(child: ChildProcess): boolean {
  return child.pid == null || child.exitCode != null || child.signalCode != null
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = (): void => finish(true)
    const timer = setTimeout(() => finish(childExited(child)), timeoutMs)
    child.once('exit', onExit)
  })
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (childExited(child)) return
  try {
    child.kill()
  } catch {
    /* Fall through to the forceful termination attempt. */
  }
  if (await waitForChildExit(child, BROWSER_KILL_TIMEOUT_MS)) return
  try {
    child.kill('SIGKILL')
  } catch {
    /* The process may have exited between the check and the signal. */
  }
  if (!(await waitForChildExit(child, BROWSER_KILL_TIMEOUT_MS))) {
    console.warn(`[wprovider] Could not terminate external browser process ${child.pid ?? 'unknown'}.`)
  }
}

function browserProfileFamily(executable: string): string {
  const name = basename(executable).toLowerCase()
  if (name.includes('edge')) return 'edge'
  if (name.includes('chromium')) return 'chromium'
  return 'chrome'
}

function normalizedUrl(value: string): string | null {
  try {
    return new URL(value).href
  } catch {
    return null
  }
}

function hasOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin
  } catch {
    return false
  }
}

function executableOnPath(names: string[]): string | null {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    for (const name of names) {
      for (const extension of extensions) {
        const candidate = join(directory, `${name}${extension}`)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

function findBrowserExecutable(): string | null {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    for (const root of [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA
    ]) {
      if (!root) continue
      candidates.push(
        join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      )
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      join(process.env.HOME ?? '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    )
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return executableOnPath([
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge-stable',
    'msedge'
  ])
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a browser debugging port.'))
        return
      }
      const { port } = address
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function fetchJson<T>(url: string, timeoutMs = 2000): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function waitForDevTools(port: number, child: ChildProcess): Promise<string> {
  const deadline = Date.now() + START_TIMEOUT_MS
  for (;;) {
    try {
      const version = await fetchJson<DevToolsVersion>(`http://127.0.0.1:${port}/json/version`)
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl
    } catch {
      /* Chrome is still starting. */
    }
    if (childExited(child)) {
      throw new Error(
        'The real browser exited before sign-in opened. Close any old “Ascora WProvider Browser” window and try again.'
      )
    }
    if (Date.now() >= deadline) throw new Error('Timed out starting the real browser for WProvider sign-in.')
    await sleep(200)
  }
}

interface StartBrowserOptions {
  /** Park the window far off-screen: unattended chat/status turns must not pop
   *  a maximized browser at the user. Sign-in stays visible (interactive). */
  background?: boolean
}

async function startBrowser(url: string, options: StartBrowserOptions = {}): Promise<BrowserLaunch> {
  await closeActiveBrowser()
  const executable = findBrowserExecutable()
  if (!executable) {
    throw new Error('Google Chrome or Microsoft Edge was not found. Install one and try WProvider sign-in again.')
  }
  const port = await reserveLoopbackPort()
  const browserFamily = browserProfileFamily(executable)
  const profile = join(
    app.getPath('userData'),
    // Keep the original Chrome profile name so an already completed sign-in
    // survives this upgrade; other browser engines get isolated profiles.
    browserFamily === 'chrome' ? 'wprovider-browser-profile' : `wprovider-browser-profile-${browserFamily}`
  )
  mkdirSync(profile, { recursive: true })
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      ...(options.background
        ? [
            // Off-screen instead of headless/minimized: the fingerprint stays
            // that of a normal windowed Chrome (Cloudflare), and the page is
            // not occlusion-throttled while it streams.
            '--window-position=-32000,-32000',
            '--window-size=1280,900',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling'
          ]
        : ['--start-maximized']),
      '--new-window',
      url
    ],
    {
      detached: false,
      stdio: 'ignore',
      windowsHide: false
    }
  )
  child.on('error', (error) => {
    console.warn(`[wprovider] External browser process error: ${error.message}`)
  })
  let rejectSpawnError: (error: Error) => void = () => undefined
  const spawnError = new Promise<never>((_resolve, reject) => {
    rejectSpawnError = reject
  })
  const onSpawnError = (error: Error): void => {
    rejectSpawnError(new Error(`Could not launch the external browser: ${error.message}`, { cause: error }))
  }
  child.once('error', onSpawnError)
  try {
    const browserWebSocketUrl = await Promise.race([
      waitForDevTools(port, child),
      spawnError
    ])
    const launch = { child, port, browserWebSocketUrl }
    activeLaunch = launch
    return launch
  } catch (error) {
    await terminateChild(child)
    throw error
  } finally {
    child.removeListener('error', onSpawnError)
  }
}

async function listTargets(port: number): Promise<DevToolsTarget[]> {
  return fetchJson<DevToolsTarget[]>(`http://127.0.0.1:${port}/json/list`)
}

async function evaluateTarget<T>(target: DevToolsTarget, expression: string): Promise<T> {
  if (!target.webSocketDebuggerUrl) throw new Error('The provider tab has no debugger endpoint.')
  const client = await CdpClient.connect(target.webSocketDebuggerUrl)
  try {
    const result = await client.command<EvaluateResult>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      const message =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Page evaluation failed.'
      throw new Error(message)
    }
    return result.result.value as T
  } finally {
    client.close()
  }
}

async function targetCommand<T>(
  target: DevToolsTarget,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  if (!target.webSocketDebuggerUrl) throw new Error('The provider tab has no debugger endpoint.')
  const client = await CdpClient.connect(target.webSocketDebuggerUrl)
  try {
    return await client.command<T>(method, params)
  } finally {
    client.close()
  }
}

function externalPage(target: DevToolsTarget): ExternalAuthPage {
  return {
    url: target.url,
    evaluate: <T>(expression: string): Promise<T> => evaluateTarget<T>(target, expression)
  }
}

async function targetById(launch: BrowserLaunch, id: string): Promise<DevToolsTarget> {
  const target = (await listTargets(launch.port)).find((candidate) => candidate.id === id)
  if (!target) throw new Error('The real-browser provider tab was closed.')
  return target
}

async function targetDocumentReady(target: DevToolsTarget): Promise<boolean> {
  return evaluateTarget<string>(target, 'document.readyState')
    .then((state) => state === 'interactive' || state === 'complete')
    .catch(() => false)
}

async function navigateTarget(launch: BrowserLaunch, targetId: string, url: string): Promise<void> {
  const requestedUrl = normalizedUrl(url)
  if (!requestedUrl) throw new Error(`Invalid provider navigation URL: ${url}`)

  const target = await targetById(launch, targetId)
  if (normalizedUrl(target.url) === requestedUrl && (await targetDocumentReady(target))) return

  const result = await targetCommand<PageNavigateResult>(target, 'Page.navigate', { url })
  if (result.errorText) {
    throw new Error(`The real browser could not navigate to ${url}: ${result.errorText}`)
  }

  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS
  let lastUrl = target.url
  for (;;) {
    const refreshed = await targetById(launch, targetId)
    lastUrl = refreshed.url
    if (normalizedUrl(refreshed.url) === requestedUrl && (await targetDocumentReady(refreshed))) return
    if (Date.now() >= deadline) {
      throw new Error(`Timed out navigating the real browser to ${url}. Current URL: ${lastUrl}`)
    }
    await sleep(150)
  }
}

function externalDriverPage(launch: BrowserLaunch, initialTarget: DevToolsTarget): ExternalDriverPage {
  const targetId = initialTarget.id
  activeDriverTargetId = targetId
  const current = (): Promise<DevToolsTarget> => targetById(launch, targetId)
  return {
    url: initialTarget.url,
    getUrl: async (): Promise<string> => (await current()).url,
    evaluate: async <T>(expression: string): Promise<T> => evaluateTarget<T>(await current(), expression),
    navigate: async (url: string): Promise<void> => {
      await navigateTarget(launch, targetId, url)
    },
    insertText: async (text: string): Promise<void> => {
      await targetCommand(await current(), 'Input.insertText', { text })
    },
    pressEnter: async (): Promise<void> => {
      const target = await current()
      await targetCommand(target, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      })
      await targetCommand(await current(), 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      })
    },
    click: async (x: number, y: number): Promise<void> => {
      const target = await current()
      await targetCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await targetCommand(await current(), 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1
      })
      await targetCommand(await current(), 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1
      })
    },
    reload: async (): Promise<void> => {
      await targetCommand(await current(), 'Page.reload', { ignoreCache: false })
    }
  }
}

async function createTarget(launch: BrowserLaunch, url: string): Promise<DevToolsTarget> {
  const client = await CdpClient.connect(launch.browserWebSocketUrl)
  let id: string
  try {
    const result = await client.command<{ targetId: string }>('Target.createTarget', { url })
    id = result.targetId
  } finally {
    client.close()
  }
  const deadline = Date.now() + 15_000
  for (;;) {
    const target = (await listTargets(launch.port)).find((candidate) => candidate.id === id)
    if (target?.webSocketDebuggerUrl) return target
    if (Date.now() >= deadline) throw new Error('Timed out opening the provider in the real browser.')
    await sleep(150)
  }
}

export async function ensureExternalWProviderPage(url: string): Promise<ExternalDriverPage> {
  let launch = activeLaunch
  if (!launch) {
    launch = await startBrowser(url, { background: true })
  }
  let targets: DevToolsTarget[]
  try {
    targets = await listTargets(launch.port)
  } catch {
    launch = await startBrowser(url, { background: true })
    targets = await listTargets(launch.port)
  }
  const origin = new URL(url).origin
  const matchingTargets = targets.filter(
    (candidate) =>
      candidate.type === 'page' &&
      Boolean(candidate.webSocketDebuggerUrl) &&
      hasOrigin(candidate.url, origin)
  )
  let target = activeDriverTargetId
    ? matchingTargets.find((candidate) => candidate.id === activeDriverTargetId)
    : undefined
  target ??= matchingTargets[0]
  if (!target && activeDriverTargetId) {
    target = targets.find(
      (candidate) =>
        candidate.id === activeDriverTargetId &&
        candidate.type === 'page' &&
        Boolean(candidate.webSocketDebuggerUrl)
    )
    if (target) {
      await navigateTarget(launch, target.id, url)
      target = await targetById(launch, target.id)
    }
  }
  if (!target) target = await createTarget(launch, url)
  return externalDriverPage(launch, target)
}

export async function reloadActiveExternalPage(): Promise<void> {
  const launch = activeLaunch
  const targetId = activeDriverTargetId
  if (!launch || !targetId) return
  try {
    const target = await targetById(launch, targetId)
    await targetCommand(target, 'Page.reload')
  } catch {
    /* The external browser may already be closed. */
  }
}

function domainAllowed(domain: string, allowedDomains: string[]): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase()
  return allowedDomains.some((allowed) => {
    const suffix = allowed.replace(/^\./, '').toLowerCase()
    return normalized === suffix || normalized.endsWith(`.${suffix}`)
  })
}

async function readCookies(
  browserWebSocketUrl: string,
  allowedDomains: string[]
): Promise<ExternalAuthCookie[]> {
  const client = await CdpClient.connect(browserWebSocketUrl)
  try {
    const result = await client.command<{ cookies: ExternalAuthCookie[] }>('Storage.getCookies')
    return result.cookies.filter((cookie) => domainAllowed(cookie.domain, allowedDomains))
  } finally {
    client.close()
  }
}

async function readStorage(target: DevToolsTarget): Promise<ExternalAuthStorage> {
  return evaluateTarget<ExternalAuthStorage>(
    target,
    `(() => {
      const entries = (storage) => {
        const out = {};
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key != null) out[key] = storage.getItem(key) || '';
        }
        return out;
      };
      return { local: entries(window.localStorage), session: entries(window.sessionStorage) };
    })()`
  ).catch(() => ({ local: {}, session: {} }))
}

async function closeLaunch(launch: BrowserLaunch): Promise<void> {
  if (childExited(launch.child)) return
  let closeRequested = false
  try {
    const client = await CdpClient.connect(launch.browserWebSocketUrl, 1500)
    try {
      closeRequested = true
      await client.command('Browser.close', {}, 2500).catch(() => undefined)
    } finally {
      client.close()
    }
  } catch {
    /* The user may already have closed the browser. */
  }
  if (
    closeRequested &&
    (await waitForChildExit(launch.child, BROWSER_CLOSE_TIMEOUT_MS))
  ) {
    return
  }
  await terminateChild(launch.child)
}

export async function closeActiveBrowser(): Promise<void> {
  const launch = activeLaunch
  activeLaunch = null
  activeDriverTargetId = null
  if (launch) await closeLaunch(launch)
}

export async function runExternalWProviderLogin(options: ExternalAuthOptions): Promise<ExternalAuthState> {
  const launch = await startBrowser(options.startUrl)
  const deadline = Date.now() + AUTH_TIMEOUT_MS
  let lastProbeError = ''
  let completed = false
  try {
    for (;;) {
      let targets: DevToolsTarget[] = []
      try {
        targets = (await listTargets(launch.port)).filter(
          (target) => target.type === 'page' && Boolean(target.webSocketDebuggerUrl)
        )
      } catch (error) {
        if (childExited(launch.child)) {
          throw new Error(`The ${options.providerLabel} sign-in browser was closed before login completed.`)
        }
        lastProbeError = error instanceof Error ? error.message : String(error)
      }

      for (const target of targets) {
        try {
          if (!(await options.isSignedIn(externalPage(target)))) continue
          const [cookies, storage] = await Promise.all([
            readCookies(launch.browserWebSocketUrl, options.cookieDomains),
            readStorage(target)
          ])
          activeDriverTargetId = target.id
          completed = true
          return { url: target.url, cookies, storage }
        } catch (error) {
          lastProbeError = error instanceof Error ? error.message : String(error)
        }
      }

      if (Date.now() >= deadline) {
        const suffix = lastProbeError ? ` Last browser probe: ${lastProbeError}` : ''
        throw new Error(`${options.providerLabel} sign-in timed out.${suffix}`)
      }
      await sleep(POLL_MS)
    }
  } finally {
    if (!completed) {
      if (activeLaunch === launch) activeLaunch = null
      await closeLaunch(launch)
    }
  }
}

function electronSameSite(
  value: ExternalAuthCookie['sameSite']
): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  if (value === 'None') return 'no_restriction'
  if (value === 'Strict') return 'strict'
  if (value === 'Lax') return 'lax'
  return 'unspecified'
}

export async function importExternalCookies(
  target: Session,
  cookies: ExternalAuthCookie[]
): Promise<{ imported: number; failed: number }> {
  let imported = 0
  let failed = 0
  for (const cookie of cookies) {
    const host = cookie.domain.replace(/^\./, '')
    const path = cookie.path || '/'
    try {
      await target.cookies.set({
        url: `${cookie.secure ? 'https' : 'http'}://${host}${path}`,
        name: cookie.name,
        value: cookie.value,
        ...(cookie.domain.startsWith('.') && !cookie.name.startsWith('__Host-')
          ? { domain: cookie.domain }
          : {}),
        path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: electronSameSite(cookie.sameSite),
        ...(!cookie.session && typeof cookie.expires === 'number' && cookie.expires > 0
          ? { expirationDate: cookie.expires }
          : {})
      })
      imported += 1
    } catch {
      failed += 1
    }
  }
  await target.cookies.flushStore()
  return { imported, failed }
}

let quitCleanup: Promise<void> | null = null
let allowQuitAfterBrowserCleanup = false

app.on('before-quit', (event) => {
  if (allowQuitAfterBrowserCleanup || !activeLaunch) return
  event.preventDefault()
  if (quitCleanup) return
  quitCleanup = closeActiveBrowser()
  void quitCleanup
    .catch((error) => {
      console.warn(`[wprovider] External browser quit cleanup failed: ${String(error)}`)
    })
    .finally(() => {
      allowQuitAfterBrowserCleanup = true
      app.quit()
    })
})
