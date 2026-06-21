import { app, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  IPC,
  type CodexCheckResult,
  type CodexEvent,
  type CodexItem,
  type CodexRunResult,
  type CodexEventPayload,
  type GlmCaptchaConfigResult,
  type GlmMode,
  type GlmRunParams,
  type TokenUsage
} from '@shared/ipc'

/**
 * Drives ZCode's bundled `zcode.cjs` headless CLI as a fourth agent backend
 * (alongside LM Studio, Codex and Claude). ZCode is an OpenCode fork that runs
 * GLM / Zhipu and other
 * Chinese models; `zcode.cjs` is an "electron-node" bundle, so we run it through
 * `ZCode.exe` with `ELECTRON_RUN_AS_NODE=1`:
 *
 *   ZCode.exe zcode.cjs --prompt <text> --json --cwd <ws> --mode <mode> [--resume sess_…]
 *
 * `--json` streams the ZCode protocol (an OpenCode-style message/part model) as
 * newline-delimited JSON. We normalise it into the shared `CodexEvent` shape so
 * the renderer renders every CLI backend with one code path. Multi-turn uses
 * `--resume <sessionId>`.
 *
 * The headless CLI has no `--model` flag. We use its standalone config when
 * present, or the active desktop Coding Plan provider. Desktop Start Plan is
 * supported with a fresh official Aliyun CAPTCHA proof supplied per turn.
 */

interface Run {
  child: ChildProcessWithoutNullStreams
  killed: boolean
}

const runs = new Map<string, Run>()

// ---------- binary resolution ----------

const EXE = process.platform === 'win32' ? 'ZCode.exe' : 'zcode'
const CJS_REL = ['resources', 'glm', 'zcode.cjs']

interface GlmPaths {
  /** The Electron binary used as a Node runtime for `zcode.cjs`. */
  exe: string
  /** The `zcode.cjs` CLI bundle. */
  cjs: string
  found: boolean
}

interface DesktopModelRuntime {
  providerId: string
  modelId: string
  baseURL: string
  apiKey: string
  /** Start Plan uses an OAuth bearer token instead of Anthropic's x-api-key. */
  auth: 'bearer' | 'x-api-key'
}

interface ProviderProxy {
  baseURL: string
  close: () => void
}

/** Candidate ZCode install directories for the current platform. */
function installRoots(): string[] {
  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'ZCode'),
      process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'ZCode'),
      process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)']!, 'ZCode')
    ]
    return roots.filter((r): r is string => !!r)
  }
  if (process.platform === 'darwin') {
    return ['/Applications/ZCode.app/Contents/Resources', join(homedir(), 'Applications', 'ZCode.app', 'Contents', 'Resources')]
  }
  return ['/opt/ZCode', join(homedir(), '.local', 'share', 'ZCode')]
}

/** Derive {exe, cjs} from an install directory. */
function fromRoot(root: string): { exe: string; cjs: string } {
  return { exe: join(root, EXE), cjs: join(root, ...CJS_REL) }
}

/**
 * Resolve the runtime + CLI bundle. `configured` may point at the install
 * folder, the `ZCode.exe`, or the `zcode.cjs` directly.
 */
export function resolveGlmPaths(configured?: string): GlmPaths {
  const want = configured?.trim()
  if (want && existsSync(want)) {
    let isDir = false
    try {
      isDir = statSync(want).isDirectory()
    } catch {
      /* treat as file */
    }
    if (isDir) {
      const { exe, cjs } = fromRoot(want)
      return { exe, cjs, found: existsSync(exe) && existsSync(cjs) }
    }
    if (want.toLowerCase().endsWith('.cjs')) {
      // zcode.cjs lives at <root>/resources/glm/zcode.cjs → exe is two dirs up.
      const exe = join(dirname(want), '..', '..', EXE)
      return { exe, cjs: want, found: existsSync(exe) }
    }
    // Assume it's the exe; cjs sits beside it under resources/glm.
    const cjs = join(dirname(want), ...CJS_REL)
    return { exe: want, cjs, found: existsSync(cjs) }
  }

  for (const root of installRoots()) {
    const { exe, cjs } = fromRoot(root)
    if (existsSync(exe) && existsSync(cjs)) return { exe, cjs, found: true }
  }
  // Best-effort fallback so error messages carry a sensible path.
  const { exe, cjs } = fromRoot(installRoots()[0] ?? 'ZCode')
  return { exe, cjs, found: false }
}

