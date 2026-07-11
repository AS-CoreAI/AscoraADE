import { ipcMain } from 'electron'
import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import {
  IPC,
  EXCLUDED_DIRS,
  type AgentDirEntry,
  type AgentEditResult,
  type AgentListResult,
  type AgentReadRange,
  type AgentReadResult,
  type AgentRunResult,
  type AgentSearchMatch,
  type AgentSearchOptions,
  type AgentSearchResult,
  type AgentWriteResult
} from '@shared/ipc'

/**
 * Tool primitives the agent loop calls (see store.ts). Every path is resolved
 * relative to the workspace `root` and confined to it — the model never gets to
 * touch files outside the open folder. `run_command` is a one-shot exec (no PTY)
 * with a timeout; non-zero exits are reported, not thrown.
 */

const MAX_READ_BYTES = 1024 * 1024 // 1 MB — keep tool output within token budgets
const MAX_RANGE_BYTES = 8 * 1024 * 1024 // ranged reads may slice a bigger file
const RUN_TIMEOUT_MS = 60_000
const RUN_MAX_BUFFER = 8 * 1024 * 1024
const SEARCH_MAX_MATCHES = 200
const SEARCH_MAX_FILE_BYTES = 1024 * 1024
const SEARCH_LINE_CAP = 240
const SEARCH_MAX_CONTEXT = 10 // cap context lines so output stays token-bounded

class AgentError extends Error {}

/**
 * Compile a glob (as used by ripgrep's `--glob`) into a RegExp matched against a
 * file's forward-slashed, repo-relative path. Supports `**` (any depth, incl.
 * path separators), `*` (within a segment), `?` (one non-separator char) and
 * `{a,b}` alternations. A pattern with no `/` matches the file's basename too,
 * so `*.ts` behaves like ripgrep (matches at any depth).
 */
