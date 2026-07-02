import { app, type WebContents } from 'electron'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crossSpawn from 'cross-spawn'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  IPC,
  type CodexCheckResult,
  type CodexEvent,
  type CodexEventPayload,
  type CodexItem,
  type CodexRunResult,
  type GeminiApprovalMode,
  type GeminiRunParams,
  type TokenUsage
} from '@shared/ipc'

/**
 * Drives Google's `gemini` CLI as another local agent backend.
 *
 * Gemini CLI's headless mode supports newline-delimited JSON events via:
 *
 *   gemini --prompt <text> --output-format stream-json
 *
 * The stream emits init/message/tool_use/tool_result/error/result events. We
 * normalize those into the shared CodexEvent shape so the renderer can use the
 * same chat/tool-card UI as the other CLI integrations.
 */

interface Run {
  child: ChildProcessWithoutNullStreams
  killed: boolean
}

interface FileStat {
  kind: string
  added: number
  removed: number
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

export function resolveGeminiPath(configured?: string): { path: string; found: boolean } {
  const want = configured?.trim()
  if (want) {
    if (existsSync(want)) return { path: want, found: true }
    const onPath = findOnPath(want)
    if (onPath) return { path: onPath, found: true }
    return { path: want, found: false }
  }
  const onPath = findOnPath('gemini')
  if (onPath) return { path: onPath, found: true }
  return { path: 'gemini', found: false }
}

// ---------- install / auth probe ----------

function collect(
  file: string,
  args: string[],
  timeoutMs = 8000
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolveResult) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = crossSpawn(file, args, {
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1' }
      }) as ChildProcessWithoutNullStreams
    } catch (err) {
      resolveResult({ code: null, stdout: '', stderr: '', error: err instanceof Error ? err.message : String(err) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (r: { code: number | null; stdout: string; stderr: string; error?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(r)
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

function authState(): { loggedIn: boolean; note: string } {
  const envAuth = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'].some((key) =>
    Boolean(process.env[key]?.trim())
  )
  if (envAuth) return { loggedIn: true, note: 'API key or Google credential environment variable found' }

  const files = [
    join(homedir(), '.gemini', 'oauth_creds.json'),
    join(homedir(), '.gemini', 'google_accounts.json'),
    join(homedir(), '.config', 'gcloud', 'application_default_credentials.json')
  ]
  if (files.some((file) => existsSync(file))) {
    return { loggedIn: true, note: 'Cached Gemini or Google credentials found' }
  }
  return { loggedIn: false, note: 'Run `gemini` once to sign in, or set GEMINI_API_KEY' }
}

export async function checkGemini(configured?: string): Promise<CodexCheckResult> {
  const { path, found } = resolveGeminiPath(configured)
  if (!found) {
    return {
      ok: true,
      installed: false,
      path,
      error: 'Gemini CLI not found. Install it (npm i -g @google/gemini-cli), or set the binary path.'
    }
  }

  const ver = await collect(path, ['--version'])
  if (ver.error || ver.code !== 0) {
    return {
      ok: true,
      installed: false,
      path,
      error: ver.error ?? ver.stderr.trim() ?? 'gemini --version failed'
    }
  }

  const auth = authState()
  return {
    ok: true,
    installed: true,
    path,
    version: (ver.stdout.trim() || ver.stderr.trim()).split('\n')[0] || undefined,
    loggedIn: auth.loggedIn,
    authNote: auth.note
  }
}

// ---------- git change snapshot ----------

function gitOutput(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 5000,
      windowsHide: true
    })
  } catch {
    return null
  }
}

const countLines = (s: string): number => (s.length ? s.split('\n').length : 0)

function untrackedLineStat(cwd: string, pathspec: string): FileStat | null {
  const absolute = resolve(cwd, pathspec)
  if (!existsSync(absolute)) return null
  try {
    const info = statSync(absolute)
    if (!info.isFile() || info.size > 1024 * 1024) return null
    const buf = readFileSync(absolute)
    if (buf.subarray(0, 8192).includes(0)) return null
    return { kind: 'add', added: countLines(buf.toString('utf8')), removed: 0 }
  } catch {
    return null
  }
}

function gitDiffSnapshot(cwd: string): Map<string, FileStat> {
  const out = gitOutput(cwd, ['diff', '--numstat', 'HEAD', '--'])
  const files = new Map<string, FileStat>()
  if (out != null) {
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue
      const [addedRaw, removedRaw, pathspec] = line.split('\t')
      const added = Number(addedRaw)
      const removed = Number(removedRaw)
      if (!pathspec || !Number.isFinite(added) || !Number.isFinite(removed)) continue
      files.set(pathspec, { kind: 'update', added, removed })
    }
  }

  const untracked = gitOutput(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  for (const pathspec of untracked?.split('\0').filter(Boolean) ?? []) {
    const stat = untrackedLineStat(cwd, pathspec)
    if (stat) files.set(pathspec, stat)
  }
  return files
}

function changedFiles(before: Map<string, FileStat>, after: Map<string, FileStat>): Array<FileStat & { path: string }> {
  const paths = new Set([...before.keys(), ...after.keys()])
  const changes: Array<FileStat & { path: string }> = []
  for (const path of paths) {
    const prev = before.get(path)
    const next = after.get(path)
    if (!next) {
      changes.push({ path, kind: 'delete', added: 0, removed: prev?.removed || prev?.added || 0 })
      continue
    }
    if (!prev) {
      changes.push({ path, ...next })
      continue
    }
    if (prev.kind !== next.kind || prev.added !== next.added || prev.removed !== next.removed) {
      changes.push({
        path,
        kind: next.kind,
        added: Math.max(0, next.added - prev.added),
        removed: Math.max(0, next.removed - prev.removed)
      })
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
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

const firstNumber = (...values: unknown[]): number => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function usageFromStats(value: unknown): TokenUsage | undefined {
  const stats = obj(value)
  let inputTokens = firstNumber(
    stats.input_tokens,
    stats.inputTokens,
    stats.prompt_tokens,
    stats.promptTokens,
    stats.input
  )
  let outputTokens = firstNumber(
    stats.output_tokens,
    stats.outputTokens,
    stats.completion_tokens,
    stats.completionTokens,
    stats.output
  )

  const models = obj(stats.models)
  if ((inputTokens === 0 || outputTokens === 0) && Object.keys(models).length > 0) {
    let modelInput = 0
    let modelOutput = 0
    for (const model of Object.values(models)) {
      const tokens = obj(obj(model).tokens)
      modelInput += firstNumber(tokens.input, tokens.prompt, tokens.prompt_tokens)
      modelOutput += firstNumber(tokens.output, tokens.candidates, tokens.thoughts, tokens.output_tokens)
    }
    inputTokens ||= modelInput
    outputTokens ||= modelOutput
  }

  return inputTokens || outputTokens ? { inputTokens, outputTokens } : undefined
}

function mapTool(name: string, input: Record<string, unknown>): Partial<CodexItem> & { type: string } {
  const lower = name.trim().toLowerCase()
  const path = str(input.path) || str(input.file_path) || str(input.filePath) || str(input.absolute_path)
  if (lower.includes('shell') || lower.includes('command')) {
    return { type: 'command_execution', command: str(input.command) || str(input.cmd) }
  }
  if (
    lower.includes('write') ||
    lower.includes('replace') ||
    lower.includes('edit') ||
    lower.includes('patch')
  ) {
    return {
      type: 'file_change',
      changes: [{ path, kind: lower.includes('write') ? 'add' : 'update' }]
    }
  }
  if (lower.includes('read')) return { type: 'read_file', text: path }
  if (lower.includes('grep') || lower.includes('glob') || lower.includes('list') || lower === 'ls') {
    return { type: 'list_dir', text: str(input.pattern) || path || '.' }
  }
  const summary = str(input.command) || str(input.pattern) || path || str(input.url) || str(input.query)
  return { type: lower || 'tool', text: summary }
}

function mergeText(current: string, next: string, isDelta: boolean): string {
  if (!next) return current
  if (isDelta) return current + next
  if (!current || next.startsWith(current)) return next
  if (current.endsWith(next)) return current
  return current + next
}

function geminiArgs(
  params: GeminiRunParams,
  config: { geminiModel?: string; geminiPermission?: GeminiApprovalMode }
): string[] {
  const model = (params.model ?? config.geminiModel ?? '').trim()
  const permission: GeminiApprovalMode = params.permission ?? config.geminiPermission ?? 'yolo'
  const args = [
    '--prompt',
    params.prompt,
    '--output-format',
    'stream-json',
    '--approval-mode',
    permission,
    '--skip-trust'
  ]
  if (model && model !== 'default') args.push('--model', model)
  if (params.sessionId) args.push('--resume', params.sessionId)
  return args
}

export function runGemini(
  id: string,
  sender: WebContents,
  params: GeminiRunParams,
  config: { geminiPath?: string; geminiModel?: string; geminiPermission?: GeminiApprovalMode }
): Promise<CodexRunResult> {
  killRun(id)

  const { path, found } = resolveGeminiPath(config.geminiPath)
  if (!found) {
    return Promise.resolve({
      ok: false,
      error:
        'Gemini CLI not found. Open connection settings to set the binary path, or install the Gemini CLI.'
    })
  }

  const args = geminiArgs(params, config)
  const before = gitDiffSnapshot(params.cwd)

  const emit = (event: CodexEvent): void => {
    if (!sender.isDestroyed()) sender.send(IPC.gemini.event, { id, event } satisfies CodexEventPayload)
  }

  return new Promise<CodexRunResult>((resolveRun) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = crossSpawn(path, args, {
        cwd: params.cwd,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1' }
      }) as ChildProcessWithoutNullStreams
    } catch (err) {
      resolveRun({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }
    try {
      child.stdin.end()
    } catch {
      /* already closed */
    }

    const run: Run = { child, killed: false }
    runs.set(id, run)

    let sessionId = params.sessionId
    let usage: TokenUsage | undefined
    let stdoutBuf = ''
    let stderrBuf = ''
    let rawStdout = ''
    let rawStderr = ''
    let assistantText = ''
    let assistantFlushed = false
    let sawJson = false
    let turnCompleted = false
    let resultError: string | undefined
    let emittedFileChange = false
    const pendingTools = new Map<string, Partial<CodexItem> & { type: string }>()

    emit({ kind: 'turn-started' })
    if (sessionId) emit({ kind: 'thread', threadId: sessionId })

    const flushAssistant = (): void => {
      const text = assistantText.trim()
      if (!text || assistantFlushed) return
      assistantFlushed = true
      emit({
        kind: 'item',
        phase: 'completed',
        item: { id: `msg_${Math.random().toString(36).slice(2)}`, type: 'agent_message', text }
      })
    }

    const handleToolResult = (raw: Record<string, unknown>): void => {
      const toolId = str(raw.tool_id) || str(raw.toolId) || str(raw.id) || `tool_${pendingTools.size}`
      const mapped = pendingTools.get(toolId) ?? { type: 'tool', text: str(raw.tool_name) || str(raw.toolName) }
      pendingTools.delete(toolId)
      const status = str(raw.status).toLowerCase()
      const isError = status === 'error' || raw.error != null
      const output = valueText(raw.output ?? raw.result ?? raw.content ?? raw.error)
      const item: CodexItem = {
        id: toolId,
        status: isError ? 'failed' : 'completed',
        ...mapped
      }
      if (item.type === 'command_execution') {
        item.output = output
        item.exitCode = isError ? 1 : 0
      } else if (output && !item.text) {
        item.text = output
      }
      emit({ kind: 'item', phase: 'completed', item })
    }

    const handleLine = (line: string): void => {
      if (!line.trim()) return
      let raw: Record<string, unknown>
      try {
        raw = JSON.parse(line) as Record<string, unknown>
      } catch {
        emit({ kind: 'notice', text: line })
        return
      }
      sawJson = true
      const type = str(raw.type).toLowerCase()
      if (type === 'init') {
        sessionId = str(raw.session_id) || str(raw.sessionId) || sessionId
        if (sessionId) emit({ kind: 'thread', threadId: sessionId })
      } else if (type === 'message') {
        if (str(raw.role).toLowerCase() !== 'assistant') return
        assistantText = mergeText(assistantText, str(raw.content), raw.delta === true)
      } else if (type === 'tool_use' || type === 'tool_call') {
        const toolId = str(raw.tool_id) || str(raw.toolId) || str(raw.id) || `tool_${pendingTools.size}`
        const mapped = mapTool(str(raw.tool_name) || str(raw.toolName) || str(raw.name), obj(raw.parameters))
        if (mapped.type === 'file_change') emittedFileChange = true
        pendingTools.set(toolId, mapped)
        emit({ kind: 'item', phase: 'started', item: { id: toolId, status: 'in_progress', ...mapped } })
      } else if (type === 'tool_result') {
        handleToolResult(raw)
      } else if (type === 'error') {
        const message = str(raw.message) || valueText(raw.error)
        if (!message) return
        if (str(raw.severity).toLowerCase() === 'warning') emit({ kind: 'notice', text: message })
        else {
          resultError = resultError ?? message
          emit({ kind: 'error', message })
        }
      } else if (type === 'result') {
        usage = usageFromStats(raw.stats) ?? usage
        const status = str(raw.status).toLowerCase()
        const err = obj(raw.error)
        const message = str(err.message) || str(raw.message)
        if (status === 'error') {
          resultError = resultError ?? (message || 'Gemini run failed')
          emit({ kind: 'error', message: resultError })
        }
        flushAssistant()
        emit({ kind: 'turn-completed' })
        turnCompleted = true
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      rawStdout += chunk
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        handleLine(line)
      }
    })

    child.stderr.on('data', (chunk: string) => {
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
      if (runs.get(id) === run) runs.delete(id)
      const stdoutTail = stdoutBuf.trim()
      if (stdoutTail) handleLine(stdoutTail)
      const stderrTail = stderrBuf.trim()
      if (stderrTail) emit({ kind: 'notice', text: stderrTail })

      const changes = changedFiles(before, gitDiffSnapshot(params.cwd))
      if (!emittedFileChange && changes.length > 0) {
        emit({
          kind: 'item',
          phase: 'completed',
          item: {
            id: `files_${Math.random().toString(36).slice(2)}`,
            type: 'file_change',
            changes
          }
        })
      }

      if (!assistantFlushed) {
        if (!assistantText.trim() && !sawJson && code === 0) assistantText = rawStdout.trim()
        flushAssistant()
      }
      if (!turnCompleted) emit({ kind: 'turn-completed' })

      if (run.killed) {
        resolveRun({ ok: true, code, threadId: sessionId, usage, aborted: true })
        return
      }
      if (code === 0 && !resultError) {
        resolveRun({ ok: true, code, threadId: sessionId, usage })
      } else {
        const reason = resultError || (rawStderr.trim() || rawStdout.trim()).split(/\r?\n/).slice(-8).join('\n')
        resolveRun({ ok: false, code, threadId: sessionId, usage, error: reason || `gemini exited with code ${code}` })
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