/** Spawn `zcode.cjs` through the Electron binary in Node mode. */
function spawnZcode(
  paths: GlmPaths,
  args: string[],
  cwd?: string,
  envOverrides: NodeJS.ProcessEnv = {}
): ChildProcessWithoutNullStreams {
  return spawn(paths.exe, [paths.cjs, ...args], {
    cwd,
    windowsHide: true,
    // ELECTRON_RUN_AS_NODE turns ZCode.exe into a plain Node runtime for the
    // child only — it is never set on our own process.
    env: {
      ...process.env,
      // Keep Ascora sessions/artifacts out of ZCode desktop's SQLite store.
      ZCODE_STORAGE_DIR: join(app.getPath('userData'), 'zcode-cli'),
      ELECTRON_RUN_AS_NODE: '1',
      ...envOverrides
    }
  })
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/**
 * Read the provider snapshot maintained by ZCode desktop. Nothing is written
 * back: account switches are picked up on the next turn.
 */
function desktopModelRuntime(): DesktopModelRuntime | null {
  const path = join(homedir(), '.zcode', 'v2', 'config.json')
  if (!existsSync(path)) return null
  try {
    const root = record(JSON.parse(readFileSync(path, 'utf8')))
    const providers = record(root.provider)
    for (const [providerId, rawProvider] of Object.entries(providers)) {
      const provider = record(rawProvider)
      if (provider.enabled !== true || typeof provider.systemDisabledReason === 'string') continue
      if (provider.kind !== 'anthropic') continue
      const options = record(provider.options)
      const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : ''
      const baseURL = typeof options.baseURL === 'string' ? options.baseURL.trim() : ''
      const models = record(provider.models)
      const modelId = Object.keys(models).find((id) => id.trim().length > 0) ?? ''
      if (!apiKey || !baseURL || !modelId) continue
      return {
        providerId,
        modelId,
        baseURL,
        apiKey,
        auth: providerId.endsWith('-start-plan') ? 'bearer' : 'x-api-key'
      }
    }
  } catch {
    // A partially-written/old desktop snapshot is treated as unavailable.
  }
  return null
}

/** True when the standalone CLI has its own explicit model configuration. */
function hasCliModelConfig(): boolean {
  const path = join(homedir(), '.zcode', 'cli', 'config.json')
  if (!existsSync(path)) return false
  try {
    const config = record(JSON.parse(readFileSync(path, 'utf8')))
    if (typeof config.model === 'string') return config.model.includes('/')
    const model = record(config.model)
    return [model.main, model.lite].some((value) => typeof value === 'string' && value.includes('/'))
  } catch {
    return false
  }
}

/**
 * Keep the real desktop credential out of the ZCode child/tool environment.
 * The child talks only to loopback; this proxy adds the provider auth header.
 */
function startProviderProxy(
  runtime: DesktopModelRuntime,
  captcha?: { verifyParam: string; region: string }
): Promise<ProviderProxy> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((incoming, outgoing) => {
      const suffix = incoming.url?.startsWith('/') ? incoming.url : `/${incoming.url ?? ''}`
      let target: URL
      try {
        target = new URL(runtime.baseURL.replace(/\/+$/, '') + suffix)
      } catch {
        outgoing.writeHead(502)
        outgoing.end('Invalid ZCode provider URL')
        return
      }

      const headers: Record<string, string | string[] | undefined> = {
        ...incoming.headers,
        host: target.host
      }
      delete headers.authorization
      delete headers['x-api-key']
      delete headers['x-aliyun-captcha-verify-param']
      delete headers['x-aliyun-captcha-verify-region']
      if (runtime.auth === 'bearer') headers.authorization = `Bearer ${runtime.apiKey}`
      else headers['x-api-key'] = runtime.apiKey
      if (captcha) {
        headers['x-aliyun-captcha-verify-param'] = captcha.verifyParam
        headers['x-aliyun-captcha-verify-region'] = captcha.region
      }

      const request = target.protocol === 'https:' ? httpsRequest : httpRequest
      const upstream = request(target, { method: incoming.method, headers }, (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(outgoing)
      })
      upstream.on('error', (err) => {
        if (!outgoing.headersSent) outgoing.writeHead(502)
        outgoing.end(`ZCode provider request failed: ${err.message}`)
      })
      incoming.on('aborted', () => upstream.destroy())
      incoming.pipe(upstream)
    })

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to start the local ZCode provider proxy'))
        return
      }
      resolve({
        baseURL: `http://127.0.0.1:${address.port}`,
        close: () => server.close()
      })
    })
  })
}

