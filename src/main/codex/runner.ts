import { app, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  IPC,
  type CodexCheckResult,
  type CodexEvent,
  type CodexEventPayload,
  type CodexItem,
  type CodexRunParams,
  type CodexRunResult,
  type CodexSandbox
} from '@shared/ipc'

/**
 * Drives OpenAI's `codex` CLI as an alternative agent backend to LM Studio.
 *
 * We run `codex exec --json`, which performs Codex's own autonomous agent loop
 * (reading files, editing, running commands inside its sandbox) and streams
 * newline-delimited JSON events to stdout. We normalise those into `CodexEvent`s
 * and forward them to the renderer, which renders them with the same chat UI as
 * the LM Studio tool loop. Multi-turn is handled via `codex exec resume <id>`,
 * keyed by the `thread_id` captured from the first run.
 *
 * No separate install is required: if `codex` isn't on PATH we fall back to the
 * binary bundled inside the installed "OpenAI ChatGPT/Codex" VS Code extension.
 */

interface Run {
  child: ChildProcessWithoutNullStreams
  killed: boolean
}

const runs = new Map<string, Run>()

// ---------- binary resolution ----------

function findOnPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** The platform-specific subdir Codex ships its binary under in the extension. */
function bundlePlatformDir(): string {
  if (process.platform === 'win32') return 'windows-x86_64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x86_64'
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x86_64'
}

