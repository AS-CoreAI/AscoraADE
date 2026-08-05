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
  type CopilotLoginResult,
  type GrokPermissionMode,
  type GrokReasoning,
  type GrokRunParams,
  type TokenUsage
} from '@shared/ipc'
import { openCliLoginTerminal } from '../cli-login'

/**
 * Drives xAI's Grok Build CLI (`grok`) as another local agent backend.
 *
 * Headless mode:
 *
 *   grok --no-auto-update -p <prompt> --output-format streaming-json
 *        --permission-mode <mode> [--model …] [--reasoning-effort …] [--resume <id>]
 *
 * The stream emits thought/text/tool_call/tool_call_update/usage/end/error events.
 * We normalize those into the shared CodexEvent shape so the renderer can use the
 * same chat/tool-card UI as Codex, Claude, Gemini, and the other CLIs.
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

/** Prefer the managed install under ~/.grok/bin when PATH has no grok. */
function findManagedInstall(): string | null {
  const bin = process.platform === 'win32' ? 'grok.exe' : 'grok'
  const candidate = join(homedir(), '.grok', 'bin', bin)
  return existsSync(candidate) ? candidate : null
}

export function resolveGrokPath(configured?: string): { path: string; found: boolean } {
  const want = configured?.trim()
  if (want) {
    if (existsSync(want)) return { path: want, found: true }
    const onPath = findOnPath(want)
    if (onPath) return { path: onPath, found: true }
    return { path: want, found: false }
  }
  const onPath = findOnPath('grok')
  if (onPath) return { path: onPath, found: true }
  const managed = findManagedInstall()
  if (managed) return { path: managed, found: true }
  return { path: 'grok', found: false }
}

// ---------- install / auth probe ----------

