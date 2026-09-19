import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  type WriteStream
} from 'node:fs'
import { cp } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createConnection, createServer } from 'node:net'
import { dirname, join } from 'node:path'
import type { OmnirouteStatus } from '../../shared/ipc'
import { getStore } from '../store'

/**
 * Lifecycle manager for the bundled OmniRoute gateway sidecar.
 *
 * The vendored npm tree (scripts/omniroute/vendor.mjs → extraResources) is
 * spawned through our own Electron binary with ELECTRON_RUN_AS_NODE, bound to
 * loopback only, and supervised here: health-gated startup, log capture,
 * crash restarts with backoff, and a hard kill on quit.
 *
 * ENV PINS MUST STAY IN SYNC with scripts/omniroute/env.mjs — the smoke test
 * boots the sidecar exactly like this module does.
 */

const PORT_CANDIDATES = [20128, 20129, 20130, 20131, 20132]
const HEALTH_INTERVAL_MS = 250
const HEALTH_PROBE_TIMEOUT_MS = 2000
/** Upstream's own first-boot window: initial migrations can take minutes. */
const BOOT_BUDGET_MS = 180_000
const RESTART_BACKOFF_MS = [2_000, 10_000, 30_000]
const RESTART_WINDOW_MS = 10 * 60_000
const MAX_RESTARTS_PER_WINDOW = 3
const LOG_ROTATE_BYTES = 5 * 1024 * 1024
const RING_LINES = 200

type Phase = 'stopped' | 'starting' | 'ready' | 'error'

interface Sidecar {
  phase: Phase
  child: ChildProcessWithoutNullStreams | null
  port: number | null
  version: string | null
  error: string | null
  startAttemptAt: number
  intentionalStop: boolean
  startPromise: Promise<OmnirouteStatus> | null
  stopPromise: Promise<void> | null
  restartTimer: NodeJS.Timeout | null
  restartTimestamps: number[]
  ring: string[]
  logStream: WriteStream | null
  logBytes: number
}

const sidecar: Sidecar = {
  phase: 'stopped',
  child: null,
  port: null,
  version: null,
  error: null,
  startAttemptAt: 0,
  intentionalStop: false,
  startPromise: null,
  stopPromise: null,
  restartTimer: null,
  restartTimestamps: [],
  ring: [],
  logStream: null,
  logBytes: 0
}

const listeners = new Set<(status: OmnirouteStatus) => void>()

// ---------------------------------------------------------------------------
// Paths and manifest
// ---------------------------------------------------------------------------

function omnirouteRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'omniroute')
    : join(app.getAppPath(), '.build', 'omniroute')
}

function dataRoot(): string {
  return join(app.getPath('userData'), 'omniroute')
}

interface VendorManifest {
  version: string
  entry: string
}

