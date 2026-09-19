import { app, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crossSpawn from 'cross-spawn'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  IPC,
  type AntigravityModel,
  type AntigravityRunParams,
  type CodexCheckResult,
  type CodexEvent,
  type CodexEventPayload,
  type CodexItem,
  type CodexRunResult,
  type TokenUsage
} from '@shared/ipc'

/**
 * Drives Google Antigravity as a CLI agent backend.
 *
 * Antigravity's language_server.exe exposes an `agentapi` subcommand. Since
 * agentapi is fire-and-forget (no stdout streaming), we bridge through a
 * small Python script that uses the official `google-antigravity` SDK to
 * stream responses as NDJSON, matching the ZCode event shape so the
 * renderer can reuse its CLI-backend code path.
 *
 *   python bridge.py --prompt <text> --cwd <ws> [--model <flash_lite|flash|pro>]
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

function findPython(): string | null {
  for (const name of ['python3', 'python']) {
    const found = findOnPath(name)
    if (found) return found
  }
  return null
}

/** Resolve the Antigravity language_server binary. */
export function resolveAntigravityPath(configured?: string): { path: string; found: boolean } {
  const want = configured?.trim()
  if (want && existsSync(want)) return { path: want, found: true }

  // Standard install locations
  const candidates = [
    join(homedir(), '.gemini', 'antigravity', 'bin', 'agentapi.bat'),
    join(homedir(), '.gemini', 'antigravity', 'bin', 'agentapi'),
    '/Applications/Antigravity.app/Contents/Resources/app/bin/agentapi',
    '/usr/share/antigravity/resources/app/bin/agentapi',
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe')
  ].filter((c): c is string => !!c)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, found: true }
  }

  // Try PATH
  const onPath = findOnPath('agentapi')
  if (onPath) return { path: onPath, found: true }

  return { path: candidates[0] ?? 'agentapi', found: false }
}

/** Resolve the bridge.py script bundled alongside the app. */
function bridgePath(): string {
  // External python process cannot read inside app.asar.
  // In packaged builds, bridge.py is placed in resources/antigravity/bridge.py.
  const packagedPath = join(process.resourcesPath, 'antigravity', 'bridge.py')
  if (existsSync(packagedPath)) return packagedPath

  // In dev / repo it sits in src/main/antigravity/
  const repoPath = join(app.getAppPath(), 'src', 'main', 'antigravity', 'bridge.py')
  if (existsSync(repoPath)) return repoPath

  const fallbackPath = join(__dirname, '..', '..', 'src', 'main', 'antigravity', 'bridge.py')
  if (existsSync(fallbackPath)) return fallbackPath

  return repoPath
}

// ---------- install / auth probe ----------

export async function checkAntigravity(configured?: string): Promise<CodexCheckResult> {
  const { path, found } = resolveAntigravityPath(configured)
  if (!found) {
    return {
      ok: true,
      installed: false,
      path,
      error:
        'Antigravity not found. Install Antigravity or set the path to language_server.exe / agentapi.bat.'
    }
  }

  const python = findPython()
  if (!python) {
    return {
      ok: true,
      installed: false,
      path,
      error: 'Python not found. Install Python 3 to run the Antigravity bridge.'
    }
  }

  return new Promise((resolve) => {
    const child = crossSpawn(python, [bridgePath(), '--check'], {
      windowsHide: true,
      env: { ...process.env, ANTIGRAVITY_AGENTAPI: path, PYTHONIOENCODING: 'utf-8' }
    })
    let output = ''
    let detail = ''
    const timer = setTimeout(() => killTree(child as ChildProcessWithoutNullStreams), 25_000)
    child.stdout?.on('data', (data) => { output += String(data) })
    child.stderr?.on('data', (data) => { detail = (detail + String(data)).slice(-2000) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, installed: false, path, error: error.message })
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(output.trim()) as CodexCheckResult
        resolve({ ...result, path, version: 'Antigravity' })
      } catch {
        resolve({ ok: false, installed: true, path, error: detail || 'Antigravity connection check timed out.' })
      }
    })
  })
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

const PART_TYPES = new Set(['text', 'reasoning', 'tool', 'step-start', 'step-finish'])
function pickPart(o: Record<string, unknown>): Record<string, unknown> | null {
  if (PART_TYPES.has(str(o.type))) return o
  for (const key of ['part', 'payload', 'properties', 'data']) {
    const inner = obj(o[key])
    if (PART_TYPES.has(str(inner.type))) return inner
  }
  return null
}

function pickSession(o: Record<string, unknown>): string | undefined {
  const candidates = [o.sessionID, o.session_id, o.sessionId, obj(o.info).id, o.id]
  for (const c of candidates) {
    const s = str(c)
    if ((o.type === 'session' || s.startsWith('agy_') || s.startsWith('sess_')) && /^[a-zA-Z0-9_-]+$/.test(s)) return s
  }
  return undefined
}