function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**` spans directories; swallow an immediately following slash.
        re += '.*'
        i += 1
        if (glob[i + 1] === '/') i += 1
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else if (ch === '{') {
      re += '(?:'
    } else if (ch === '}') {
      re += ')'
    } else if (ch === ',') {
      re += '|'
    } else if ('.+^$()|[]\\'.includes(ch)) {
      re += '\\' + ch
    } else {
      re += ch
    }
  }
  return new RegExp('^' + re + '$')
}

/** A compiled matcher decides whether a repo-relative path is in scope. */
function makeGlobFilter(glob?: string): (relPath: string) => boolean {
  if (!glob || !glob.trim()) return () => true
  const rooted = globToRegExp(glob.trim())
  // A bare pattern (no slash) should also match by basename, like ripgrep.
  const bare = !glob.includes('/') ? globToRegExp(glob.trim()) : null
  return (relPath: string) => rooted.test(relPath) || (bare != null && bare.test(relPath.split('/').pop() ?? ''))
}

/** A compiled line matcher (literal substring or user-supplied regex). */
interface LineMatcher {
  test: (line: string) => boolean
}

function makeLineMatcher(query: string, regex: boolean, caseSensitive: boolean): LineMatcher {
  if (regex) {
    const rx = new RegExp(query, caseSensitive ? '' : 'i')
    return { test: (line) => rx.test(line) }
  }
  if (caseSensitive) return { test: (line) => line.includes(query) }
  const needle = query.toLowerCase()
  return { test: (line) => line.toLowerCase().includes(needle) }
}

/** Resolve `rel` under `root`, refusing escapes (`..`, absolute, NUL). */
function resolveInside(root: string, rel: string): string {
  if (rel == null || rel.includes('\0')) throw new AgentError('Invalid path.')
  const cleaned = rel.trim().replace(/^[/\\]+/, '') // treat leading slash as root-relative
  const absolute = resolve(root, cleaned || '.')
  const within = relative(root, absolute)
  if (within.startsWith('..') || isAbsolute(within)) {
    throw new AgentError('Path is outside the workspace.')
  }
  return absolute
}

function toRel(root: string, absolute: string): string {
  const rel = relative(root, absolute).replace(/\\/g, '/')
  return rel === '' ? '.' : rel
}

function errResult(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) }
}

async function listDir(root: string, rel: string): Promise<AgentListResult> {
  try {
    const dir = resolveInside(root, rel || '.')
    const dirents = await readdir(dir, { withFileTypes: true })
    const entries: AgentDirEntry[] = dirents
      .filter((d) => !(d.isDirectory() && EXCLUDED_DIRS.has(d.name)))
      .map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file' }) as AgentDirEntry)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    return { ok: true, path: toRel(root, dir), entries }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

async function readFileTool(
  root: string,
  rel: string,
  range?: AgentReadRange
): Promise<AgentReadResult> {
  try {
    const file = resolveInside(root, rel)
    const info = await stat(file)
    if (info.isDirectory()) throw new AgentError('Path is a directory, not a file.')
    const sliced = !!range && (range.startLine != null || range.endLine != null)
    const sizeCap = sliced ? MAX_RANGE_BYTES : MAX_READ_BYTES
    if (info.size > sizeCap) {
      return { ok: true, path: toRel(root, file), truncated: true, content: '' }
    }
    const buf = await readFile(file)
    if (buf.subarray(0, 8192).includes(0)) {
      return { ok: true, path: toRel(root, file), truncated: true, content: '' }
    }
    const text = buf.toString('utf8')
    if (!sliced) {
      return {
        ok: true,
        path: toRel(root, file),
        content: text,
        truncated: false,
        totalLines: text.length === 0 ? 0 : text.split('\n').length
      }
    }
    const lines = text.split('\n')
    const totalLines = lines.length
    const start = Math.max(1, Math.floor(range?.startLine ?? 1))
    const end = Math.min(totalLines, Math.floor(range?.endLine ?? totalLines))
    const slice = end >= start ? lines.slice(start - 1, end).join('\n') : ''
    return {
      ok: true,
      path: toRel(root, file),
      content: slice,
      truncated: false,
      startLine: start,
      endLine: end,
      totalLines
    }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

/**
 * In-place edit: replace `oldString` with `newString`. Surgical alternative to
 * write_file so the model can change a few lines without re-emitting the whole
 * file. By default the first occurrence is replaced (and it must be unique
 * enough to match exactly once); `replaceAll` swaps every occurrence.
 */
async function editFileTool(
  root: string,
  rel: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): Promise<AgentEditResult> {
  try {
    const file = resolveInside(root, rel)
    if (!rel || toRel(root, file) === '.') throw new AgentError('A file path is required.')
    if (typeof oldString !== 'string' || oldString === '') {
      throw new AgentError('old_string is required and cannot be empty.')
    }
    const info = await stat(file).catch(() => {
      throw new AgentError('File not found. Use write_file to create a new file.')
    })
    if (info.isDirectory()) throw new AgentError('Path is a directory, not a file.')
    const buf = await readFile(file)
    if (buf.subarray(0, 8192).includes(0)) throw new AgentError('Cannot edit a binary file.')
    const text = buf.toString('utf8')
    const replacement = typeof newString === 'string' ? newString : String(newString ?? '')

    let next: string
    let replacements: number
    if (replaceAll) {
      const parts = text.split(oldString)
      replacements = parts.length - 1
      if (replacements === 0) throw new AgentError('old_string was not found in the file.')
      next = parts.join(replacement)
    } else {
      const idx = text.indexOf(oldString)
      if (idx === -1) throw new AgentError('old_string was not found in the file.')
      if (text.indexOf(oldString, idx + oldString.length) !== -1) {
        throw new AgentError(
          'old_string is not unique. Add surrounding context to match exactly once, or set replace_all.'
        )
      }
      replacements = 1
      next = text.slice(0, idx) + replacement + text.slice(idx + oldString.length)
    }
    await writeFile(file, next, 'utf8')
    return { ok: true, path: toRel(root, file), replacements }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

interface SearchCtx {
  root: string
  matcher: LineMatcher
  inScope: (relPath: string) => boolean
  context: number
  matches: AgentSearchMatch[]
  signal?: AbortSignal
}

/** Recursively collect content matches under `dir`. Returns true when capped. */
async function walkSearch(ctx: SearchCtx, dir: string): Promise<boolean> {
  if (ctx.signal?.aborted) throw new AgentError('Search aborted.')
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  // Stable, shallow-first ordering keeps results readable and deterministic.
  dirents.sort((a, b) => a.name.localeCompare(b.name))
  for (const d of dirents) {
    if (ctx.signal?.aborted) throw new AgentError('Search aborted.')
    if (ctx.matches.length >= SEARCH_MAX_MATCHES) return true
    if (d.isDirectory()) {
      if (EXCLUDED_DIRS.has(d.name)) continue
      const more = await walkSearch(ctx, join(dir, d.name))
      if (more) return true
      continue
    }
    if (!d.isFile()) continue
    const full = join(dir, d.name)
    const rel = toRel(ctx.root, full)
    if (!ctx.inScope(rel)) continue
    let buf: Buffer
    try {
      const info = await stat(full)
      if (info.size > SEARCH_MAX_FILE_BYTES) continue
      buf = await readFile(full)
    } catch {
      continue
    }
    if (buf.subarray(0, 8192).includes(0)) continue // skip binaries
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (ctx.matcher.test(lines[i])) {
        const match: AgentSearchMatch = {
          path: rel,
          line: i + 1,
          text: lines[i].trim().slice(0, SEARCH_LINE_CAP)
        }
        if (ctx.context > 0) {
          match.before = lines
            .slice(Math.max(0, i - ctx.context), i)
            .map((l) => l.slice(0, SEARCH_LINE_CAP))
          match.after = lines
            .slice(i + 1, i + 1 + ctx.context)
            .map((l) => l.slice(0, SEARCH_LINE_CAP))
        }
        ctx.matches.push(match)
        if (ctx.matches.length >= SEARCH_MAX_MATCHES) return true
      }
    }
  }
  return false
}

async function searchFiles(
  root: string,
  query: string,
  options?: AgentSearchOptions,
  signal?: AbortSignal
): Promise<AgentSearchResult> {
  try {
    if (!query || !query.trim()) throw new AgentError('A non-empty search query is required.')
    const opts = options ?? {}
    let matcher: LineMatcher
    try {
      matcher = makeLineMatcher(query, opts.regex === true, opts.caseSensitive === true)
    } catch (err) {
      throw new AgentError(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`)
    }
    let inScope: (relPath: string) => boolean
    try {
      inScope = makeGlobFilter(opts.glob)
    } catch (err) {
      throw new AgentError(`Invalid glob: ${err instanceof Error ? err.message : String(err)}`)
    }
    const base = resolveInside(root, opts.path || '.')
    const context = Math.min(SEARCH_MAX_CONTEXT, Math.max(0, Math.floor(opts.context ?? 0)))
    const ctx: SearchCtx = { root, matcher, inScope, context, matches: [], signal }
    const truncated = await walkSearch(ctx, base)
    return { ok: true, query, matches: ctx.matches, truncated }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