// ---------- install / auth probe ----------

function collect(
  paths: GlmPaths,
  args: string[],
  timeoutMs = 12000
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnZcode(paths, args)
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: '', error: err instanceof Error ? err.message : String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (r: { code: number | null; stdout: string; stderr: string; error?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      done({ code: null, stdout, stderr, error: 'timed out' })
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c: string) => (stdout += c))
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', (err) => done({ code: null, stdout, stderr, error: err.message }))
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
}

/** Read login signals without changing either desktop or standalone CLI config. */
function authState(): { loggedIn: boolean; cliConfigured: boolean; desktopCredentials: boolean } {
  const z = join(homedir(), '.zcode')
  const desktop = desktopModelRuntime()
  const cliConfigured = hasCliModelConfig()
  return {
    loggedIn: cliConfigured || desktop !== null,
    cliConfigured,
    desktopCredentials: existsSync(join(z, 'v2', 'credentials.json'))
  }
}

export async function checkGlm(configured?: string): Promise<CodexCheckResult> {
  const paths = resolveGlmPaths(configured)
  if (!paths.found) {
    return {
      ok: true,
      installed: false,
      path: paths.exe,
      error:
        'ZCode not found. Install ZCode (the desktop app) or set its path (install folder, ZCode.exe, or resources/glm/zcode.cjs).'
    }
  }
  const ver = await collect(paths, ['--version'])
  if (ver.error || ver.code !== 0) {
    return { ok: true, installed: false, path: paths.exe, error: ver.error ?? ver.stderr.trim() ?? 'zcode --version failed' }
  }
  const desktop = desktopModelRuntime()
  const { loggedIn, cliConfigured, desktopCredentials } = authState()
  const authNote = cliConfigured
    ? 'Standalone CLI configured (isolated storage)'
    : desktop?.auth === 'x-api-key'
      ? `Desktop provider ready: ${desktop.modelId} (isolated from ZCode config)`
      : desktop?.auth === 'bearer'
        ? `Desktop Start Plan ready: ${desktop.modelId} (CAPTCHA preflight required)`
        : desktopCredentials
          ? 'Desktop login found, but no headless-compatible provider is active'
          : 'Configure ZCode Coding Plan for the standalone CLI'
  return {
    ok: true,
    installed: true,
    path: paths.cjs,
    version: ver.stdout.trim().split('\n')[0] || undefined,
    loggedIn,
    authNote
  }
}

function zcodeDesktopVersion(paths: GlmPaths): string {
  try {
    const packagePath = join(dirname(paths.exe), 'resources', 'app.asar', 'package.json')
    const pkg = record(JSON.parse(readFileSync(packagePath, 'utf8')))
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : '3.1.2'
  } catch {
    return '3.1.2'
  }
}