function readManifest(): VendorManifest | null {
  try {
    const raw = readFileSync(join(omnirouteRoot(), 'VENDOR_MANIFEST.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<VendorManifest>
    if (typeof parsed.version === 'string' && typeof parsed.entry === 'string') {
      return { version: parsed.version, entry: parsed.entry }
    }
  } catch {
    /* not vendored / packaged without the resource tree */
  }
  return null
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function currentStatus(): OmnirouteStatus {
  return {
    state: sidecar.phase,
    port: sidecar.phase === 'starting' || sidecar.phase === 'ready' ? sidecar.port : null,
    baseUrl: sidecar.phase === 'ready' && sidecar.port ? `http://127.0.0.1:${sidecar.port}/v1` : null,
    version: sidecar.version ?? readManifest()?.version ?? null,
    logsPath: logDir(),
    error: sidecar.phase === 'error' ? (sidecar.error ?? 'unknown error') : undefined,
    startingForMs: sidecar.phase === 'starting' ? Date.now() - sidecar.startAttemptAt : undefined
  }
}

function emitStatus(): void {
  const status = currentStatus()
  for (const listener of listeners) {
    try {
      listener(status)
    } catch {
      /* renderer gone */
    }
  }
}

function setPhase(phase: Phase, error?: string): void {
  sidecar.phase = phase
  sidecar.error = error ?? null
  emitStatus()
}

export function getOmnirouteStatus(): OmnirouteStatus {
  return currentStatus()
}

/** OpenAI-compatible base URL, or '' while the sidecar is not ready. */
export function getOmnirouteBaseUrl(): string {
  return sidecar.phase === 'ready' && sidecar.port ? `http://127.0.0.1:${sidecar.port}/v1` : ''
}

export function onOmnirouteStatusChanged(listener: (status: OmnirouteStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logDir(): string {
  return join(dataRoot(), 'logs')
}

export function getOmnirouteLogDir(): string {
  return logDir()
}

function openLog(): void {
  try {
    mkdirSync(logDir(), { recursive: true })
    const logPath = join(logDir(), 'omniroute.log')
    let size = 0
    try {
      size = statSync(logPath).size
    } catch {
      /* no log yet */
    }
    if (size > LOG_ROTATE_BYTES) rotateLog(logPath)
    sidecar.logStream = createWriteStream(logPath, { flags: 'a' })
    sidecar.logBytes = size
  } catch {
    sidecar.logStream = null
  }
}

function rotateLog(logPath: string): void {
  try {
    rmSync(`${logPath}.1`, { force: true })
    renameSync(logPath, `${logPath}.1`)
  } catch {
    /* rotation is best-effort */
  }
}

function closeLog(): void {
  sidecar.logStream?.end()
  sidecar.logStream = null
}

function captureOutput(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line.trim()) continue
    sidecar.ring.push(line)
    if (sidecar.ring.length > RING_LINES) sidecar.ring.splice(0, sidecar.ring.length - RING_LINES)
  }
  const stream = sidecar.logStream
  if (stream) {
    stream.write(chunk)
    sidecar.logBytes += Buffer.byteLength(chunk)
    if (sidecar.logBytes > LOG_ROTATE_BYTES) {
      closeLog()
      rotateLog(join(logDir(), 'omniroute.log'))
      openLog()
    }
  }
}

function ringTail(lines: number): string {
  return sidecar.ring.slice(-lines).join('\n')
}

// ---------------------------------------------------------------------------
// Port selection
// ---------------------------------------------------------------------------

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}

/** Windows can occasionally allow a loopback bind probe while a wildcard
 * listener already owns the same port. An active connect catches that case. */
function hasListener(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

async function isPortFree(port: number): Promise<boolean> {
  return !(await hasListener(port)) && (await canBind(port))
}

async function pickPort(): Promise<number> {
  const saved = getStore().getSetting<number>('omniroute.port')
  const candidates = [
    ...(typeof saved === 'number' && Number.isInteger(saved) && saved > 0 ? [saved] : []),
    ...PORT_CANDIDATES
  ]
  for (const port of candidates) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`no free loopback port among ${candidates.join(', ')}`)
}

// ---------------------------------------------------------------------------
// Start / supervise
// ---------------------------------------------------------------------------

function storageKey(): string {
  const store = getStore()
  const existing = store.getSetting<string>('omniroute.storageKey')
  if (typeof existing === 'string' && existing.length >= 32) return existing
  const key = randomBytes(32).toString('hex')
  store.setSetting('omniroute.storageKey', key)
  return key
}

/** One-time data backup when the bundled OmniRoute version changes. */
async function backupDataOnVersionChange(version: string): Promise<void> {
  const store = getStore()
  const last = store.getSetting<string>('omniroute.lastVersion')
  if (last && last !== version) {
    const dataDir = join(dataRoot(), 'data')
    const backupDir = join(dataRoot(), `data-backup-${last}`)
    if (existsSync(dataDir) && !existsSync(backupDir)) {
      try {
        await cp(dataDir, backupDir, { recursive: true })
      } catch {
        /* best-effort safety net */
      }
    }
  }
  if (last !== version) store.setSetting('omniroute.lastVersion', version)
}

// KEEP IN SYNC with scripts/omniroute/env.mjs (omnirouteEnvPins) — every env
// var is pinned explicitly because upstream defaults drift between releases.
function sidecarEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Node mode applies to the child (and any grandchildren it forks with
    // process.execPath) only — never to our own GUI process.
    ELECTRON_RUN_AS_NODE: '1',
    OMNIROUTE_SERVER_HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    OMNIROUTE_PORT: String(port),
    API_PORT: String(port),
    DASHBOARD_PORT: String(port),
    PORT: String(port),
    DATA_DIR: join(dataRoot(), 'data'),
    REQUIRE_API_KEY: 'false',
    OMNIROUTE_SKIP_POSTINSTALL: '1',
    OMNIROUTE_NO_UPDATE_NOTIFIER: '1',
    // Native Ascora pages consume Combo Studio / traffic-inspector live data
    // from the sidecar. The socket stays loopback-only via SERVER_HOST.
    OMNIROUTE_ENABLE_LIVE_WS: '1',
    STORAGE_ENCRYPTION_KEY: storageKey(),
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    NODE_ENV: 'production'
  }
}

function nativeFetch(url: string, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', body, headers, signal } = options
    const req = httpRequest(url, { method, headers, signal }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
          text: async () => data
        })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function waitForHealth(port: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < BOOT_BUDGET_MS) {
    if (sidecar.intentionalStop) throw new Error('OmniRoute startup cancelled')
    if (sidecar.child === null || sidecar.child.exitCode !== null) {
      throw new Error(`sidecar exited during startup\n${ringTail(20)}`)
    }
    try {
      const res = await nativeFetch(`http://127.0.0.1:${port}/api/monitoring/health`, {
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)
      })
      const child = sidecar.child
      if (res.status === 200 && child && child.exitCode === null) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS))
    emitStatus() // keep startingForMs ticking in the renderer
  }
  throw new Error(`health endpoint did not answer within ${BOOT_BUDGET_MS / 1000}s\n${ringTail(20)}`)
}