async function writeFileTool(root: string, rel: string, content: string): Promise<AgentWriteResult> {
  try {
    const file = resolveInside(root, rel)
    if (!rel || toRel(root, file) === '.') throw new AgentError('A file path is required.')
    let created = false
    try {
      await stat(file)
    } catch {
      created = true
    }
    await mkdir(join(file, '..'), { recursive: true })
    const text = typeof content === 'string' ? content : String(content ?? '')
    await writeFile(file, text, 'utf8')
    return { ok: true, path: toRel(root, file), created, bytes: Buffer.byteLength(text, 'utf8') }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

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

interface WinShell {
  file: string
  /** Windows PowerShell 5.1 lacks `&&`/`||`; pwsh (7+) supports them natively. */
  rewriteChains: boolean
}

let cachedShell: WinShell | undefined
/** Prefer PowerShell 7 (`pwsh`) when installed, else the in-box Windows PowerShell. */
function resolveWinShell(): WinShell {
  if (cachedShell) return cachedShell
  const pwsh = findOnPath('pwsh')
  cachedShell = pwsh ? { file: pwsh, rewriteChains: false } : { file: 'powershell.exe', rewriteChains: true }
  return cachedShell
}

/**
 * Windows PowerShell 5.1 has no `&&` / `||` operators — a command that uses them
 * fails to *parse*, so nothing runs at all (not even our UTF-8 setup). Local
 * models emit `a && b` constantly, so rewrite top-level operators into the
 * PowerShell equivalent: `a && b` → `a; if ($?) { b }`, `a || b` →
 * `a; if (-not $?) { b }`. Operators inside single/double quotes are left alone.
 */
function rewritePowerShellChains(command: string): string {
  const segments: string[] = []
  const ops: string[] = []
  let buf = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]
    if (quote) {
      buf += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    const pair = command.slice(i, i + 2)
    if (pair === '&&' || pair === '||') {
      segments.push(buf.trim())
      ops.push(pair)
      buf = ''
      i += 1 // consume the operator's second char
      continue
    }
    buf += ch
  }
  segments.push(buf.trim())
  if (ops.length === 0) return command
  // Fold right-to-left so each operator nests inside the previous success check.
  let result = segments[segments.length - 1]
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const cond = ops[i] === '&&' ? '$?' : '-not $?'
    result = `${segments[i]}; if (${cond}) { ${result} }`
  }
  return result
}