/** Fetch the public Aliyun challenge settings used by ZCode Start Plan. */
export async function getGlmCaptchaConfig(configured?: string): Promise<GlmCaptchaConfigResult> {
  const desktop = desktopModelRuntime()
  if (desktop?.auth !== 'bearer') return { required: false }
  const paths = resolveGlmPaths(configured)
  const query = new URLSearchParams({
    app_version: zcodeDesktopVersion(paths),
    platform: `${process.platform}-${process.arch}`
  })
  try {
    const response = await fetch(`https://zcode.z.ai/api/v1/client/configs?${query}`, {
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const root = record(await response.json())
    const data = record(root.data)
    const configs = record(data.configs)
    const captcha = record(configs.captcha)
    if (captcha.enabled === false) return { required: false }
    const region = typeof captcha.region === 'string' ? captcha.region.trim() : ''
    const prefix = typeof captcha.prefix === 'string' ? captcha.prefix.trim() : ''
    const sceneId = typeof captcha.sceneId === 'string' ? captcha.sceneId.trim() : ''
    const mode = typeof captcha.mode === 'string' ? captcha.mode.trim() : ''
    if (!region || !prefix || !sceneId) throw new Error('ZCode returned an incomplete CAPTCHA configuration')
    return { required: true, config: { region, prefix, sceneId, ...(mode ? { mode } : {}) } }
  } catch (err) {
    return {
      required: true,
      error: `Unable to load ZCode CAPTCHA configuration: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

// ---------- run streaming ----------

function killTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      return
    } catch {
      /* fall through */
    }
  }
  try {
    child.kill()
  } catch {
    /* already gone */
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/**
 * Pull an OpenCode-style `part` out of a stream line, whether the line is the
 * part itself or an envelope ({part}, {properties:{part}}, {payload:{part}}).
 */
const PART_TYPES = new Set(['text', 'reasoning', 'tool', 'step-start', 'step-finish'])
function pickPart(o: Record<string, unknown>): Record<string, unknown> | null {
  if (PART_TYPES.has(str(o.type))) return o
  for (const key of ['part', 'payload', 'properties', 'data']) {
    const inner = obj(o[key])
    if (PART_TYPES.has(str(inner.type))) return inner
    const innerPart = obj(inner.part)
    if (PART_TYPES.has(str(innerPart.type))) return innerPart
  }
  return null
}

/** Find a `sess_…` session id anywhere shallow in the line. */
function pickSession(o: Record<string, unknown>): string | undefined {
  const candidates = [o.sessionID, o.session_id, o.sessionId, obj(o.info).id, obj(o.payload).sessionID, o.id]
  for (const c of candidates) {
    const s = str(c)
    if (s.startsWith('sess_')) return s
  }
  return undefined
}

/** Token usage from a `step-finish` part or an assistant message. */
function pickUsage(o: Record<string, unknown>): TokenUsage | null {
  const t = obj(o.tokens)
  if (typeof t.input === 'number' || typeof t.output === 'number') {
    const cache = obj(t.cache)
    const input = (Number(t.input) || 0) + (Number(cache.read) || 0) + (Number(cache.write) || 0)
    return { inputTokens: input, outputTokens: Number(t.output) || 0 }
  }
  return null
}

/** Map a ZCode tool part to our normalized item fields (matching Codex's vocab). */
function mapTool(name: string, input: Record<string, unknown>): Partial<CodexItem> & { type: string } {
  const path = str(input.filePath) || str(input.file_path) || str(input.path) || str(input.notebook_path)
  if (name === 'Bash') return { type: 'command_execution', command: str(input.command) }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Patch', 'Update'].includes(name))
    return { type: 'file_change', changes: [{ path, kind: name === 'Write' ? 'add' : 'update' }] }
  if (name === 'Read') return { type: 'read_file', text: path }
  if (['Grep', 'Glob', 'List', 'LS'].includes(name))
    return { type: 'list_dir', text: str(input.pattern) || str(input.path) || '.' }
  const summary = str(input.command) || str(input.pattern) || path || str(input.url) || str(input.query)
  return { type: name.toLowerCase(), text: summary }
}

export async function runGlm(
  id: string,
  sender: WebContents,
  params: GlmRunParams,
  config: { glmPath?: string; glmMode?: GlmMode }
): Promise<CodexRunResult> {
  killRun(id)

  const paths = resolveGlmPaths(config.glmPath)
  if (!paths.found) {
    return {
      ok: false,
      error: 'ZCode not found. Open connection settings to set its path, or install the ZCode desktop app.'
    }
  }

  const mode: GlmMode = params.mode ?? config.glmMode ?? 'yolo'
  const args = ['--prompt', params.prompt, '--json', '--no-color', '--cwd', params.cwd, '--mode', mode]
  if (params.sessionId) args.push('--resume', params.sessionId)

  const cliConfigured = hasCliModelConfig()
  const desktop = cliConfigured ? null : desktopModelRuntime()
  let providerProxy: ProviderProxy | null = null
  let modelEnv: NodeJS.ProcessEnv = {}
  if (desktop) {
    const verifyParam = params.captchaVerifyParam?.trim() ?? ''
    const captchaRegion = params.captchaRegion?.trim() ?? ''
    if (desktop.auth === 'bearer' && (!verifyParam || !captchaRegion)) {
      return { ok: false, error: 'ZCode Start Plan CAPTCHA verification was not completed.' }
    }
    try {
      providerProxy = await startProviderProxy(
        desktop,
        desktop.auth === 'bearer' ? { verifyParam, region: captchaRegion } : undefined
      )
      modelEnv = {
        ZCODE_MODEL: `${desktop.providerId}/${desktop.modelId}`,
        ZCODE_BASE_URL: providerProxy.baseURL,
        // The adapter requires a value; the real credential stays in the proxy.
        ZCODE_API_KEY: 'ascora-local-provider-proxy'
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  } else if (!cliConfigured) {
    return {
      ok: false,
      error:
        'ZCode has no active desktop model provider and no standalone CLI model config. Sign in and select a model in ZCode, then try again.'
    }
  }

  const emit = (event: CodexEvent): void => {
    if (!sender.isDestroyed()) sender.send(IPC.glm.event, { id, event } satisfies CodexEventPayload)
  }

  return new Promise<CodexRunResult>((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnZcode(paths, args, params.cwd, modelEnv)
    } catch (err) {
      providerProxy?.close()
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }
    try {
      child.stdin.end() // prompt is an arg; never block on stdin
    } catch {
      /* already closed */
    }

    const run: Run = { child, killed: false }
    runs.set(id, run)

    let sessionId: string | undefined
    let usage: TokenUsage | undefined
    let stdoutBuf = ''
    let stderrBuf = ''
    let rawStdout = '' // for the plain-text fallback if --json yields nothing parseable
    let rawStderr = '' // full stderr, for a complete error message on a non-zero exit
    let sawJson = false

    // Accumulated assistant prose / reasoning (emitted as one bubble at the end
    // so we don't depend on the exact streaming-envelope shape).
    let agentText = ''
    let reasoningText = ''
    let emittedTool = false
    const toolSeen = new Set<string>()

    /** Merge a streamed text chunk that may be a full snapshot or a delta. */
    const merge = (acc: string, next: string): string => {
      if (!next) return acc
      if (!acc) return next
      if (next.startsWith(acc)) return next // growing snapshot
      if (acc.endsWith(next)) return acc // duplicate tail
      return acc + next // distinct fragment
    }

    const handlePart = (part: Record<string, unknown>): void => {
      const type = str(part.type)
      if (type === 'text') {
        agentText = merge(agentText, str(part.text))
      } else if (type === 'reasoning') {
        reasoningText = merge(reasoningText, str(part.text))
      } else if (type === 'tool') {
        const callId = str(part.callID) || str(part.id) || `tool_${toolSeen.size}`
        const state = obj(part.state)
        const status = str(state.status)
        const mapped = mapTool(str(part.tool), obj(state.input))
        const phase = status === 'completed' ? 'completed' : status === 'error' ? 'completed' : 'started'
        const extra: Partial<CodexItem> = {}
        if (mapped.type === 'command_execution') {
          extra.output = str(state.output) || undefined
          const meta = obj(state.metadata)
          extra.exitCode =
            typeof meta.exit === 'number' ? (meta.exit as number) : status === 'error' ? 1 : status === 'completed' ? 0 : undefined
        }
        emittedTool = true
        toolSeen.add(callId)
        emit({
          kind: 'item',
          phase: phase as 'started' | 'completed',
          item: {
            id: callId,
            status: status === 'error' ? 'failed' : status === 'completed' ? 'completed' : 'in_progress',
            ...mapped,
            ...extra
          }
        })
      } else if (type === 'step-finish') {
        const u = pickUsage(part)
        if (u) usage = u
      }
    }

    const handleLine = (line: string): void => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        return // not a JSON line
      }
      sawJson = true
      const sid = pickSession(parsed)
      if (sid && sid !== sessionId) {
        sessionId = sid
        emit({ kind: 'thread', threadId: sid })
      }
      const part = pickPart(parsed)
      if (part) handlePart(part)
      const u = pickUsage(obj(parsed.tokens).input !== undefined ? parsed : obj(parsed.info))
      if (u) usage = u
      const type = str(parsed.type)
      if (/error|failed/.test(type) && !part) {
        const msg = str(parsed.message) || str(obj(parsed.payload).message) || str(parsed.error)
        if (msg) emit({ kind: 'error', message: msg })
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    child.stdout?.on('data', (chunk: string) => {
      rawStdout += chunk
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (line) handleLine(line)
      }
    })

    child.stderr?.on('data', (chunk: string) => {
      rawStderr += chunk
      stderrBuf += chunk
      let nl: number
      while ((nl = stderrBuf.indexOf('\n')) >= 0) {
        const line = stderrBuf.slice(0, nl).trim()
        stderrBuf = stderrBuf.slice(nl + 1)
        if (line) emit({ kind: 'notice', text: line })
      }
    })

    child.on('error', (err) => emit({ kind: 'error', message: err.message }))

    child.on('close', (code) => {
      providerProxy?.close()
      if (runs.get(id) === run) runs.delete(id)

      // Flush any tail line, then the accumulated reasoning + prose.
      const tail = stdoutBuf.trim()
      if (tail) handleLine(tail)
      if (reasoningText.trim()) {
        emit({
          kind: 'item',
          phase: 'completed',
          item: { id: `think_${Math.random().toString(36).slice(2)}`, type: 'reasoning', text: reasoningText.trim() }
        })
      }
      // Fallback: if --json never produced parseable prose/tools on a successful
      // run, surface the raw stdout so the turn isn't silently empty. (On a
      // failure the error is reported via the rejected result instead, so we
      // don't echo it as assistant prose too.)
      let finalText = agentText.trim()
      if (!finalText && !emittedTool && !sawJson && code === 0) finalText = rawStdout.trim()
      if (finalText) {
        emit({
          kind: 'item',
          phase: 'completed',
          item: { id: `msg_${Math.random().toString(36).slice(2)}`, type: 'agent_message', text: finalText }
        })
      }
      emit({ kind: 'turn-completed' })

      if (run.killed) {
        resolve({ ok: true, code, threadId: sessionId, usage, aborted: true })
        return
      }
      if (code === 0) {
        resolve({ ok: true, code, threadId: sessionId, usage })
      } else {
        // Prefer the full stderr/stdout (carries the actual reason, e.g.
        // "Model config is missing…") over a bare exit code.
        const reason = (rawStderr.trim() || rawStdout.trim()).split('\n').slice(-6).join('\n')
        resolve({ ok: false, code, threadId: sessionId, usage, error: reason || `zcode exited with code ${code}` })
      }
    })

    sender.once('destroyed', () => killRun(id))
  })
}

export function killRun(id: string): void {
  const run = runs.get(id)
  if (!run) return
  run.killed = true
  runs.delete(id)
  killTree(run.child)
}

app.on('before-quit', () => {
  for (const id of [...runs.keys()]) killRun(id)
})