function pickUsage(o: Record<string, unknown>): TokenUsage | null {
  const t = obj(o.tokens)
  if (typeof t.input === 'number' || typeof t.output === 'number') {
    return { inputTokens: Number(t.input) || 0, outputTokens: Number(t.output) || 0 }
  }
  return null
}

function mapTool(name: string, input: Record<string, unknown>): Partial<CodexItem> & { type: string } {
  const clean = (v: unknown): string => {
    let s = str(v).trim()
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      try {
        s = JSON.parse(s)
      } catch {
        /* keep original */
      }
    }
    return s
  }
  const cmd = clean(input.CommandLine) || clean(input.command)
  const path =
    clean(input.AbsolutePath) ||
    clean(input.TargetFile) ||
    clean(input.DirectoryPath) ||
    clean(input.SearchPath) ||
    clean(input.filePath) ||
    clean(input.file_path) ||
    clean(input.path)
  const pattern = clean(input.Pattern) || clean(input.Query) || clean(input.pattern)

  if (name === 'Bash' || name === 'run_command') return { type: 'command_execution', command: cmd }
  if (['Edit', 'Write', 'edit_file', 'write_file', 'replace_file_content'].includes(name))
    return { type: 'file_change', changes: [{ path, kind: name.includes('rite') ? 'add' : 'update' }] }
  if (name === 'Read' || name === 'read_file' || name === 'view_file') return { type: 'read_file', text: path }
  if (['Grep', 'Glob', 'List', 'list_dir', 'find_by_name', 'grep_search'].includes(name))
    return { type: 'list_dir', text: pattern || path || '.' }
  const summary = clean(input.toolSummary) || cmd || pattern || path || clean(input.url) || clean(input.query)
  return { type: name.toLowerCase(), text: summary }
}

export async function runAntigravity(
  id: string,
  sender: WebContents,
  params: AntigravityRunParams,
  config: { antigravityPath?: string; antigravityModel?: AntigravityModel }
): Promise<CodexRunResult> {
  killRun(id)

  const { path: agentapiPath, found } = resolveAntigravityPath(config.antigravityPath)
  if (!found) {
    return {
      ok: false,
      error: 'Antigravity not found. Open connection settings to set the path, or install Antigravity.'
    }
  }

  const python = findPython()
  if (!python) {
    return {
      ok: false,
      error: 'Python not found. Install Python 3 to run the Antigravity bridge'
    }
  }

  const bridge = bridgePath()
  const model = params.model ?? config.antigravityModel ?? 'flash'
  const args = [bridge, '--prompt', params.prompt, '--cwd', params.cwd]
  if (model) args.push('--model', model)
  if (params.sessionId) args.push('--resume', params.sessionId)

  const emit = (event: CodexEvent): void => {
    if (!sender.isDestroyed()) sender.send(IPC.antigravity.event, { id, event } satisfies CodexEventPayload)
  }

  return new Promise<CodexRunResult>((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = crossSpawn(python, args, {
        cwd: params.cwd,
        windowsHide: true,
        env: { ...process.env, ANTIGRAVITY_AGENTAPI: agentapiPath, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' }
      }) as ChildProcessWithoutNullStreams
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }

    const run: Run = { child, killed: false }
    runs.set(id, run)

    let sessionId: string | undefined
    let usage: TokenUsage | undefined
    let stdoutBuf = ''
    let rawStdout = ''
    let rawStderr = ''
    let sawJson = false
    let agentText = ''
    let reasoningText = ''
    let emittedTool = false
    const toolSeen = new Set<string>()

    const merge = (acc: string, next: string): string => {
      if (!next) return acc
      if (!acc) return next
      if (next.startsWith(acc)) return next
      if (acc.endsWith(next)) return acc
      return acc + next
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
        return
      }
      sawJson = true
      const sid = pickSession(parsed)
      if (sid && sid !== sessionId) {
        sessionId = sid
        emit({ kind: 'thread', threadId: sid })
      }
      const part = pickPart(parsed)
      if (part) handlePart(part)
      const u = pickUsage(obj(parsed.tokens))
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
    })

    child.on('error', (err) => emit({ kind: 'error', message: err.message }))

    child.on('close', (code) => {
      if (runs.get(id) === run) runs.delete(id)

      const tail = stdoutBuf.trim()
      if (tail) handleLine(tail)
      if (reasoningText.trim()) {
        emit({
          kind: 'item',
          phase: 'completed',
          item: { id: `think_${Math.random().toString(36).slice(2)}`, type: 'reasoning', text: reasoningText.trim() }
        })
      }
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
        const reason = (rawStderr.trim() || rawStdout.trim()).split('\n').slice(-6).join('\n')
        resolve({ ok: false, code, threadId: sessionId, usage, error: reason || `Antigravity bridge exited with code ${code}` })
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