function runCommand(root: string, command: string, signal?: AbortSignal): Promise<AgentRunResult> {
  return new Promise((resolvePromise) => {
    if (!command || !command.trim()) {
      resolvePromise({ ok: false, error: 'No command provided.' })
      return
    }
    const onWin = process.platform === 'win32'
    const winShell = onWin ? resolveWinShell() : null
    const shell = winShell ? winShell.file : undefined
    // Force UTF-8 so non-ASCII output isn't mojibake (PowerShell defaults to the
    // OEM codepage), then run the (chain-rewritten) command.
    const line = winShell
      ? `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;` +
        (winShell.rewriteChains ? rewritePowerShellChains(command) : command)
      : command
    exec(
      line,
      {
        cwd: root,
        timeout: RUN_TIMEOUT_MS,
        maxBuffer: RUN_MAX_BUFFER,
        windowsHide: true,
        shell,
        signal
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '')
        const err = String(stderr ?? '')
        if (!error) {
          resolvePromise({ ok: true, stdout: out, stderr: err, code: 0 })
          return
        }
        const killed = (error as { killed?: boolean }).killed === true
        const code = typeof (error as { code?: unknown }).code === 'number'
          ? ((error as { code: number }).code)
          : null
        // A non-zero exit is a normal result for the agent, not an IPC failure.
        resolvePromise({
          ok: true,
          stdout: out,
          stderr: err,
          code,
          timedOut: killed
        })
      }
    )
  })
}

// Blueprints run in the main process, so expose the same confined primitives
// that the renderer-backed agent loop reaches through IPC. Keeping one
// implementation prevents the two WProvider modes from drifting apart.
export {
  listDir as listAgentDir,
  readFileTool as readAgentFile,
  writeFileTool as writeAgentFile,
  editFileTool as editAgentFile,
  searchFiles as searchAgentFiles,
  runCommand as runAgentCommand
}

export function registerAgentHandlers(): void {
  ipcMain.handle(IPC.agent.listDir, (_e, root: string, path: string): Promise<AgentListResult> =>
    listDir(root, path)
  )
  ipcMain.handle(
    IPC.agent.readFile,
    (_e, root: string, path: string, range?: AgentReadRange): Promise<AgentReadResult> =>
      readFileTool(root, path, range)
  )
  ipcMain.handle(
    IPC.agent.writeFile,
    (_e, root: string, path: string, content: string): Promise<AgentWriteResult> =>
      writeFileTool(root, path, content)
  )
  ipcMain.handle(
    IPC.agent.editFile,
    (
      _e,
      root: string,
      path: string,
      oldString: string,
      newString: string,
      replaceAll: boolean
    ): Promise<AgentEditResult> => editFileTool(root, path, oldString, newString, replaceAll)
  )
  ipcMain.handle(
    IPC.agent.search,
    (_e, root: string, query: string, options?: AgentSearchOptions): Promise<AgentSearchResult> =>
      searchFiles(root, query, options)
  )
  ipcMain.handle(
    IPC.agent.runCommand,
    (_e, root: string, command: string): Promise<AgentRunResult> => runCommand(root, command)
  )
}