/** Locate the codex binary bundled in an installed VS Code "Codex" extension. */
function bundledCodex(): string | null {
  const bin = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const platDir = bundlePlatformDir()
  const roots = [
    join(homedir(), '.vscode', 'extensions'),
    join(homedir(), '.vscode-insiders', 'extensions'),
    join(homedir(), '.cursor', 'extensions'),
    join(homedir(), '.windsurf', 'extensions')
  ]
  for (const root of roots) {
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue // no such extensions dir
    }
    // Prefer the newest install (lexicographically-highest version dir).
    const exts = entries.filter((e) => e.startsWith('openai.chatgpt')).sort().reverse()
    for (const ext of exts) {
      const candidate = join(root, ext, 'bin', platDir, bin)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Resolve which `codex` to run: an explicit configured path wins, then PATH,
 * then a bundled extension binary, else the bare name (let spawn surface the
 * error). Returns the resolved path and whether it actually exists on disk.
 */
export function resolveCodexPath(configured?: string): { path: string; found: boolean } {
  const want = configured?.trim()
  if (want) {
    if (existsSync(want)) return { path: want, found: true }
    const onPath = findOnPath(want)
    if (onPath) return { path: onPath, found: true }
    return { path: want, found: false }
  }
  const onPath = findOnPath('codex')
  if (onPath) return { path: onPath, found: true }
  const bundled = bundledCodex()
  if (bundled) return { path: bundled, found: true }
  return { path: 'codex', found: false }
}

// ---------- install / auth probe ----------

function collect(
  file: string,
  args: string[],
  timeoutMs = 8000
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(file, args, { windowsHide: true, env: process.env })
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

export async function checkCodex(configured?: string): Promise<CodexCheckResult> {
  const { path, found } = resolveCodexPath(configured)
  if (!found) {
    return {
      ok: true,
      installed: false,
      path,
      error:
        'Codex CLI not found. Install it (npm i -g @openai/codex) or the "OpenAI Codex" VS Code extension, or set the binary path.'
    }
  }

  const ver = await collect(path, ['--version'])
  if (ver.error || ver.code !== 0) {
    return {
      ok: true,
      installed: false,
      path,
      error: ver.error ?? ver.stderr.trim() ?? 'codex --version failed'
    }
  }
  const version = ver.stdout.trim().split('\n')[0] || undefined

  const auth = await collect(path, ['login', 'status'])
  const authText = `${auth.stdout}\n${auth.stderr}`.trim()
  const loggedIn = auth.code === 0 && /logged in/i.test(authText)

  return {
    ok: true,
    installed: true,
    path,
    version,
    loggedIn,
    authNote: authText.split('\n').find((l) => l.trim()) || undefined
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

const asNum = (v: unknown): number | null | undefined =>
  typeof v === 'number' ? v : v === null ? null : undefined

/** Normalise the raw `item` object from a codex event into our `CodexItem`. */
function normalizeItem(raw: Record<string, unknown>): CodexItem {
  const changes = Array.isArray(raw.changes)
    ? (raw.changes as Record<string, unknown>[]).map((c) => ({
        path: String(c.path ?? ''),
        kind: String(c.kind ?? 'edit')
      }))
    : undefined
  return {
    id: String(raw.id ?? ''),
    type: String(raw.type ?? 'unknown'),
    text: typeof raw.text === 'string' ? raw.text : undefined,
    command: typeof raw.command === 'string' ? raw.command : undefined,
    output: typeof raw.aggregated_output === 'string' ? raw.aggregated_output : undefined,
    exitCode: asNum(raw.exit_code),
    changes,
    status: typeof raw.status === 'string' ? raw.status : undefined
  }
}

/** Map one parsed JSONL object from `codex exec --json` to a `CodexEvent`. */
function toEvent(obj: Record<string, unknown>): CodexEvent | null {
  const type = String(obj.type ?? '')
  switch (type) {
    case 'thread.started':
      return { kind: 'thread', threadId: String(obj.thread_id ?? '') }
    case 'turn.started':
      return { kind: 'turn-started' }
    case 'item.started':
    case 'item.updated':
    case 'item.completed': {
      const phase = type === 'item.started' ? 'started' : type === 'item.updated' ? 'updated' : 'completed'
      const item = (obj.item ?? {}) as Record<string, unknown>
      return { kind: 'item', phase, item: normalizeItem(item) }
    }
    case 'turn.completed':
      return { kind: 'turn-completed' }
    case 'turn.failed':
    case 'thread.error':
    case 'error': {
      const err = obj.error as Record<string, unknown> | string | undefined
      const message =
        typeof err === 'string' ? err : String((err && err.message) ?? obj.message ?? 'Codex error')
      return { kind: 'error', message }
    }
    default:
      return null // unknown/ignored event type
  }
}

const NOISE = /Reading additional input from stdin/i

export function runCodex(
  id: string,
  sender: WebContents,
  params: CodexRunParams,
  config: { codexPath?: string; codexModel?: string; codexSandbox?: CodexSandbox }
): Promise<CodexRunResult> {
  killRun(id) // replace any previous run on this id

  const { path, found } = resolveCodexPath(config.codexPath)
  if (!found) {
    return Promise.resolve({
      ok: false,
      error:
        'Codex CLI not found. Open connection settings to set the binary path, or install the Codex CLI / VS Code extension.'
    })
  }

  const sandbox: CodexSandbox = params.sandbox ?? config.codexSandbox ?? 'workspace-write'
  const model = (params.model ?? config.codexModel ?? '').trim()

  const args = ['exec']
  if (params.threadId) args.push('resume', params.threadId)
  args.push('--json', '--skip-git-repo-check', '-s', sandbox)
  if (model) args.push('-m', model)
  args.push('-C', params.cwd, '-') // '-' → read the prompt from stdin

  const emit = (event: CodexEvent): void => {
    if (!sender.isDestroyed()) {
      sender.send(IPC.codex.event, { id, event } satisfies CodexEventPayload)
    }
  }

  return new Promise<CodexRunResult>((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(path, args, { cwd: params.cwd, windowsHide: true, env: process.env })
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }

    const run: Run = { child, killed: false }
    runs.set(id, run)

    let threadId: string | undefined
    let stdoutBuf = ''
    let stderrBuf = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          const event = toEvent(obj)
          if (!event) continue
          if (event.kind === 'thread') threadId = event.threadId
          emit(event)
        } catch {
          /* not JSON — ignore (stdout should be pure JSONL under --json) */
        }
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk
      let nl: number
      while ((nl = stderrBuf.indexOf('\n')) >= 0) {
        const line = stderrBuf.slice(0, nl).trim()
        stderrBuf = stderrBuf.slice(nl + 1)
        if (line && !NOISE.test(line)) emit({ kind: 'notice', text: line })
      }
    })

    child.on('error', (err) => {
      emit({ kind: 'error', message: err.message })
    })

    child.on('close', (code) => {
      if (runs.get(id) === run) runs.delete(id)
      if (run.killed) {
        resolve({ ok: true, code, threadId, aborted: true })
        return
      }
      if (code === 0) {
        resolve({ ok: true, code, threadId })
      } else {
        const tail = stderrBuf.trim() || `codex exited with code ${code}`
        resolve({ ok: false, code, threadId, error: tail })
      }
    })

    // Send the prompt via stdin and signal EOF so codex doesn't wait for more.
    try {
      child.stdin.write(params.prompt)
      child.stdin.end()
    } catch {
      /* stdin already closed */
    }

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