/** Enable Ascora's loopback-only native admin UI without exposing or relying
 * on OmniRoute's dashboard login. The endpoint is explicitly public for
 * first-run bootstrap and the setting persists in the sidecar data directory. */
async function disableManagementLogin(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/settings/require-login`
  const res = await nativeFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requireLogin: false }),
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`could not enable OmniRoute management API (${res.status})${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
  }
}

function attachExitHandler(child: ChildProcessWithoutNullStreams): void {
  child.on('exit', (code, signal) => {
    captureOutput(`<sidecar exited: code=${code} signal=${signal}>\n`)
    if (sidecar.child !== child) return
    sidecar.child = null
    closeLog()
    if (sidecar.intentionalStop) {
      setPhase('stopped')
      return
    }
    if (sidecar.phase === 'ready') {
      scheduleRestart()
    }
    // exits during 'starting' are surfaced by waitForHealth
  })
}

function scheduleRestart(): void {
  const now = Date.now()
  sidecar.restartTimestamps = sidecar.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
  if (sidecar.restartTimestamps.length >= MAX_RESTARTS_PER_WINDOW) {
    setPhase('error', `sidecar crashed repeatedly (${MAX_RESTARTS_PER_WINDOW} restarts in 10 min)\n${ringTail(20)}`)
    return
  }
  const attempt = sidecar.restartTimestamps.length
  sidecar.restartTimestamps.push(now)
  const delay = RESTART_BACKOFF_MS[Math.min(attempt, RESTART_BACKOFF_MS.length - 1)]
  captureOutput(`<sidecar crashed; restarting in ${delay / 1000}s>\n`)
  setPhase('starting')
  sidecar.startAttemptAt = now
  sidecar.restartTimer = setTimeout(() => {
    sidecar.restartTimer = null
    void startOmniroute().catch(() => {
      /* state already reflects the failure */
    })
  }, delay)
}

