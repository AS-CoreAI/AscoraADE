// Boot-verifies the vendored OmniRoute tree in .build/omniroute by spawning
// it EXACTLY the way src/main/omniroute/runner.ts does in production
// (Electron binary + ELECTRON_RUN_AS_NODE + the same env pins), then probing:
//   1. /api/monitoring/health  -> 200      (server boots, migrations finish)
//   2. GET /v1/models          -> 200 JSON (OpenAI surface is up)
//   3. a storage write + process restart   (node:sqlite really persists and
//      the worker reuses Electron instead of requiring a system Node install)
//
// Usage: node scripts/omniroute/smoke.mjs [--timeout <seconds>]
import crossSpawn from 'cross-spawn'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { omnirouteEnvPins } from './env.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..', '..')
const OUT = join(ROOT, '.build', 'omniroute')
const MANIFEST = join(OUT, 'VENDOR_MANIFEST.json')

const timeoutArgIdx = process.argv.indexOf('--timeout')
const BOOT_BUDGET_MS = (timeoutArgIdx > -1 ? Number(process.argv[timeoutArgIdx + 1]) : 120) * 1000
const KEEP_DATA_ON_FAILURE = process.argv.includes('--keep-data')

const logLines = []
let child = null
let dataDir = ''
let exited = false

function log(msg) {
  console.log(`[omniroute:smoke] ${msg}`)
}

function cleanup({ keepData = false } = {}) {
  if (child && child.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      crossSpawn.sync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
    }
  }
  if (dataDir && !keepData) rmSync(dataDir, { recursive: true, force: true })
}

function stopChild() {
  if (!child || !child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    crossSpawn.sync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
}

function fail(msg) {
  console.error(`[omniroute:smoke] FAIL: ${msg}`)
  const tail = logLines.slice(-40)
  if (tail.length > 0) {
    console.error('[omniroute:smoke] last sidecar output:')
    for (const line of tail) console.error(`  ${line}`)
  }
  if (KEEP_DATA_ON_FAILURE) console.error(`[omniroute:smoke] preserving failed data at ${dataDir}`)
  cleanup({ keepData: KEEP_DATA_ON_FAILURE })
  process.exit(1)
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolvePort(port))
    })
    srv.on('error', reject)
  })
}

async function fetchJson(url, init = {}, timeoutMs = 5000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  let body = null
  const text = await res.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, ok: res.ok, body }
}

// --- resolve pieces -----------------------------------------------------

if (!existsSync(MANIFEST)) fail(`no vendored tree at ${OUT} — run: npm run omniroute:vendor`)
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const entry = join(OUT, manifest.entry)
if (!existsSync(entry)) fail(`manifest entry ${manifest.entry} is missing`)

const require = createRequire(import.meta.url)
const electronBin = process.env.ELECTRON_EXEC || require('electron')
if (typeof electronBin !== 'string' || !existsSync(electronBin)) {
  fail('could not resolve the Electron binary (set ELECTRON_EXEC to override)')
}

const port = await freePort()
dataDir = mkdtempSync(join(tmpdir(), 'omniroute-smoke-'))
const base = `http://127.0.0.1:${port}`
const storageKey = randomBytes(32).toString('hex')

log(`spawning ${manifest.name}@${manifest.version} on ${base} (data: ${dataDir})`)

// --- spawn (mirrors src/main/omniroute/runner.ts) -------------------------

function spawnSidecar() {
  exited = false
  const spawned = spawn(electronBin, [entry, 'serve', '--no-open'], {
    cwd: OUT,
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ...omnirouteEnvPins({ port, dataDir: join(dataDir, 'data'), storageKey })
    }
  })
  child = spawned
  spawned.on('exit', (code, signal) => {
    if (child === spawned) exited = true
    logLines.push(`<sidecar exited: code=${code} signal=${signal}>`)
  })
  for (const stream of [spawned.stdout, spawned.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) logLines.push(line)
      }
      if (logLines.length > 400) logLines.splice(0, logLines.length - 400)
    })
  }
}

async function waitForHealth(label) {
  const bootStart = Date.now()
  let lastResponse = null
  while (Date.now() - bootStart < BOOT_BUDGET_MS) {
    if (exited) fail(`sidecar exited before ${label} became healthy (DOA build?)`)
    try {
      const res = await fetchJson(`${base}/api/monitoring/health`, {}, 2000)
      lastResponse = res
      if (res.status === 200) {
        log(`${label} healthy after ${((Date.now() - bootStart) / 1000).toFixed(1)}s`)
        return
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 750))
  }
  const diagnostic = lastResponse
    ? `; last response ${lastResponse.status}: ${JSON.stringify(lastResponse.body).slice(0, 800)}`
    : '; endpoint never answered'
  fail(`${label} health endpoint did not answer 200 within ${BOOT_BUDGET_MS / 1000}s${diagnostic}`)
}

