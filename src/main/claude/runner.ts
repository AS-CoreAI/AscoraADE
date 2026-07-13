import { app, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  IPC,
  type CodexCheckResult,
  type CodexEvent,
  type CodexItem,
  type CodexRunResult,
  type ClaudePermissionMode,
  type ClaudeRunParams,
  type CodexEventPayload,
  type CopilotLoginResult,
  type TokenUsage
} from '@shared/ipc'
import { openCliLoginTerminal } from '../cli-login'

/**
 * Drives Anthropic's `claude` CLI as a third agent backend (alongside LM Studio
 * and Codex), reusing the user's existing Claude Code subscription/login. We run
 * `claude -p --output-format stream-json --verbose`, which performs Claude Code's
 * own agent loop and streams newline-delimited JSON events. Those are normalised
 * into the shared `CodexEvent` shape (same as Codex) so the renderer renders all
 * three backends with one code path. Multi-turn uses `claude --resume <sid>`.
 *
 * No separate install needed: if `claude` isn't on PATH we fall back to the
 * binary bundled inside the installed "Claude Code" VS Code extension.
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

/** Locate the claude binary bundled in an installed "Claude Code" VS Code extension. */
function bundledClaude(): string | null {
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude'
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
      continue
    }
    const exts = entries.filter((e) => e.startsWith('anthropic.claude-code')).sort().reverse()
    for (const ext of exts) {
      const candidate = join(root, ext, 'resources', 'native-binary', bin)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export function resolveClaudePath(configured?: string): { path: string; found: boolean } {
  const want = configured?.trim()
  if (want) {
    if (existsSync(want)) return { path: want, found: true }
    const onPath = findOnPath(want)
    if (onPath) return { path: onPath, found: true }
    return { path: want, found: false }
  }
  const onPath = findOnPath('claude')
  if (onPath) return { path: onPath, found: true }
  const bundled = bundledClaude()
  if (bundled) return { path: bundled, found: true }
  return { path: 'claude', found: false }
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

const CLAUDE_CREDENTIAL_FILES = (): string[] => [
  join(homedir(), '.claude', '.credentials.json'),
  join(homedir(), '.config', 'claude', '.credentials.json')
]

const CLAUDE_CONFIG_FILE = (): string => join(homedir(), '.claude.json')

interface ClaudeOauthAccount {
  emailAddress?: string
  organizationName?: string
}

/** Read the signed-in identity recorded by Claude Code in ~/.claude.json. */
function readClaudeOauthAccount(): ClaudeOauthAccount | undefined {
  try {
    const raw = readFileSync(CLAUDE_CONFIG_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as { oauthAccount?: ClaudeOauthAccount }
    return parsed.oauthAccount && typeof parsed.oauthAccount === 'object'
      ? parsed.oauthAccount
      : undefined
  } catch {
    return undefined
  }
}

function claudeAccountLabel(): string | undefined {
  const account = readClaudeOauthAccount()
  if (!account?.emailAddress) return undefined
  return account.organizationName
    ? `${account.emailAddress} (${account.organizationName})`
    : account.emailAddress
}

/**
 * Login signal: an OAuth credentials file on disk, or an oauthAccount recorded
 * in ~/.claude.json (macOS keeps the tokens in the Keychain, so the config
 * entry is the only visible marker there).
 */
function looksLoggedIn(): boolean {
  return (
    CLAUDE_CREDENTIAL_FILES().some((file) => existsSync(file)) ||
    readClaudeOauthAccount()?.emailAddress !== undefined
  )
}

export function openClaudeLogin(configured?: string): CopilotLoginResult {
  const { path, found } = resolveClaudePath(configured)
  if (!found) {
    return {
      ok: false,
      error: 'Claude Code CLI not found. Install it, or set the binary path in agent backend settings.'
    }
  }
  // `claude /login` starts the interactive REPL and immediately runs the
  // sign-in flow; on a logged-out install plain `claude` would prompt too.
  return openCliLoginTerminal('Claude login', path, ['/login'])
}

/**
 * Sign out the way `/logout` does: drop the stored OAuth credentials and the
 * account marker from ~/.claude.json, keeping every other setting intact.
 */
export function logoutClaude(): CopilotLoginResult {
  let removed = false
  try {
    for (const file of CLAUDE_CREDENTIAL_FILES()) {
      if (existsSync(file)) {
        rmSync(file)
        removed = true
      }
    }
    const configFile = CLAUDE_CONFIG_FILE()
    if (existsSync(configFile)) {
      const parsed = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>
      if ('oauthAccount' in parsed) {
        delete parsed.oauthAccount
        writeFileSync(configFile, JSON.stringify(parsed, null, 2))
        removed = true
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!removed) return { ok: false, error: 'No stored Claude Code credentials were found.' }
  return { ok: true }
}

export async function checkClaude(configured?: string): Promise<CodexCheckResult> {
  const { path, found } = resolveClaudePath(configured)
  if (!found) {
    return {
      ok: true,
      installed: false,
      path,
      error:
        'Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code) or the "Claude Code" VS Code extension, or set the binary path.'
    }
  }
  const ver = await collect(path, ['--version'])
  if (ver.error || ver.code !== 0) {
    return { ok: true, installed: false, path, error: ver.error ?? ver.stderr.trim() ?? 'claude --version failed' }
  }
  const loggedIn = looksLoggedIn()
  return {
    ok: true,
    installed: true,
    path,
    version: ver.stdout.trim().split('\n')[0] || undefined,
    loggedIn,
    authNote: loggedIn ? 'Signed in (subscription)' : 'Run `claude` once to sign in',
    account: loggedIn ? claudeAccountLabel() : undefined
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

/** Flatten a tool_result `content` (string | block array) to plain text. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && 'text' in b ? str((b as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

const countLines = (s: string): number => (s.length ? s.split('\n').length : 0)

/**
 * Added/removed line counts between two text blobs, using the same prefix/suffix
 * trimming as the renderer's `diffStat` so the popover numbers match its edit cards.
 */
function diffLineStat(oldText: string, newText: string): { added: number; removed: number } {
  if (oldText === newText) return { added: 0, removed: 0 }
  const o = oldText.length ? oldText.split('\n') : []
  const n = newText.length ? newText.split('\n') : []
  let p = 0
  while (p < o.length && p < n.length && o[p] === n[p]) p += 1
  let s = 0
  while (s < o.length - p && s < n.length - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s += 1
  return { removed: o.length - p - s, added: n.length - p - s }
}

/**
 * Line counts for a Claude file-edit tool, derived from its input. The CLI doesn't
 * report +/- counts in stream-json (Codex does), so without this the change popover
 * renders "+? -?" for everything Claude touches.
 */
function editLineStat(name: string, input: Record<string, unknown>): { added: number; removed: number } {
  if (name === 'Write') return { added: countLines(str(input.content)), removed: 0 }
  if (name === 'NotebookEdit') return { added: countLines(str(input.new_source)), removed: 0 }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    let added = 0
    let removed = 0
    for (const e of input.edits as Record<string, unknown>[]) {
      const d = diffLineStat(str(e.old_string), str(e.new_string))
      added += d.added
      removed += d.removed
    }
    return { added, removed }
  }
  return diffLineStat(str(input.old_string), str(input.new_string)) // Edit / Update
}

/** Map a Claude tool_use to our normalized item fields (matching Codex's vocab). */
function mapTool(name: string, input: Record<string, unknown>): Partial<CodexItem> & { type: string } {
  if (name === 'Bash') return { type: 'command_execution', command: str(input.command) }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Update'].includes(name)) {
    const path = str(input.file_path) || str(input.path) || str(input.notebook_path)
    const { added, removed } = editLineStat(name, input)
    return { type: 'file_change', changes: [{ path, kind: name === 'Write' ? 'add' : 'update', added, removed }] }
  }
  if (name === 'Read') return { type: 'read_file', text: str(input.file_path) || str(input.path) }
  if (['Grep', 'Glob', 'LS'].includes(name))
    return { type: 'list_dir', text: str(input.pattern) || str(input.path) || '.' }
  const summary = str(input.command) || str(input.pattern) || str(input.file_path) || str(input.url) || str(input.prompt)
  return { type: name.toLowerCase(), text: summary }
}

export function runClaude(
  id: string,
  sender: WebContents,
  params: ClaudeRunParams,
  config: { claudePath?: string; claudeModel?: string; claudePermission?: ClaudePermissionMode }
): Promise<CodexRunResult> {
  killRun(id)

  const { path, found } = resolveClaudePath(config.claudePath)
  if (!found) {
    return Promise.resolve({
      ok: false,
      error:
        'Claude Code CLI not found. Open connection settings to set the binary path, or install the Claude Code CLI / VS Code extension.'
    })
  }

  const model = (params.model ?? config.claudeModel ?? '').trim()
  const permission: ClaudePermissionMode = params.permission ?? config.claudePermission ?? 'acceptEdits'

  const args = ['-p', '--output-format', 'stream-json', '--verbose']
  if (model && model !== 'default') args.push('--model', model)
  if (permission === 'bypassPermissions') args.push('--dangerously-skip-permissions')
  else args.push('--permission-mode', permission)
  if (params.sessionId) args.push('--resume', params.sessionId)
  args.push(params.prompt) // prompt as a positional arg (spawn array → no shell escaping needed)

  const emit = (event: CodexEvent): void => {
    if (!sender.isDestroyed()) sender.send(IPC.claude.event, { id, event } satisfies CodexEventPayload)
  }

  return new Promise<CodexRunResult>((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(path, args, { cwd: params.cwd, windowsHide: true, env: process.env })
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }
    // Prompt is passed as an arg; close stdin so claude never blocks on it.
    try {
      child.stdin.end()
    } catch {
      /* already closed */
    }

    const run: Run = { child, killed: false }
    runs.set(id, run)

    let sessionId: string | undefined
    let usage: TokenUsage | undefined
    let stdoutBuf = ''
    let stderrBuf = ''
    // tool_use id → its mapped item, so the matching tool_result updates it.
    const pendingTools = new Map<string, Partial<CodexItem> & { type: string }>()

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    child.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        let obj: Record<string, unknown>
        try {
          obj = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue // not JSON (stdout should be pure NDJSON under stream-json)
        }
        const type = String(obj.type ?? '')

        if (type === 'system' && obj.subtype === 'init') {
          sessionId = str(obj.session_id) || sessionId
          if (sessionId) emit({ kind: 'thread', threadId: sessionId })
        } else if (type === 'assistant') {
          const content = ((obj.message as Record<string, unknown>)?.content ?? []) as Record<string, unknown>[]
          for (const block of Array.isArray(content) ? content : []) {
            if (block.type === 'thinking' && str(block.thinking).trim()) {
              emit({
                kind: 'item',
                phase: 'completed',
                item: { id: `think_${Math.random().toString(36).slice(2)}`, type: 'reasoning', text: str(block.thinking) }
              })
            } else if (block.type === 'text' && str(block.text).trim()) {
              emit({
                kind: 'item',
                phase: 'completed',
                item: { id: `msg_${Math.random().toString(36).slice(2)}`, type: 'agent_message', text: str(block.text) }
              })
            } else if (block.type === 'tool_use') {
              const toolId = str(block.id)
              const mapped = mapTool(str(block.name), (block.input as Record<string, unknown>) ?? {})
              pendingTools.set(toolId, mapped)
              emit({ kind: 'item', phase: 'started', item: { id: toolId, status: 'in_progress', ...mapped } })
            }
          }
        } else if (type === 'user') {
          const content = ((obj.message as Record<string, unknown>)?.content ?? []) as Record<string, unknown>[]
          for (const block of Array.isArray(content) ? content : []) {
            if (block.type !== 'tool_result') continue
            const toolId = str(block.tool_use_id)
            const mapped = pendingTools.get(toolId) ?? { type: 'tool' }
            pendingTools.delete(toolId)
            const isErr = block.is_error === true
            const out = resultText(block.content)
            emit({
              kind: 'item',
              phase: 'completed',
              item: {
                id: toolId,
                status: isErr ? 'failed' : 'completed',
                ...mapped,
                ...(mapped.type === 'command_execution'
                  ? { output: out, exitCode: isErr ? 1 : 0 }
                  : {})
              }
            })
          }
        } else if (type === 'result') {
          sessionId = str(obj.session_id) || sessionId
          const u = obj.usage as Record<string, number> | undefined
          if (u) {
            const input =
              (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
            usage = { inputTokens: input, outputTokens: u.output_tokens ?? 0 }
          }
          if (obj.is_error === true) {
            emit({ kind: 'error', message: str(obj.result) || 'Claude run failed' })
          }
          emit({ kind: 'turn-completed' })
        } else if (type === 'rate_limit_event') {
          const info = obj.rate_limit_info as Record<string, unknown> | undefined
          if (info && info.status && info.status !== 'allowed') {
            emit({ kind: 'notice', text: `Rate limit: ${str(info.status)}` })
          }
        }
      }
    })

    child.stderr?.on('data', (chunk: string) => {
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
      if (run.killed) {
        resolve({ ok: true, code, threadId: sessionId, usage, aborted: true })
        return
      }
      if (code === 0) resolve({ ok: true, code, threadId: sessionId, usage })
      else resolve({ ok: false, code, threadId: sessionId, usage, error: stderrBuf.trim() || `claude exited with code ${code}` })
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