function collect(
  file: string,
  args: string[],
  timeoutMs = 12000
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolveResult) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = crossSpawn(file, args, {
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', GROK_DISABLE_AUTOUPDATER: '1' }
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

const AUTH_FILE = (): string => join(homedir(), '.grok', 'auth.json')

interface GrokAuthEntry {
  email?: string
  first_name?: string
  last_name?: string
  auth_mode?: string
  key?: string
  expires_at?: string
}

function readAuthEntries(): GrokAuthEntry[] {
  const path = AUTH_FILE()
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return Object.values(raw)
      .map((value) => (value && typeof value === 'object' ? (value as GrokAuthEntry) : null))
      .filter((entry): entry is GrokAuthEntry => !!entry)
  } catch {
    return []
  }
}

function grokAccountLabel(): string | undefined {
  for (const entry of readAuthEntries()) {
    if (entry.email?.trim()) return entry.email.trim()
    const name = [entry.first_name, entry.last_name].filter(Boolean).join(' ').trim()
    if (name) return name
  }
  return undefined
}

function authState(): { loggedIn: boolean; note: string; account?: string } {
  if (process.env.XAI_API_KEY?.trim()) {
    return { loggedIn: true, note: 'XAI_API_KEY environment variable found', account: 'API key' }
  }
  const entries = readAuthEntries()
  if (entries.length === 0) {
    return { loggedIn: false, note: 'Run `grok login` once, or set XAI_API_KEY' }
  }
  const account = grokAccountLabel()
  return {
    loggedIn: true,
    note: account ? `Signed in as ${account}` : 'Signed in (subscription)',
    account
  }
}

export function openGrokLogin(configured?: string): CopilotLoginResult {
  const { path, found } = resolveGrokPath(configured)
  if (!found) {
    return {
      ok: false,
      error:
        'Grok CLI not found. Install it (`curl -fsSL https://x.ai/cli/install.sh | bash` or npm i -g @xai-official/grok), or set the binary path.'
    }
  }
  return openCliLoginTerminal('Grok login', path, ['login'])
}

export async function logoutGrok(configured?: string): Promise<CopilotLoginResult> {
  const { path, found } = resolveGrokPath(configured)
  if (!found) {
    return {
      ok: false,
      error: 'Grok CLI not found. Install it, or set the binary path in agent backend settings.'
    }
  }
  const result = await collect(path, ['logout'], 15000)
  if (result.error) return { ok: false, error: result.error }
  if (result.code !== 0) {
    const text = (result.stderr || result.stdout).trim()
    return { ok: false, error: text.split('\n').find((l) => l.trim()) || 'grok logout failed.' }
  }
  return { ok: true }
}

export async function checkGrok(configured?: string): Promise<CodexCheckResult> {
  const { path, found } = resolveGrokPath(configured)
  if (!found) {
    return {
      ok: true,
      installed: false,
      path,
      error:
        'Grok CLI not found. Install it (`curl -fsSL https://x.ai/cli/install.sh | bash` or npm i -g @xai-official/grok), or set the binary path.'
    }
  }

  const ver = await collect(path, ['--version'])
  if (ver.error || ver.code !== 0) {
    return {
      ok: true,
      installed: false,
      path,
      error: ver.error ?? ver.stderr.trim() ?? 'grok --version failed'
    }
  }

  const auth = authState()
  return {
    ok: true,
    installed: true,
    path,
    version: (ver.stdout.trim() || ver.stderr.trim()).split('\n')[0] || undefined,
    loggedIn: auth.loggedIn,
    authNote: auth.note,
    account: auth.account
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
  if (Array.isArray(value)) {
    // Grok shell output sometimes arrives as a byte array.
    if (value.every((n) => typeof n === 'number' && n >= 0 && n <= 255)) {
      try {
        return Buffer.from(value as number[]).toString('utf8')
      } catch {
        /* fall through */
      }
    }
    return value.map(valueText).filter(Boolean).join('\n')
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function usageFromStats(value: unknown): TokenUsage | undefined {
  const stats = obj(value)
  // Grok reports uncached input separately from cache hits; sum them for analytics.
  const uncached = firstNumber(stats.input_tokens, stats.inputTokens)
  const cacheRead = firstNumber(stats.cache_read_input_tokens, stats.cacheReadInputTokens)
  const cacheWrite = firstNumber(stats.cache_creation_input_tokens, stats.cacheCreationInputTokens)
  const inputTokens = uncached + cacheRead + cacheWrite
  const outputTokens = firstNumber(stats.output_tokens, stats.outputTokens, stats.output)
  return inputTokens || outputTokens ? { inputTokens, outputTokens } : undefined
}

function mapTool(
  name: string,
  kind: string,
  input: Record<string, unknown>
): Partial<CodexItem> & { type: string } {
  const lower = (name || kind).trim().toLowerCase()
  const path =
    str(input.path) ||
    str(input.file_path) ||
    str(input.filePath) ||
    str(input.target_file) ||
    str(input.absolute_path)
  if (
    lower.includes('run_terminal') ||
    lower.includes('bash') ||
    lower.includes('shell') ||
    lower === 'execute' ||
    kind === 'execute'
  ) {
    return { type: 'command_execution', command: str(input.command) || str(input.cmd) }
  }
  if (
    lower.includes('write') ||
    lower.includes('search_replace') ||
    lower.includes('str_replace') ||
    lower.includes('edit') ||
    lower.includes('patch') ||
    kind === 'edit'
  ) {
    return {
      type: 'file_change',
      changes: [{ path, kind: lower.includes('write') ? 'add' : 'update' }]
    }
  }
  if (lower.includes('read') || kind === 'read') return { type: 'read_file', text: path }
  if (lower.includes('grep') || lower.includes('glob') || lower.includes('list') || lower === 'ls') {
    return { type: 'list_dir', text: str(input.pattern) || path || str(input.query) || '.' }
  }
  if (lower.includes('todo')) {
    return { type: 'todo', text: valueText(input.todos ?? input.items ?? input) }
  }
  const summary =
    str(input.command) ||
    str(input.pattern) ||
    path ||
    str(input.url) ||
    str(input.query) ||
    str(input.description) ||
    str(input.prompt)
  return { type: lower || 'tool', text: summary }
}

function mergeText(current: string, next: string): string {
  if (!next) return current
  if (!current) return next
  if (next.startsWith(current)) return next
  if (current.endsWith(next)) return current
  return current + next
}

function toolOutput(raw: Record<string, unknown>): string {
  const output = raw.rawOutput ?? raw.output ?? raw.result ?? raw.content
  const asObj = obj(output)
  if (asObj.output_for_prompt != null) return valueText(asObj.output_for_prompt)
  if (asObj.output != null) return valueText(asObj.output)
  if (Array.isArray(raw.content)) {
    const parts: string[] = []
    for (const block of raw.content) {
      const b = obj(block)
      const inner = obj(b.content)
      const text = str(inner.text) || str(b.text)
      if (text) parts.push(text)
    }
    if (parts.length) return parts.join('')
  }
  return valueText(output)
}

function exitCodeFrom(raw: Record<string, unknown>, status: string): number | undefined {
  const output = obj(raw.rawOutput ?? raw.output)
  if (typeof output.exit_code === 'number') return output.exit_code
  if (typeof output.exitCode === 'number') return output.exitCode
  if (status === 'failed' || status === 'error') return 1
  if (status === 'completed') return 0
  return undefined
}

function grokArgs(
  params: GrokRunParams,
  config: {
    grokModel?: string
    grokPermission?: GrokPermissionMode
    grokReasoning?: GrokReasoning | ''
  }
): string[] {
  const model = (params.model ?? config.grokModel ?? '').trim()
  const permission: GrokPermissionMode = params.permission ?? config.grokPermission ?? 'bypassPermissions'
  const reasoning = params.reasoning ?? config.grokReasoning ?? ''
  const args = [
    '--no-auto-update',
    '-p',
    params.prompt,
    '--output-format',
    'streaming-json',
    '--permission-mode',
    permission,
    '--cwd',
    params.cwd
  ]
  // Always-approve when the mode is fully autonomous so headless runs never
  // stall waiting for a TTY confirmation that will never come.
  if (permission === 'bypassPermissions' || permission === 'dontAsk') {
    args.push('--always-approve')
  }
  if (model && model !== 'default') args.push('--model', model)
  if (reasoning) args.push('--reasoning-effort', reasoning)
  if (params.sessionId) args.push('--resume', params.sessionId)
  return args
}

export function runGrok(
  id: string,
  sender: WebContents,
  params: GrokRunParams,
  config: {
    grokPath?: string
    grokModel?: string
    grokPermission?: GrokPermissionMode
    grokReasoning?: GrokReasoning | ''
  }
): Promise<CodexRunResult> {
  killRun(id)

  const { path, found } = resolveGrokPath(config.grokPath)
  if (!found) {
    return Promise.resolve({
      ok: false,
      error:
        'Grok CLI not found. Open connection settings to set the binary path, or install the Grok Build CLI.'
    })
  }

  const args = grokArgs(params, config)
  const before = gitDiffSnapshot(params.cwd)

  const emit = (event: CodexEvent): void => {
    if (!sender.isDestroyed()) sender.send(IPC.grok.event, { id, event } satisfies CodexEventPayload)
  }

  return new Promise<CodexRunResult>((resolveRun) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = crossSpawn(path, args, {
        cwd: params.cwd,
        windowsHide: true,
        env: {
          ...process.env,
          NO_COLOR: '1',
          GROK_DISABLE_AUTOUPDATER: '1'
        }
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
    let reasoningText = ''
    let assistantFlushed = false
    let reasoningFlushed = false
    let sawJson = false
    let turnCompleted = false
    let resultError: string | undefined
    let emittedFileChange = false
    const pendingTools = new Map<string, Partial<CodexItem> & { type: string }>()

    emit({ kind: 'turn-started' })
    if (sessionId) emit({ kind: 'thread', threadId: sessionId })

    const flushReasoning = (): void => {
      const text = reasoningText.trim()
      if (!text || reasoningFlushed) return
      reasoningFlushed = true
      emit({
        kind: 'item',
        phase: 'completed',
        item: { id: `think_${Math.random().toString(36).slice(2)}`, type: 'reasoning', text }
      })
    }

    const flushAssistant = (): void => {
      flushReasoning()
      const text = assistantText.trim()
      if (!text || assistantFlushed) return
      assistantFlushed = true
      emit({
        kind: 'item',
        phase: 'completed',
        item: { id: `msg_${Math.random().toString(36).slice(2)}`, type: 'agent_message', text }
      })
    }

    const emitTool = (
      toolId: string,
      mapped: Partial<CodexItem> & { type: string },
      status: string,
      raw: Record<string, unknown>
    ): void => {
      const normalized = status.toLowerCase()
      const isDone = normalized === 'completed' || normalized === 'failed' || normalized === 'error'
      const isError = normalized === 'failed' || normalized === 'error'
      const phase = isDone ? 'completed' : 'started'
      const item: CodexItem = {
        id: toolId,
        status: isError ? 'failed' : isDone ? 'completed' : 'in_progress',
        ...mapped
      }
      if (item.type === 'command_execution') {
        const output = toolOutput(raw)
        if (output) item.output = output
        const exit = exitCodeFrom(raw, normalized)
        if (exit !== undefined) item.exitCode = exit
      } else if (item.type === 'file_change') {
        emittedFileChange = true
      } else {
        const output = toolOutput(raw)
        if (output && !item.text) item.text = output
      }
      emit({ kind: 'item', phase, item })
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

      if (type === 'thought') {
        reasoningText = mergeText(reasoningText, str(raw.data) || str(raw.text) || str(raw.content))
        return
      }

      if (type === 'text') {
        // Flush reasoning before the first answer chunk so the UI mirrors Grok's order.
        if (reasoningText.trim() && !reasoningFlushed) flushReasoning()
        assistantText = mergeText(assistantText, str(raw.data) || str(raw.text) || str(raw.content))
        return
      }

      if (type === 'tool_call') {
        const toolId = str(raw.toolCallId) || str(raw.tool_call_id) || str(raw.id) || `tool_${pendingTools.size}`
        const mapped = mapTool(
          str(raw.toolName) || str(raw.tool_name) || str(raw.title) || str(raw.name),
          str(raw.kind),
          obj(raw.rawInput ?? raw.input ?? raw.parameters)
        )
        if (mapped.type === 'file_change') emittedFileChange = true
        pendingTools.set(toolId, mapped)
        emitTool(toolId, mapped, str(raw.status) || 'in_progress', raw)
        return
      }

      if (type === 'tool_call_update') {
        const toolId = str(raw.toolCallId) || str(raw.tool_call_id) || str(raw.id)
        if (!toolId) return
        const mapped =
          pendingTools.get(toolId) ??
          mapTool(str(raw.toolName) || str(raw.title), str(raw.kind), obj(raw.rawInput ?? raw.input))
        pendingTools.set(toolId, mapped)
        const status = str(raw.status)
        // Ignore pure progress ticks without a status (content streaming).
        if (!status) {
          if (mapped.type === 'command_execution') {
            const output = toolOutput(raw)
            if (output) {
              emit({
                kind: 'item',
                phase: 'updated',
                item: {
                  id: toolId,
                  status: 'in_progress',
                  ...mapped,
                  output,
                  exitCode: exitCodeFrom(raw, 'in_progress')
                }
              })
            }
          }
          return
        }
        if (status.toLowerCase() === 'completed' || status.toLowerCase() === 'failed') {
          pendingTools.delete(toolId)
        }
        emitTool(toolId, mapped, status, raw)
        return
      }

      if (type === 'usage') {
        usage = usageFromStats(raw.usage) ?? usage
        return
      }

      if (type === 'end') {
        sessionId = str(raw.sessionId) || str(raw.session_id) || sessionId
        if (sessionId) emit({ kind: 'thread', threadId: sessionId })
        usage = usageFromStats(raw.usage) ?? usage
        const stop = str(raw.stopReason || raw.stop_reason).toLowerCase()
        if (stop && stop !== 'end_turn' && stop !== 'stop' && stop !== 'completed') {
          // max_tokens / cancelled / refusal still finish the turn; surface only hard errors.
          if (stop === 'refusal') {
            resultError = resultError ?? 'Grok refused to continue this turn.'
            emit({ kind: 'error', message: resultError })
          }
        }
        flushAssistant()
        emit({ kind: 'turn-completed' })
        turnCompleted = true
        return
      }

      if (type === 'error') {
        const message = str(raw.message) || valueText(raw.error) || 'Grok run failed'
        resultError = resultError ?? message
        emit({ kind: 'error', message })
        return
      }

      // plan / available_commands / auto_compact_* — ignore for the chat UI
      const sid = str(raw.sessionId) || str(raw.session_id)
      if (sid && sid !== sessionId) {
        sessionId = sid
        emit({ kind: 'thread', threadId: sid })
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
      } else if (!reasoningFlushed && reasoningText.trim()) {
        flushReasoning()
      }
      if (!turnCompleted) emit({ kind: 'turn-completed' })

      if (run.killed) {
        resolveRun({ ok: true, code, threadId: sessionId, usage, aborted: true })
        return
      }
      if (code === 0 && !resultError) {
        resolveRun({ ok: true, code, threadId: sessionId, usage })
      } else {
        const reason =
          resultError || (rawStderr.trim() || rawStdout.trim()).split(/\r?\n/).slice(-8).join('\n')
        resolveRun({
          ok: false,
          code,
          threadId: sessionId,
          usage,
          error: reason || `grok exited with code ${code}`
        })
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