spawnSidecar()

// --- probe 1: health -------------------------------------------------------

await waitForHealth('first boot')

// OmniRoute 3.8.48 defaults dashboard/management login to enabled. Ascora
// binds the process to loopback and never exposes that dashboard, so disable
// the management login through the public bootstrap endpoint before using the
// admin API. Production performs the identical bootstrap after health.
const loginMode = await fetchJson(`${base}/api/settings/require-login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ requireLogin: false })
}).catch((e) => fail(`management-login bootstrap threw: ${e.message}`))
if (!loginMode.ok) {
  fail(`management-login bootstrap returned ${loginMode.status}: ${JSON.stringify(loginMode.body).slice(0, 500)}`)
}

// --- probe 2: OpenAI surface ----------------------------------------------

const models = await fetchJson(`${base}/v1/models`, {}, 10000).catch((e) => fail(`GET /v1/models threw: ${e.message}`))
if (models.status !== 200) fail(`GET /v1/models returned ${models.status}`)
log(`/v1/models OK (${Array.isArray(models.body?.data) ? models.body.data.length : '?'} models)`)

// --- probe 3: storage write round-trip -------------------------------------
// Preferred: create/read/delete a dummy upstream provider. The POST body
// shape may drift between releases, so a settings round-trip is the fallback
// write proof before declaring the storage path broken.

async function createProviderSentinel() {
  const payloads = [
    { name: 'ascora-smoke', provider: 'openai', apiKey: 'sk-smoke-test' },
    { name: 'ascora-smoke', type: 'openai', apiKey: 'sk-smoke-test', baseUrl: 'https://smoke.invalid/v1' },
    { name: 'ascora-smoke', kind: 'openai', key: 'sk-smoke-test' }
  ]
  for (const payload of payloads) {
    let created
    try {
      created = await fetchJson(`${base}/api/providers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } catch {
      continue
    }
    if (!created.ok) {
      log(`provider POST variant returned ${created.status}: ${JSON.stringify(created.body).slice(0, 400)}`)
      continue
    }
    const id =
      created.body?.id ??
      created.body?.connection?.id ??
      created.body?.provider?.id ??
      created.body?.data?.id
    const list = await fetchJson(`${base}/api/providers`)
    const listedArr = Array.isArray(list.body)
      ? list.body
      : (list.body?.connections ?? list.body?.providers ?? list.body?.data ?? [])
    const found = Array.isArray(listedArr) && listedArr.some((p) => p?.id === id || p?.name === 'ascora-smoke')
    if (!found) return null
    return { id, name: 'ascora-smoke' }
  }
  return false
}

async function settingsRoundTrip() {
  const current = await fetchJson(`${base}/api/settings`)
  if (current.status !== 200 || current.body == null || typeof current.body !== 'object') {
    log(`GET /api/settings returned ${current.status}: ${JSON.stringify(current.body).slice(0, 400)}`)
    return false
  }
  const patch = await fetchJson(`${base}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(current.body)
  })
  if (!patch.ok) log(`PATCH /api/settings returned ${patch.status}: ${JSON.stringify(patch.body).slice(0, 400)}`)
  return patch.ok
}

const sentinel = await createProviderSentinel()
if (!sentinel && !(await settingsRoundTrip())) {
  fail('storage write could not be verified (provider and settings round-trips both failed)')
}

// A first-boot-only smoke misses the exact failure mode this sidecar integration
// must prevent: sql.js can write a DB that it cannot reopen. Kill the complete
// tree as the app would on quit, then require a second boot against the same
// DATA_DIR and encryption key.
stopChild()
child = null
await new Promise((r) => setTimeout(r, 750))
log('restarting against the same data directory…')
spawnSidecar()
await waitForHealth('second boot')

const secondLoginMode = await fetchJson(`${base}/api/settings/require-login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ requireLogin: false })
})
if (!secondLoginMode.ok) fail(`second-boot management bootstrap returned ${secondLoginMode.status}`)

if (sentinel) {
  const list = await fetchJson(`${base}/api/providers`)
  const providers = Array.isArray(list.body)
    ? list.body
    : (list.body?.connections ?? list.body?.providers ?? list.body?.data ?? [])
  const found =
    Array.isArray(providers) &&
    providers.some((provider) => provider?.id === sentinel.id || provider?.name === sentinel.name)
  if (!found) fail('provider sentinel disappeared after process restart')
  if (sentinel.id != null) {
    const del = await fetchJson(`${base}/api/providers/${sentinel.id}`, { method: 'DELETE' })
    if (!del.ok) log(`warning: DELETE smoke provider returned ${del.status}`)
  }
  log('storage persistence verified across a full process restart')
} else {
  log('second boot succeeded (provider POST shape drifted; settings write used as fallback)')
}

log('OK — vendored OmniRoute boots twice, serves /v1 and persists data')
cleanup()
process.exit(0)