export function startOmniroute(): Promise<OmnirouteStatus> {
  if (sidecar.stopPromise) return sidecar.stopPromise.then(() => startOmniroute())
  if (sidecar.phase === 'ready') return Promise.resolve(currentStatus())
  if (sidecar.startPromise) return sidecar.startPromise

  // A manual retry should not race a pending crash-restart timer.
  if (sidecar.restartTimer) {
    clearTimeout(sidecar.restartTimer)
    sidecar.restartTimer = null
  }

  const promise = (async (): Promise<OmnirouteStatus> => {
    const manifest = readManifest()
    if (!manifest) {
      const hint = app.isPackaged
        ? 'the bundled OmniRoute resources are missing from this install'
        : 'run `npm run omniroute:vendor` first'
      setPhase('error', `OmniRoute is not vendored — ${hint}`)
      return currentStatus()
    }
    const entry = join(omnirouteRoot(), manifest.entry)
    if (!existsSync(entry)) {
      setPhase('error', `vendored entry is missing: ${manifest.entry}`)
      return currentStatus()
    }

    sidecar.version = manifest.version
    sidecar.intentionalStop = false
    sidecar.startAttemptAt = Date.now()

    setPhase('starting')
    try {
      await backupDataOnVersionChange(manifest.version)
      const port = await pickPort()
      if (sidecar.intentionalStop) throw new Error('OmniRoute startup cancelled')
      sidecar.port = port
      setPhase('starting')

      mkdirSync(join(dataRoot(), 'data'), { recursive: true })
      openLog()
      captureOutput(`<starting omniroute@${manifest.version} on 127.0.0.1:${port}>\n`)

      // Launch the built server directly. Ascora already supervises it; loading
      // the upstream CLI adds a TS loader, every CLI command and a second supervisor.
      const packageRoot = join(dirname(entry), '..')
      const serverEntry = ['dist', 'app'].flatMap((folder) =>
        ['server-ws.mjs', 'server.js'].map((file) => join(packageRoot, folder, file))
      ).find((file) => existsSync(file))
      const child = spawn(process.execPath, serverEntry ? [serverEntry] : [entry, 'serve', '--no-open'], {
        cwd: omnirouteRoot(),
        windowsHide: true,
        // POSIX: own process group so the whole tree can be signalled at once.
        detached: process.platform !== 'win32',
        env: sidecarEnv(port)
      })
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => captureOutput(chunk))
      child.stderr.on('data', (chunk: string) => captureOutput(chunk))
      sidecar.child = child
      child.on('error', (error) => { captureOutput(`${error.message}\n`); if (sidecar.child === child) sidecar.child = null })
      attachExitHandler(child)

      await waitForHealth(port)
      await disableManagementLogin(port)
      if (sidecar.intentionalStop) throw new Error('OmniRoute startup cancelled')
      captureOutput(`<ready in ${Date.now() - sidecar.startAttemptAt}ms>\n`)

      getStore().setSetting('omniroute.port', port)
      setPhase('ready')
      return currentStatus()
    } catch (err) {
      await killChildAndWait()
      if (sidecar.intentionalStop) setPhase('stopped')
      else setPhase('error', err instanceof Error ? err.message : String(err))
      return currentStatus()
    }
  })().finally(() => {
    sidecar.startPromise = null
  })

  sidecar.startPromise = promise
  return promise
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

async function waitForChildExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(resolveExit, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
}

async function waitForPortRelease(port: number | null, timeoutMs: number): Promise<void> {
  if (!port) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
}

async function killChildAndWait(): Promise<void> {
  const child = sidecar.child
  if (!child || child.pid === undefined || child.exitCode !== null) return
  const port = sidecar.port
  if (process.platform === 'win32') {
    // OmniRoute forks its server worker. Await taskkill itself and the listening
    // port so an immediate Start cannot overlap the old process tree.
    await new Promise<void>((resolveKill) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      const timer = setTimeout(resolveKill, 10_000)
      const done = (): void => {
        clearTimeout(timer)
        resolveKill()
      }
      killer.once('error', done)
      killer.once('exit', done)
    })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    const pid = child.pid
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }, 3000).unref()
  }
  await waitForChildExit(child, 10_000)
  await waitForPortRelease(port, 10_000)
}

/** Stop the complete process tree. Callers may await it before allowing Start. */
export function stopOmniroute(): Promise<void> {
  if (sidecar.stopPromise) return sidecar.stopPromise
  sidecar.intentionalStop = true
  if (sidecar.restartTimer) {
    clearTimeout(sidecar.restartTimer)
    sidecar.restartTimer = null
  }
  const promise = (async (): Promise<void> => {
    await killChildAndWait()
    await sidecar.startPromise
    sidecar.child = null
    closeLog()
    if (sidecar.phase !== 'stopped') setPhase('stopped')
  })().finally(() => {
    sidecar.stopPromise = null
  })
  sidecar.stopPromise = promise
  return promise
}
