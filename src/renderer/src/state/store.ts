import { create } from 'zustand'
import type {
  Workspace,
  TreeNode,
  FileActionResult,
  FileContent,
  SshConnection,
  LlmMessage,
  TaskMessage,
  TaskSummary,
  ToolDef,
  LlmProvider,
  CodexSandbox,
  CodexReasoning,
  CopilotPermissionMode,
  CopilotReasoning,
  ClaudePermissionMode,
  GeminiApprovalMode,
  GlmMode,
  CodexEvent,
  CodexItem,
  CodexCheckResult,
  CodexUsageResult,
  ClaudeUsageResult,
  AgentListResult,
  AgentReadResult,
  AgentReadRange,
  AgentWriteResult,
  AgentEditResult,
  AgentSearchResult,
  AgentSearchOptions,
  AgentDirEntry,
  AgentSearchMatch,
  WProviderCheckResult,
  WProviderService
} from '@shared/ipc'
import {
  DEFAULT_LLM_CONFIG,
  EXCLUDED_DIRS,
  WPROVIDER_SERVICE_INFO,
  isSshCapableProvider,
  normalizeOpenRouterApiKey
} from '@shared/ipc'
import { api } from '@/lib/api'
import { diffStat } from '@/lib/diff'
import { solveZCodeCaptcha } from '@/lib/zcode-captcha'
import { isLanguageCode, type LanguageCode } from '@/language'

export type View = 'home' | 'workspace' | 'blueprint' | 'analytics'
/** Agent permission mode — mirrors ZCode's "Ask before changes" control. */
export type AgentMode = 'ask' | 'auto'
export type Connection = 'unknown' | 'connecting' | 'connected' | 'error'
export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'
export type AppLanguage = LanguageCode

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  dirty?: boolean
  saving?: boolean
  truncated?: boolean
}

/** Lifecycle and shape of chat entries persisted with a task. */
export type ToolStatus = NonNullable<TaskMessage['status']>
export type ChatMessage = TaskMessage

/** How many tool round-trips a single task may take before we stop. */
const MAX_STEPS = 16
const SSH_WORKSPACE_PREFIX = 'ssh:'
const MAX_EDITOR_FILE_BYTES = 2 * 1024 * 1024

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.md': 'markdown',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.sh': 'shell',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.toml': 'ini',
  '.ini': 'ini'
}

function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? (LANG_BY_EXT[name.slice(dot).toLowerCase()] ?? 'plaintext') : 'plaintext'
}

function nameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed
}

/**
 * Files the Explorer can "Run" directly (PyCharm-style), mapped to the program
 * that executes them. The command is sent to the built-in terminal so the run's
 * output and errors stream there. The absolute path is double-quoted, which both
 * PowerShell and POSIX shells accept.
 */
const FILE_RUNNERS: Record<string, string> = {
  '.py': 'python',
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node'
}

function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? name
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

/** Whether the Explorer should offer a "Run" action for this file name. */
export function isRunnableFile(name: string): boolean {
  return fileExtension(name) in FILE_RUNNERS
}

/** Shell command that runs `path` in the built-in terminal, or null. */
function runCommandForFile(path: string): string | null {
  const runner = FILE_RUNNERS[fileExtension(path)]
  return runner ? `${runner} "${path}"` : null
}

/** Id of the pseudo-workspace that holds an SSH host's saved chats. */
export function sshWorkspaceId(connId: string): string {
  return `${SSH_WORKSPACE_PREFIX}${connId}`
}

function isSshWorkspaceId(id: string | undefined | null): boolean {
  return !!id?.startsWith(SSH_WORKSPACE_PREFIX)
}

function sshWorkspace(conn: SshConnection, root = '~'): Workspace {
  return {
    id: sshWorkspaceId(conn.id),
    name: conn.name || `${conn.username}@${conn.host}`,
    path: root,
    lastOpenedAt: Date.now()
  }
}

function remoteJoin(parent: string, child: string): string {
  if (!child) return parent
  if (child.startsWith('/')) return child
  const base = parent.replace(/\/+$/, '')
  return base ? `${base}/${child}` : child
}

function remoteResolve(root: string, path: string): string {
  const p = (path || '.').trim()
  if (!p || p === '.') return root || '.'
  if (p === '~') return root || '.'
  if (p.startsWith('~/')) return remoteJoin(root || '.', p.slice(2))
  if (p.startsWith('/')) return p
  return remoteJoin(root || '.', p)
}

/**
 * Parent of a remote (POSIX) path. `/` is its own parent, so this never climbs
 * above the filesystem root; a non-absolute root like `~` has no parent we can
 * compute client-side, so it's returned unchanged (the "up" action becomes a
 * no-op there).
 */
function remoteParent(path: string): string {
  const s = (path || '').replace(/\/+$/, '')
  if (!s.startsWith('/')) return path
  const i = s.lastIndexOf('/')
  return i <= 0 ? '/' : s.slice(0, i)
}

function remoteBasename(path: string): string {
  const s = (path || '').replace(/\/+$/, '')
  return s.split('/').filter(Boolean).at(-1) ?? s
}

function safeEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    return null
  }
  return trimmed
}

function localRelativePath(root: string, path: string): string {
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const normPath = path.replace(/\\/g, '/')
  if (normPath.toLowerCase().startsWith(`${normRoot}/`)) return normPath.slice(normRoot.length + 1)
  return path
}

const TOOL_NAMES = [
  'list_dir',
  'read_file',
  'search_files',
  'write_file',
  'edit_file',
  'run_command',
  'web_fetch',
  'web_search'
] as const
type ToolName = (typeof TOOL_NAMES)[number]

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders in a workspace directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Workspace-relative dir; "." for root.' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a UTF-8 text file. Omit the line range to read the whole file, or pass ' +
        'start_line/end_line (1-based, inclusive) to read just a slice of a large file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          start_line: { type: 'integer', description: 'Optional first line to read (1-based).' },
          end_line: { type: 'integer', description: 'Optional last line to read (1-based, inclusive).' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search the workspace and return matching file:line locations (ripgrep-style). ' +
        'By default the query is a case-insensitive literal substring; set regex to treat it ' +
        'as a regular expression, glob to limit which files are scanned, and context to include ' +
        'surrounding lines. Use this to find code instead of reading files one by one.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regular expression to search for.' },
          path: { type: 'string', description: 'Optional subdirectory to scope the search to.' },
          regex: {
            type: 'boolean',
            description: 'Interpret query as a regular expression instead of a literal. Default false.'
          },
          glob: {
            type: 'string',
            description: 'Only search files whose path matches this glob, e.g. "**/*.ts" or "src/**".'
          },
          context: {
            type: 'integer',
            description: 'Lines of context to include before and after each match (0–10). Default 0.'
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Match case-sensitively. Default false.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create a new file, or overwrite an existing one with its FULL new content. ' +
        'For small changes to an existing file prefer edit_file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          content: { type: 'string', description: 'The complete new file content.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace an exact snippet in an existing file without rewriting the whole file. ' +
        'old_string must match the current text exactly and (unless replace_all is true) ' +
        'be unique — include a few surrounding lines for context.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          old_string: { type: 'string', description: 'Exact text to find (with enough context to be unique).' },
          new_string: { type: 'string', description: 'Text to replace it with.' },
          replace_all: {
            type: 'boolean',
            description: 'Replace every occurrence instead of the single unique one. Default false.'
          }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the workspace root and return its output. One-shot, non-interactive.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The command line to execute.' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch a URL over HTTP(S) and return its readable text (HTML is stripped to plain text). ' +
        'Use it to read documentation pages, issues, or raw files by URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
          max_chars: {
            type: 'integer',
            description: 'Optional cap on returned characters (default ~40000).'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web (DuckDuckGo) and return a short ranked list of {title, url, snippet}. ' +
        'Use it to find current information, then web_fetch a result URL to read it in full.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query.' } },
        required: ['query']
      }
    }
  }
]

/** Build the system prompt for the local (LM Studio) agent loop. */
function buildSystemPrompt(sshHost?: string, sshRoot?: string): string {
  const onWin = api.system.platform === 'win32'
  // Over SSH the command runs in the remote shell (a POSIX shell on the typical
  // Linux host), not the local one — steer the model to Unix commands.
  const shellNote = sshHost
    ? 'Commands run in the REMOTE host\'s POSIX shell (bash/sh) over SSH — use Unix commands ' +
      '(ls, find, grep, cat, …), not Windows/PowerShell ones.'
    : onWin
      ? 'Commands run in Windows PowerShell. Chain steps with `;` (PowerShell also accepts ' +
        '`&&`/`||`, which are translated for you) and use PowerShell/Windows-friendly commands.'
      : 'Commands run in a POSIX shell (sh).'
  return [
    'You are a capable AI coding agent operating inside ASCORA ADE, a desktop IDE, with',
    "direct access to the user's open project folder. Keep your own identity: if asked who",
    'you are, answer as the underlying model you actually are — do not claim to be "Ascora".',
    'ASCORA ADE is only the environment you run in.',
    '',
    'You can use tools to inspect and change the project:',
    '- list_dir(path): list a directory ("." is the project root)',
    '- read_file(path, [start_line], [end_line]): read a whole file or just a line range',
    '- search_files(query, [path], [regex], [glob], [context], [case_sensitive]): ripgrep-style ' +
      'search — literal by default, set regex for a pattern, glob (e.g. "**/*.ts") to scope files, ' +
      'context for surrounding lines',
    '- write_file(path, content): create or fully overwrite a file',
    '- edit_file(path, old_string, new_string, [replace_all]): change part of a file in place',
    '- run_command(command): run a shell command in the project root and read its output',
    '- web_search(query): search the web for a ranked list of results',
    '- web_fetch(url, [max_chars]): fetch a URL and read its text (HTML stripped)',
    '',
    'All paths are relative to the project root. Work step by step: call one tool at a time,',
    'wait for its result, then decide the next step. Prefer search_files to locate code and',
    'edit_file for surgical changes; reach for write_file only for new files or full rewrites.',
    'Always read a snippet before editing it so old_string matches exactly.',
    shellNote,
    ...(sshHost
      ? [
          `An SSH session to ${sshHost} is connected and is your working context: EVERY tool ` +
            'operates on that REMOTE host. run_command runs in its shell, and the file tools ' +
            '(list_dir/read_file/search_files/write_file/edit_file) act on its filesystem, with ' +
            `relative paths resolved against the active remote root (${sshRoot || '$HOME'}). There is no separate local ` +
            'project here — work directly on the remote host and do not assume any local files.'
        ]
      : []),
    'When the task is done, reply with a short plain-text summary and NO tool call.',
    '',
    'If you cannot emit native tool calls, request a tool by replying with ONLY a fenced',
    'block in this exact format (no prose around it):',
    '```tool_call',
    '{"tool": "read_file", "args": {"path": "package.json"}}',
    '```'
  ].join('\n')
}

// ---- agent-loop helpers (module scope; tasks run concurrently) ----

/**
 * Pending Ask-mode approvals: card id → its task + resolver. Tagged with the
 * owning task so stopping one run only rejects that run's pending cards.
 */
const pendingApprovals = new Map<string, { taskId: string; resolve: (approved: boolean) => void }>()
/** Task ids whose run was asked to stop; the loop checks this to bail out. */
const abortedRuns = new Set<string>()
/** Provider each in-flight run uses, so stopStreaming aborts on the right channel. */
const runProviders = new Map<string, LlmProvider>()
/** Tasks deleted mid-run, so their trailing save can't resurrect them. */
const deletedRuns = new Set<string>()

interface ParsedCall {
  id: string
  name: string
  args: Record<string, unknown>
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Coerce a tool arg to a positive integer line number, or undefined. */
function asLine(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/** Coerce a tool arg to a boolean, tolerating "true"/"false" strings. */
function asBool(v: unknown): boolean {
  return v === true || v === 'true'
}

/** Coerce a tool arg to a non-negative integer, or undefined. */
function asCount(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

/** Build the ripgrep-style options object for search_files from raw tool args. */
function searchOptionsFromArgs(args: Record<string, unknown>): AgentSearchOptions {
  return {
    path: asStr(args.path) || undefined,
    regex: asBool(args.regex),
    glob: asStr(args.glob) || undefined,
    context: asCount(args.context),
    caseSensitive: asBool(args.case_sensitive)
  }
}

/** Render one search hit, inlining context lines (`>` marks the match). */
function formatMatch(mt: AgentSearchMatch): string {
  if (!mt.before?.length && !mt.after?.length) return `${mt.path}:${mt.line}: ${mt.text}`
  const out: string[] = []
  const firstBefore = mt.line - (mt.before?.length ?? 0)
  mt.before?.forEach((l, i) => out.push(`${mt.path}:${firstBefore + i}- ${l}`))
  out.push(`${mt.path}:${mt.line}:> ${mt.text}`)
  mt.after?.forEach((l, i) => out.push(`${mt.path}:${mt.line + 1 + i}- ${l}`))
  return out.join('\n')
}

/**
 * Apply an edit_file replacement locally so the approval card can preview the
 * diff before the main process performs the real write. Mirrors editFileTool's
 * rules (unique match unless replaceAll) so preview and result agree.
 */
function applyEdit(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean
): { ok: true; content: string } | { ok: false; error: string } {
  if (!oldStr) return { ok: false, error: 'old_string is required.' }
  if (replaceAll) {
    const parts = content.split(oldStr)
    if (parts.length === 1) return { ok: false, error: 'old_string was not found.' }
    return { ok: true, content: parts.join(newStr) }
  }
  const idx = content.indexOf(oldStr)
  if (idx === -1) return { ok: false, error: 'old_string was not found.' }
  if (content.indexOf(oldStr, idx + oldStr.length) !== -1) {
    return { ok: false, error: 'old_string is not unique.' }
  }
  return { ok: true, content: content.slice(0, idx) + newStr + content.slice(idx + oldStr.length) }
}

// ---- SSH-backed agent tools ----
// When an SSH session is the active target, the file tools must operate on the
// REMOTE host, not the local workspace. These mirror the api.agent.* result
// shapes but run as commands in the connected shell (so paths resolve against
// the remote shell's current directory, exactly like the visible terminal).

/** Single-quote a value for safe interpolation into a POSIX shell command. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** UTF-8 → base64, so file contents survive the shell without quoting pain. */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** True when a remote command failed (transport error or non-zero exit). */
function sshFailed(r: { ok: boolean; code?: number | null }): boolean {
  return !r.ok || (typeof r.code === 'number' && r.code !== 0)
}

const sshLines = (out: string | undefined): string[] =>
  (out ?? '').split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean)

async function sshListDir(id: string, path: string, root = '.'): Promise<AgentListResult> {
  const p = remoteResolve(root, path)
  // -1 one per line, -A include dotfiles (but not . / ..), -p mark dirs with "/".
  const r = await api.ssh.exec(id, `ls -1Ap -- ${shq(p)}`)
  if (sshFailed(r)) return { ok: false, error: (r.stderr || r.stdout || r.error || 'ls failed').trim() }
  const entries: AgentDirEntry[] = sshLines(r.stdout).map((name) =>
    name.endsWith('/')
      ? { name: name.slice(0, -1), type: 'directory' as const }
      : { name, type: 'file' as const }
  )
  return { ok: true, path: p, entries }
}

async function sshReadFile(
  id: string,
  path: string,
  range?: AgentReadRange,
  root = '.'
): Promise<AgentReadResult> {
  if (!path) return { ok: false, error: 'path is required.' }
  const p = remoteResolve(root, path)
  const wc = await api.ssh.exec(id, `wc -l < ${shq(p)}`)
  if (sshFailed(wc)) return { ok: false, error: (wc.stdout || wc.error || `cannot read ${p}`).trim() }
  const totalLines = (parseInt((wc.stdout ?? '0').trim(), 10) || 0) + 1
  const { startLine, endLine } = range ?? {}
  const cmd =
    startLine || endLine
      ? `sed -n ${shq(`${startLine ?? 1},${endLine ?? '$'}p`)} -- ${shq(p)}`
      : `cat -- ${shq(p)}`
  const r = await api.ssh.exec(id, cmd)
  if (sshFailed(r)) return { ok: false, error: (r.stdout || r.error || `cannot read ${p}`).trim() }
  const content = r.stdout ?? ''
  return startLine || endLine
    ? { ok: true, path: p, content, startLine: startLine ?? 1, endLine: endLine ?? totalLines, totalLines }
    : { ok: true, path: p, content, totalLines }
}

async function sshSearch(
  id: string,
  query: string,
  options?: AgentSearchOptions,
  root = '.'
): Promise<AgentSearchResult> {
  if (!query) return { ok: false, error: 'query is required.' }
  const opts = options ?? {}
  const where = shq(remoteResolve(root, opts.path && opts.path.trim() ? opts.path : '.'))
  const cap = 200
  const flags = ['-rnI']
  if (!opts.caseSensitive) flags.push('-i')
  // -F literal (default) vs -E extended regex when the model asks for a pattern.
  flags.push(opts.regex ? '-E' : '-F')
  const context = Math.min(10, Math.max(0, Math.floor(opts.context ?? 0)))
  if (context > 0) flags.push(`-C ${context}`)
  const include = opts.glob && opts.glob.trim() ? ` --include=${shq(opts.glob.trim())}` : ''
  const r = await api.ssh.exec(
    id,
    `grep ${flags.join(' ')}${include} -e ${shq(query)} -- ${where} 2>/dev/null | head -n ${cap + 1}`
  )
  if (!r.ok) return { ok: false, error: r.error }
  const lines = sshLines(r.stdout)
  const truncated = lines.length > cap
  // With context, grep prints `path-line-text` for context and `path:line:text`
  // for matches; keep only the match lines (the `:` separator) for parity.
  const matchLines = context > 0 ? lines.filter((l) => /^.*?:\d+:/.test(l)) : lines
  const matches: AgentSearchMatch[] = matchLines.slice(0, cap).map((line) => {
    const m = line.match(/^(.*?):(\d+):(.*)$/)
    return m
      ? { path: m[1], line: parseInt(m[2], 10), text: m[3].trim().slice(0, 400) }
      : { path: line, line: 0, text: '' }
  })
  return { ok: true, query, matches, truncated }
}

async function sshWriteFile(id: string, path: string, content: string, root = '.'): Promise<AgentWriteResult> {
  if (!path) return { ok: false, error: 'path is required.' }
  const p = remoteResolve(root, path)
  const existed = await api.ssh.exec(id, `test -e ${shq(p)} && echo Y || echo N`)
  const created = sshLines(existed.stdout).at(-1) !== 'Y'
  // Recreate the parent dir, then decode the base64 payload into the file.
  const r = await api.ssh.exec(
    id,
    `mkdir -p -- "$(dirname -- ${shq(p)})" && printf %s ${shq(utf8ToBase64(content))} | base64 -d > ${shq(p)}`
  )
  if (sshFailed(r)) return { ok: false, error: (r.stdout || r.error || `cannot write ${p}`).trim() }
  return { ok: true, path: p, created, bytes: new TextEncoder().encode(content).length }
}

async function sshEditFile(
  id: string,
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  root = '.'
): Promise<AgentEditResult> {
  if (!path) return { ok: false, error: 'path is required.' }
  const cur = await sshReadFile(id, path, undefined, root)
  if (!cur.ok) return { ok: false, error: cur.error }
  const applied = applyEdit(cur.content ?? '', oldString, newString, replaceAll)
  if (!applied.ok) return { ok: false, error: applied.error }
  const replacements = replaceAll ? (cur.content ?? '').split(oldString).length - 1 : 1
  const w = await sshWriteFile(id, cur.path ?? path, applied.content)
  if (!w.ok) return { ok: false, error: w.error }
  return { ok: true, path: w.path ?? cur.path ?? path, replacements }
}

/**
 * List a remote directory into tree nodes. On failure the error is returned
 * (not swallowed) so callers can surface *why* a folder showed nothing —
 * e.g. "Permission denied" when opening a root-only dir without elevation.
 */
async function sshReadTree(
  id: string,
  path: string,
  root = '.'
): Promise<{ nodes: TreeNode[]; error?: string }> {
  const listed = await sshListDir(id, path, root)
  if (!listed.ok) return { nodes: [], error: listed.error }
  const base = listed.path ?? remoteResolve(root, path)
  const nodes = (listed.entries ?? [])
    .filter((entry) => !(entry.type === 'directory' && EXCLUDED_DIRS.has(entry.name)))
    .map((entry) => ({
      name: entry.name,
      path: remoteJoin(base, entry.name),
      type: entry.type,
      ...(entry.type === 'directory' ? { children: undefined } : {})
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  return { nodes }
}

async function sshReadFileContent(id: string, path: string, root = '.'): Promise<FileContent> {
  const p = remoteResolve(root, path)
  const size = await api.ssh.exec(id, `wc -c < ${shq(p)}`)
  if (sshFailed(size)) {
    throw new Error((size.stderr || size.stdout || size.error || `Cannot read ${p}`).trim())
  }
  const bytes = parseInt((size.stdout ?? '0').trim(), 10) || 0
  if (bytes > MAX_EDITOR_FILE_BYTES) {
    return {
      path: p,
      content: `// ${nameFromPath(p)} is ${(bytes / 1024 / 1024).toFixed(1)} MB - too large to display.`,
      language: 'plaintext',
      truncated: true
    }
  }
  const probe = await api.ssh.exec(
    id,
    `[ -s ${shq(p)} ] && ! LC_ALL=C grep -Iq . -- ${shq(p)} && printf BINARY || printf TEXT`
  )
  if (sshFailed(probe)) {
    throw new Error((probe.stderr || probe.stdout || probe.error || `Cannot read ${p}`).trim())
  }
  if ((probe.stdout ?? '').trim() === 'BINARY') {
    return {
      path: p,
      content: `// ${nameFromPath(p)} appears to be a binary file.`,
      language: 'plaintext',
      truncated: true
    }
  }
  const read = await api.ssh.exec(id, `cat -- ${shq(p)}`)
  if (sshFailed(read)) {
    throw new Error((read.stderr || read.stdout || read.error || `Cannot read ${p}`).trim())
  }
  return {
    path: p,
    content: read.stdout ?? '',
    language: languageForPath(p),
    truncated: false
  }
}

function remoteChildPath(parentPath: string, name: string): string {
  return remoteJoin(parentPath, name)
}

function fileResult(ok: boolean, path?: string, error?: string): FileActionResult {
  return ok ? { ok: true, path } : { ok: false, error }
}

async function sshCreateFile(id: string, parentPath: string, name: string): Promise<FileActionResult> {
  const safeName = safeEntryName(name)
  if (!safeName) return { ok: false, error: 'Invalid file name.' }
  const path = remoteChildPath(parentPath, safeName)
  const r = await api.ssh.exec(id, `set -C; : > ${shq(path)}`)
  return fileResult(!sshFailed(r), path, (r.stderr || r.stdout || r.error || 'Failed to create file.').trim())
}

async function sshCreateDirectory(id: string, parentPath: string, name: string): Promise<FileActionResult> {
  const safeName = safeEntryName(name)
  if (!safeName) return { ok: false, error: 'Invalid folder name.' }
  const path = remoteChildPath(parentPath, safeName)
  const r = await api.ssh.exec(id, `mkdir -- ${shq(path)}`)
  return fileResult(!sshFailed(r), path, (r.stderr || r.stdout || r.error || 'Failed to create folder.').trim())
}

async function sshRenamePath(id: string, path: string, newName: string): Promise<FileActionResult> {
  const safeName = safeEntryName(newName)
  if (!safeName) return { ok: false, error: 'Invalid name.' }
  const parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
  const nextPath = remoteChildPath(parent, safeName)
  const r = await api.ssh.exec(id, `mv -- ${shq(path)} ${shq(nextPath)}`)
  return fileResult(!sshFailed(r), nextPath, (r.stderr || r.stdout || r.error || 'Failed to rename.').trim())
}

async function sshMovePath(
  id: string,
  path: string,
  targetDirectoryPath: string
): Promise<FileActionResult> {
  const name = remoteBasename(path)
  if (!safeEntryName(name)) return { ok: false, error: 'Invalid name.' }
  const nextPath = remoteChildPath(targetDirectoryPath, name)
  const r = await api.ssh.exec(
    id,
    `test -d ${shq(targetDirectoryPath)} && test ! -e ${shq(nextPath)} && mv -- ${shq(path)} ${shq(nextPath)}`
  )
  return fileResult(!sshFailed(r), nextPath, (r.stderr || r.stdout || r.error || 'Failed to move.').trim())
}

async function sshDeleteFile(id: string, path: string): Promise<FileActionResult> {
  const r = await api.ssh.exec(id, `rm -f -- ${shq(path)}`)
  return fileResult(!sshFailed(r), undefined, (r.stderr || r.stdout || r.error || 'Failed to delete file.').trim())
}

async function sshDeleteDirectory(id: string, path: string): Promise<FileActionResult> {
  const r = await api.ssh.exec(id, `rm -rf -- ${shq(path)}`)
  return fileResult(!sshFailed(r), undefined, (r.stderr || r.stdout || r.error || 'Failed to delete folder.').trim())
}

function safeArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n…(${s.length - n} more chars truncated)` : s
}

/** Rough token estimate (~4 chars/token) for backends that don't report usage. */
function estTokens(text: string): number {
  return tokensFromChars(text?.length ?? 0)
}

/** Same ~4 chars/token estimate, from a running character count. */
function tokensFromChars(chars: number): number {
  return Math.max(0, Math.round(chars / 4))
}

function taskTitle(text: string): string {
  const title = text.replace(/\s+/g, ' ').trim()
  return title.length > 72 ? `${title.slice(0, 69)}...` : title
}

/**
 * Display name for the model behind the active provider, stamped onto each
 * assistant message so the chat shows the real model (and keeps older messages
 * under their original model after a mid-chat switch).
 */
function modelLabel(s: {
  provider: LlmProvider
  model: string
  ollamaModel: string
  openRouterModel: string
  codexModel: string
  copilotModel: string
  claudeModel: string
  geminiModel: string
  wproviderService: WProviderService
}): string {
  switch (s.provider) {
    case 'lmstudio':
      return s.model || 'local model'
    case 'ollama':
      return s.ollamaModel || 'Ollama'
    case 'openrouter':
      return s.openRouterModel || 'openrouter/free'
    case 'codex':
      return s.codexModel || 'Codex'
    case 'copilot':
      return s.copilotModel || 'Copilot'
    case 'claude':
      return s.claudeModel && s.claudeModel !== 'default' ? s.claudeModel : 'Claude'
    case 'gemini':
      return s.geminiModel || 'Gemini'
    case 'glm':
      return 'GLM'
    case 'wprovider':
      return `${WPROVIDER_SERVICE_INFO[s.wproviderService].label} Web`
    default:
      return 'Assistant'
  }
}

/**
 * Order workspaces by a saved id sequence. Workspaces missing from `order`
 * (newly opened folders) float to the top by recency; everything else follows
 * the user's manually arranged order.
 */
function sortWorkspaces(workspaces: Workspace[], order: string[]): Workspace[] {
  if (order.length === 0) return workspaces
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...workspaces].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra === undefined && rb === undefined) return b.lastOpenedAt - a.lastOpenedAt
    if (ra === undefined) return -1
    if (rb === undefined) return 1
    return ra - rb
  })
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  return resolved
}

function applyLanguage(language: AppLanguage): void {
  document.documentElement.lang = language
}

/** Parse a fenced ```tool_call / ```json block from assistant text (fallback path). */
function parseTextToolCall(content: string): { call: ParsedCall; block: string } | null {
  const fence = content.match(/```(?:tool_call|json)?\s*([\s\S]*?)```/i)
  if (fence) {
    const call = toolCallFromJson(fence[1])
    if (call) return { call, block: fence[0] }
  }
  // Salvage path: stream loss can eat the opening backticks (leaving a bare
  // "tool_call" label) and web-chat models sometimes skip the fence entirely —
  // find a bare {"tool": ...} object and cut it out with a balanced scan.
  const start = content.search(/\{\s*"(?:tool|name)"\s*:/)
  if (start < 0) return null
  const json = scanJsonObject(content, start)
  const call = json ? toolCallFromJson(json) : null
  if (!json || !call) return null
  // Sweep the fence remnants around the object into the removed block.
  const before = /(?:`{1,3})?(?:tool_call|json)?\s*$/i.exec(content.slice(0, start))
  const after = /^\s*`{0,3}/.exec(content.slice(start + json.length))
  return { call, block: `${before?.[0] ?? ''}${json}${after?.[0] ?? ''}` }
}

/** Parse `{"tool"|"name", "args"|"arguments"}` JSON into a ParsedCall. */
function toolCallFromJson(text: string): ParsedCall | null {
  // Models often put literal newlines inside multi-line string args, which
  // strict JSON rejects — retry with control characters escaped.
  for (const candidate of [text.trim(), escapeCtrlInJsonStrings(text.trim())]) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>
      const name = asStr(obj.tool) || asStr(obj.name)
      if (!isToolName(name)) return null
      const rawArgs = obj.args ?? obj.arguments ?? {}
      const args =
        rawArgs && typeof rawArgs === 'object'
          ? (rawArgs as Record<string, unknown>)
          : safeArgs(asStr(rawArgs))
      return { id: `call_${Math.random().toString(36).slice(2, 9)}`, name, args }
    } catch {
      /* try the escaped variant */
    }
  }
  return null
}

/** Escape raw control characters found inside JSON string literals. */
function escapeCtrlInJsonStrings(text: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (!inStr) {
      if (ch === '"') inStr = true
      out += ch
    } else if (ch === '\\') {
      out += ch + (text[i + 1] ?? '')
      i += 1
    } else if (ch === '"') {
      inStr = false
      out += ch
    } else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else out += ch
  }
  return out
}

/** Cut one balanced `{...}` object out of `text` starting at `start`. */
function scanJsonObject(text: string, start: number): string | null {
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i += 1
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Map a Codex `status` string onto our tool-card lifecycle. */
function codexStatus(status?: string): ToolStatus {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'error'
  return 'running'
}

/** Last path segment, for compact file-change display. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? p
}

/**
 * Translate a Codex work item into the same tool-card shape the LM Studio loop
 * produces, so the existing chat UI renders both backends uniformly.
 */
function codexItemToCard(it: CodexItem): Partial<ChatMessage> {
  const status = codexStatus(it.status)
  if (it.type === 'command_execution') {
    return {
      tool: 'run_command',
      args: { command: it.command ?? '' },
      status,
      output: it.output,
      exitCode: typeof it.exitCode === 'number' ? it.exitCode : it.exitCode === null ? null : undefined
    }
  }
  if (it.type === 'file_change') {
    const changes = it.changes ?? []
    // Codex reports per-file line counts on some builds; surface them when present.
    const hasCounts = changes.some((c) => c.added != null || c.removed != null)
    return {
      tool: 'apply_patch',
      args: { path: `${changes.length} file${changes.length === 1 ? '' : 's'}` },
      status,
      output: changes.map((c) => `${c.kind} ${baseName(c.path)}`).join('\n'),
      changes,
      ...(hasCounts
        ? {
            addedLines: changes.reduce((sum, c) => sum + (c.added ?? 0), 0),
            removedLines: changes.reduce((sum, c) => sum + (c.removed ?? 0), 0)
          }
        : {})
    }
  }
  // Unknown / other item type (incl. Claude's read_file/list_dir/etc.) — show
  // it generically with a short summary in the header.
  return { tool: it.type, args: { path: it.text ?? '' }, status }
}

/**
 * Per-workspace agent backend selection, persisted so each project remembers its
 * own model/provider independently. Connection-level fields (base URL, binary
 * paths) stay global — they describe one local install, not a per-project choice.
 */
interface WorkspaceLlm {
  provider: LlmProvider
  model: string
  ollamaModel: string
  openRouterModel: string
  codexModel: string
  codexSandbox: CodexSandbox
  codexReasoning: CodexReasoning | ''
  copilotModel: string
  copilotPermission: CopilotPermissionMode
  copilotReasoning: CopilotReasoning | ''
  claudeModel: string
  claudePermission: ClaudePermissionMode
  geminiModel: string
  geminiPermission: GeminiApprovalMode
  glmMode: GlmMode
  wproviderService: WProviderService
}

/** Snapshot the active backend selection for persisting against a workspace. */
function snapshotLlm(s: {
  provider: LlmProvider
  model: string
  ollamaModel: string
  openRouterModel: string
  codexModel: string
  codexSandbox: CodexSandbox
  codexReasoning: CodexReasoning | ''
  copilotModel: string
  copilotPermission: CopilotPermissionMode
  copilotReasoning: CopilotReasoning | ''
  claudeModel: string
  claudePermission: ClaudePermissionMode
  geminiModel: string
  geminiPermission: GeminiApprovalMode
  glmMode: GlmMode
  wproviderService: WProviderService
}): WorkspaceLlm {
  return {
    provider: s.provider,
    model: s.model,
    ollamaModel: s.ollamaModel,
    openRouterModel: s.openRouterModel,
    codexModel: s.codexModel,
    codexSandbox: s.codexSandbox,
    codexReasoning: s.codexReasoning,
    copilotModel: s.copilotModel,
    copilotPermission: s.copilotPermission,
    copilotReasoning: s.copilotReasoning,
    claudeModel: s.claudeModel,
    claudePermission: s.claudePermission,
    geminiModel: s.geminiModel,
    geminiPermission: s.geminiPermission,
    glmMode: s.glmMode,
    wproviderService: s.wproviderService
  }
}

// ---- Skills: reusable instruction snippets the user can toggle on ----

/** A reusable instruction set the user can enable to steer the agent. */
export interface Skill {
  id: string
  name: string
  description: string
  /** Guidance injected into the agent while the skill is enabled. */
  instructions: string
  enabled: boolean
}

/** Seeded on first run; "Careful coding" is active by default. */
const DEFAULT_SKILLS: Skill[] = [
  {
    id: 'careful-coding',
    name: 'Careful coding',
    description: 'Read before editing; keep changes minimal and consistent.',
    instructions:
      'Before editing a file, read the relevant section so your change matches the ' +
      'surrounding style and naming. Make the smallest change that solves the task, avoid ' +
      'unrelated refactors, and prefer editing existing code over adding new files. After ' +
      'changing code, re-check that it still fits the project conventions.',
    enabled: true
  },
  {
    id: 'concise-answers',
    name: 'Concise answers',
    description: 'Reply briefly and let the code speak.',
    instructions:
      'Keep prose short and skip filler. Lead with the answer or the change, show code ' +
      'rather than describing it at length, and only explain what is non-obvious.',
    enabled: false
  },
  {
    id: 'conventional-commits',
    name: 'Conventional commits',
    description: 'Use Conventional Commits when committing.',
    instructions:
      'When asked to commit, write the message in Conventional Commits style (feat:, fix:, ' +
      'chore:, refactor:, docs:, …) with a concise imperative summary line and an optional ' +
      'short body explaining the why.',
    enabled: false
  }
]

/** Build the instruction block injected into the agent for the enabled skills. */
function skillsToPrompt(skills: Skill[]): string {
  const active = skills.filter((s) => s.enabled && s.instructions.trim())
  if (active.length === 0) return ''
  const body = active.map((s) => `## ${s.name}\n${s.instructions.trim()}`).join('\n\n')
  return `The user enabled these skills — follow them throughout this task:\n\n${body}`
}

/**
 * The live state of a single task's agent run. For the *active* task this lives
 * in the top-level store fields below (so the UI reads it unchanged); when the
 * user switches away from a still-running task its snapshot is stashed in
 * `runs` (keyed by task id) so the run keeps progressing in the background and
 * can be restored live when the task is reopened.
 */
interface RunState {
  workspaceId: string
  workspaceName: string
  title: string
  /** Backend the run is using, kept for abort routing after a model switch. */
  provider: LlmProvider
  messages: ChatMessage[]
  convo: LlmMessage[]
  streaming: boolean
  streamId: string | null
  thinking: boolean
  thinkingTokens: number
  thinkingStartedAt: number | null
  codexThreadId: string | null
  copilotSessionId: string | null
  claudeSessionId: string | null
  geminiSessionId: string | null
  glmSessionId: string | null
}

/** The subset of run fields that mirror top-level store keys of the same name. */
type RunFields = Pick<
  RunState,
  | 'messages'
  | 'convo'
  | 'streaming'
  | 'streamId'
  | 'thinking'
  | 'thinkingTokens'
  | 'thinkingStartedAt'
  | 'codexThreadId'
  | 'copilotSessionId'
  | 'claudeSessionId'
  | 'geminiSessionId'
  | 'glmSessionId'
>

interface AppState {
  view: View
  workspaces: Workspace[]
  /** User-arranged display order of workspace ids (persisted). */
  workspaceOrder: string[]
  /** Workspace ids whose task list is collapsed in the rail (persisted). */
  collapsedWorkspaces: Record<string, boolean>
  active: Workspace | null
  tasksByWorkspace: Record<string, TaskSummary[]>
  activeTaskId: string | null
  /** Id of a soft-deleted task currently opened in read-only mode. */
  archivedTaskId: string | null
  activeTaskTitle: string
  /** Backgrounded runs (task id → live state) for tasks not currently foreground. */
  runs: Record<string, RunState>

  treeRoots: TreeNode[]
  childrenByPath: Record<string, TreeNode[]>
  expanded: Record<string, boolean>
  treeLoading: boolean
  /** Last remote directory-listing failure (e.g. permission denied), or null. */
  treeError: string | null

  openFiles: OpenFile[]
  activeFile: string | null

  // Live Server (built-in HTML preview)
  /** Base URL of the running Live Server, e.g. http://127.0.0.1:5500; null when off. */
  liveUrl: string | null
  livePort: number | null
  /** Workspace root the server is currently serving. */
  liveRoot: string | null
  /** Full URL shown in the preview; null when the preview is closed. */
  previewUrl: string | null
  /** Where the preview lives: docked panel in the layout, or a separate OS window. */
  previewMode: 'docked' | 'window'
  /** Serialized dockview layout; kept so the panel arrangement survives view switches. */
  dockLayout: unknown
  /** Pending PyCharm-style "Run this file" request for the built-in terminal;
   *  the Terminal panel consumes it and clears it. */
  terminalRequest: { command: string; nonce: number } | null

  // SSH terminals
  /** Saved SSH hosts shown under Workspaces (persisted in app settings). */
  sshConnections: SshConnection[]
  /** Connection ids whose terminal panel is open in the dock. */
  openSshTerminals: string[]
  /** Connection id the agent's run_command targets while a session is open. */
  activeSsh: string | null
  /** Per-session "Run as root" state: when true, remote file ops run via sudo. */
  sshElevated: Record<string, boolean>
  /** Whether the add/edit SSH connection modal is open. */
  sshModalOpen: boolean
  /** Connection being edited (null → adding a new one). */
  sshEditing: SshConnection | null

  // LLM provider
  provider: LlmProvider
  /** Per-workspace saved backend selections (workspace id → choice); the default a new chat inherits. */
  workspaceLlm: Record<string, WorkspaceLlm>
  /** Per-chat saved backend selections (task id → choice), so each chat keeps its own model/provider. */
  taskLlm: Record<string, WorkspaceLlm>
  // LM Studio
  baseUrl: string
  model: string
  // Ollama
  ollamaBaseUrl: string
  ollamaModel: string
  models: string[]
  connection: Connection
  connectionError?: string
  /** Whether the local LM Studio server is reachable (background-probed), used
   *  to show/hide LM Studio in the backend list independent of the active one. */
  lmStudioReachable: boolean
  /** Same background-probed reachability for the local Ollama server. */
  ollamaReachable: boolean
  // OpenRouter
  openRouterEnabled: boolean
  openRouterApiKey: string
  openRouterModel: string
  // Codex CLI
  codexPath: string
  codexModel: string
  codexSandbox: CodexSandbox
  codexReasoning: CodexReasoning | ''
  codexThreadId: string | null
  codexCheck: CodexCheckResult | null
  codexChecking: boolean
  /** Latest Codex account rate limits (for the status-bar indicator). */
  codexUsage: CodexUsageResult | null
  // GitHub Copilot CLI
  copilotPath: string
  copilotModel: string
  copilotPermission: CopilotPermissionMode
  copilotReasoning: CopilotReasoning | ''
  copilotSessionId: string | null
  copilotCheck: CodexCheckResult | null
  copilotChecking: boolean
  copilotAuthOpen: boolean
  // Claude Code
  claudePath: string
  claudeModel: string
  claudePermission: ClaudePermissionMode
  claudeSessionId: string | null
  claudeCheck: CodexCheckResult | null
  claudeChecking: boolean
  /** Latest Claude subscription usage limits (for the status-bar indicator). */
  claudeUsage: ClaudeUsageResult | null
  // Gemini CLI
  geminiPath: string
  geminiModel: string
  geminiPermission: GeminiApprovalMode
  geminiSessionId: string | null
  geminiCheck: CodexCheckResult | null
  geminiChecking: boolean
  // GLM / ZCode
  glmPath: string
  glmMode: GlmMode
  glmSessionId: string | null
  glmCheck: CodexCheckResult | null
  glmChecking: boolean
  // Ascora WProvider (hidden-browser web chat backend)
  wproviderService: WProviderService
  wproviderCheck: WProviderCheckResult | null
  /** Last known sign-in state per web service, so the quick-switch picker can grey out unsigned-in ones. */
  wproviderChecks: Partial<Record<WProviderService, WProviderCheckResult>>
  wproviderChecking: boolean
  /** True while the visible WProvider sign-in window is open. */
  wproviderLoggingIn: boolean
  settingsOpen: boolean
  /** Whether the Claude usage breakdown modal is open. */
  usageOpen: boolean
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  appLanguage: AppLanguage
  /** Whether the left sidebar (rail) is collapsed out of view (persisted). */
  sidebarCollapsed: boolean
  /** Reusable instruction snippets that steer the agent (persisted). */
  skills: Skill[]
  skillsOpen: boolean

  mode: AgentMode
  messages: ChatMessage[]
  /** Raw LLM transcript (user/assistant/tool turns) driving multi-turn context. */
  convo: LlmMessage[]
  streaming: boolean
  streamId: string | null
  /** True while a model turn is actively generating (drives the Thinking… indicator). */
  thinking: boolean
  /** Running output-token estimate for the active turn(s), shown while thinking. */
  thinkingTokens: number
  /** Epoch ms when the current run started, for the Thinking… elapsed timer. */
  thinkingStartedAt: number | null

  init: () => Promise<void>
  openFolder: () => Promise<void>
  loadWorkspaceData: (ws: Workspace) => Promise<void>
  openWorkspace: (ws: Workspace) => Promise<void>
  toggleWorkspaceCollapsed: (id: string) => void
  setAllWorkspacesCollapsed: (collapsed: boolean) => void
  reorderWorkspaces: (draggedId: string, targetId: string) => void
  renameWorkspace: (id: string, name: string) => Promise<boolean>
  openTask: (ws: Workspace, taskId: string, includeDeleted?: boolean) => Promise<void>
  restoreTask: (ws: Workspace, taskId: string) => Promise<void>
  deleteTask: (ws: Workspace, taskId: string) => Promise<void>
  saveTaskRun: (taskId: string, status: TaskSummary['status']) => Promise<void>
  goHome: () => void
  openAnalytics: () => void
  closeAnalytics: () => void
  toggleDir: (node: TreeNode) => Promise<void>
  refreshDirectory: (path: string) => Promise<void>
  /** Rebase the remote tree root one directory up (SSH only). */
  goUpDirectory: () => Promise<void>
  /** Toggle "Run as root" for the active SSH session and re-list the tree. */
  toggleSshElevation: () => Promise<void>
  openFile: (node: TreeNode) => Promise<void>
  createFile: (parentPath: string, name: string) => Promise<FileActionResult>
  createDirectory: (parentPath: string, name: string) => Promise<FileActionResult>
  renamePath: (path: string, newName: string, type: 'file' | 'directory') => Promise<FileActionResult>
  movePath: (path: string, targetDirectoryPath: string) => Promise<FileActionResult>
  deleteFilePath: (path: string) => Promise<FileActionResult>
  deleteDirectoryPath: (path: string) => Promise<FileActionResult>
  renameOpenFile: (oldPath: string, newPath: string, newName: string) => void
  renameOpenPathPrefix: (oldPath: string, newPath: string) => void
  closeFilesUnder: (path: string) => void
  closeFile: (path: string) => void
  closeOtherFiles: (path: string) => void
  closeFilesToRight: (path: string) => void
  closeAllFiles: () => void
  setActiveFile: (path: string) => void
  updateOpenFileContent: (path: string, content: string) => void
  saveActiveFile: () => Promise<void>
  /** Run a runnable file (e.g. Python) in the built-in terminal, PyCharm-style. */
  runFile: (node: TreeNode) => void

  /** Start (or reuse) the Live Server and show the active HTML file docked. */
  goLive: () => Promise<void>
  /** Stop the Live Server and close the preview (docked or windowed). */
  stopLive: () => Promise<void>
  /** Close the preview (the server keeps running). */
  closePreview: () => void
  /** Pop the docked preview out into a separate OS window. */
  detachPreview: () => void
  /** React to the user closing the detached preview window. */
  handlePreviewWindowClosed: () => void
  /** Open the current preview URL in the system browser. */
  openPreviewInBrowser: () => void
  /** Persist the current dockview panel arrangement. */
  setDockLayout: (layout: unknown) => void

  // SSH
  /** Open the add/edit SSH connection modal (pass a connection to edit it). */
  openSshModal: (conn?: SshConnection | null) => void
  closeSshModal: () => void
  /** Create or update a saved SSH connection (persisted). */
  saveSshConnection: (conn: SshConnection) => void
  deleteSshConnection: (id: string) => void
  /** Native file picker for a private-key file; returns the chosen path. */
  pickSshKey: () => Promise<string | null>
  /** Load the selected SSH host's remote filesystem into the IDE context. */
  loadSshData: (id: string) => Promise<void>
  /** Open (or focus) an SSH terminal for a saved connection. */
  openSshTerminal: (id: string) => void
  /** Close an SSH terminal panel and disconnect its session. */
  closeSshTerminal: (id: string) => void
  /** Open a saved chat that belongs to an SSH host (connecting to it first). */
  openSshTask: (connId: string, taskId: string) => Promise<void>
  /** Start a blank chat on an SSH host, backgrounding any running task. */
  newSshTask: (connId: string) => void
  /** Delete one of an SSH host's saved chats. */
  deleteSshTask: (connId: string, taskId: string) => Promise<void>

  refreshModels: () => Promise<void>
  setModel: (m: string) => void
  setBaseUrl: (url: string) => Promise<void>
  setOllamaModel: (m: string) => void
  setOllamaBaseUrl: (url: string) => Promise<void>
  setProvider: (p: LlmProvider) => Promise<void>
  setOpenRouterEnabled: (enabled: boolean) => Promise<void>
  setOpenRouterApiKey: (apiKey: string) => Promise<void>
  setOpenRouterModel: (m: string) => void
  setCodexPath: (path: string) => Promise<void>
  setCodexModel: (m: string) => void
  setCodexSandbox: (s: CodexSandbox) => void
  setCodexReasoning: (r: CodexReasoning | '') => void
  checkCodex: () => Promise<void>
  refreshCodexUsage: () => Promise<void>
  setCopilotPath: (path: string) => Promise<void>
  setCopilotModel: (m: string) => void
  setCopilotPermission: (p: CopilotPermissionMode) => void
  setCopilotReasoning: (r: CopilotReasoning | '') => void
  checkCopilot: (verifyAuth?: boolean) => Promise<void>
  setCopilotAuthOpen: (open: boolean) => void
  setClaudePath: (path: string) => Promise<void>
  setClaudeModel: (m: string) => void
  setClaudePermission: (p: ClaudePermissionMode) => void
  checkClaude: () => Promise<void>
  refreshClaudeUsage: () => Promise<void>
  setGeminiPath: (path: string) => Promise<void>
  setGeminiModel: (m: string) => void
  setGeminiPermission: (p: GeminiApprovalMode) => void
  checkGemini: () => Promise<void>
  setGlmPath: (path: string) => Promise<void>
  setGlmMode: (m: GlmMode) => void
  checkGlm: () => Promise<void>
  setWProviderService: (service: WProviderService) => Promise<void>
  checkWProvider: (service?: WProviderService, opts?: { force?: boolean }) => Promise<void>
  wproviderLogin: () => Promise<void>
  wproviderLogout: () => Promise<void>
  /** Save the current backend selection against the active workspace. */
  persistWorkspaceLlm: () => void
  /** Load a workspace's saved backend selection and re-check the connection. */
  syncWorkspaceLlm: (workspaceId: string) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  setUsageOpen: (open: boolean) => void
  setThemePreference: (theme: ThemePreference) => void
  setAppLanguage: (language: AppLanguage) => void
  syncSystemTheme: () => void
  toggleSidebar: () => void
  setSkillsOpen: (open: boolean) => void
  toggleSkill: (id: string) => void
  /** Append a blank skill and return its id (so the UI can open it for editing). */
  addSkill: () => string
  updateSkill: (
    id: string,
    patch: Partial<Pick<Skill, 'name' | 'description' | 'instructions'>>
  ) => void
  deleteSkill: (id: string) => void

  setMode: (m: AgentMode) => void
  submitTask: (text: string) => Promise<void>
  approveTool: (id: string) => void
  rejectTool: (id: string) => void
  /** Stop a run; defaults to the active task when no id is given. */
  stopStreaming: (taskId?: string) => void
  newTask: () => void
}

/**
 * Background probes of the local LM Studio / Ollama servers so their backend
 * options enable when a server comes up and disable when it goes down — even
 * while another provider is active. Each probe is skipped while its own
 * provider is selected, since refreshModels already tracks that connection.
 */
async function probeLocalServers(): Promise<void> {
  if (useApp.getState().provider !== 'lmstudio') {
    const reachable = await api.llm.checkLmStudio().catch(() => false)
    if (useApp.getState().lmStudioReachable !== reachable) {
      useApp.setState({ lmStudioReachable: reachable })
    }
  }
  if (useApp.getState().provider !== 'ollama') {
    const reachable = await api.llm.checkOllama().catch(() => false)
    if (useApp.getState().ollamaReachable !== reachable) {
      useApp.setState({ ollamaReachable: reachable })
    }
  }
}

let localServerProbeTimer: ReturnType<typeof setInterval> | null = null

export const useApp = create<AppState>((set, get) => {
  /** Snapshot the foreground (active task) state as a RunState. */
  const foregroundRun = (s: AppState): RunState => ({
    workspaceId: s.active?.id ?? '',
    workspaceName: s.active?.name ?? '',
    title: s.activeTaskTitle,
    provider: s.provider,
    messages: s.messages,
    convo: s.convo,
    streaming: s.streaming,
    streamId: s.streamId,
    thinking: s.thinking,
    thinkingTokens: s.thinkingTokens,
    thinkingStartedAt: s.thinkingStartedAt,
    codexThreadId: s.codexThreadId,
    copilotSessionId: s.copilotSessionId,
    claudeSessionId: s.claudeSessionId,
    geminiSessionId: s.geminiSessionId,
    glmSessionId: s.glmSessionId
  })

  /** Read a run's live state, whether it's the foreground task or backgrounded. */
  const readRun = (taskId: string): RunState | null => {
    const s = get()
    return s.activeTaskId === taskId ? foregroundRun(s) : (s.runs[taskId] ?? null)
  }

  /**
   * Patch a run's state, routing to the top-level foreground fields when it's
   * the active task or into `runs[taskId]` when it's backgrounded. This lets the
   * agent loop keep updating its own task even after the user switches away.
   */
  const writeRun = (
    taskId: string,
    patch: Partial<RunFields> | ((r: RunState) => Partial<RunFields>)
  ): void =>
    set((s) => {
      if (s.activeTaskId === taskId) {
        return typeof patch === 'function' ? patch(foregroundRun(s)) : patch
      }
      const cur = s.runs[taskId]
      if (!cur) return {}
      const p = typeof patch === 'function' ? patch(cur) : patch
      return { runs: { ...s.runs, [taskId]: { ...cur, ...p } } }
    })

  /**
   * Detach the foreground task before switching away from it: if it's still
   * streaming, snapshot it into `runs` (so it keeps running in the background)
   * and clear the foreground run pointers so its in-flight updates land in the
   * snapshot, not on whatever task becomes active next. A no-op when idle.
   */
  const stashAndDetach = (): void =>
    set((s) => {
      if (!s.streaming || !s.activeTaskId || !s.active) return {}
      return {
        runs: { ...s.runs, [s.activeTaskId]: foregroundRun(s) },
        activeTaskId: null,
        activeTaskTitle: '',
        streaming: false,
        streamId: null,
        thinking: false,
        thinkingTokens: 0,
        thinkingStartedAt: null
      }
    })

  /**
   * Move a backgrounded run into the foreground (e.g. reopening a task that's
   * still running) so the UI shows it live again. Returns false when there is
   * no live run for the task (caller falls back to loading it from disk).
   */
  const hydrateForeground = (taskId: string): boolean => {
    const r = get().runs[taskId]
    if (!r) return false
    set((s) => {
      const runs = { ...s.runs }
      delete runs[taskId]
      return {
        runs,
        activeTaskId: taskId,
        activeTaskTitle: r.title,
        messages: r.messages,
        convo: r.convo,
        streaming: r.streaming,
        streamId: r.streamId,
        thinking: r.thinking,
        thinkingTokens: r.thinkingTokens,
        thinkingStartedAt: r.thinkingStartedAt,
        codexThreadId: r.codexThreadId,
        copilotSessionId: r.copilotSessionId,
        claudeSessionId: r.claudeSessionId,
        geminiSessionId: r.geminiSessionId,
        glmSessionId: r.glmSessionId
      }
    })
    return true
  }

  const switchToSshProviderIfNeeded = async (): Promise<boolean> => {
    if (!get().activeSsh || isSshCapableProvider(get().provider)) return false
    set({ provider: 'lmstudio' })
    await api.llm.setConfig({ provider: 'lmstudio' })
    await get().refreshModels()
    return true
  }

  /**
   * Apply a saved backend selection (from a workspace or a chat) to the live
   * composer fields, push it to the LLM config, and re-check that provider's
   * connection. A missing selection keeps the current one. Shared by
   * syncWorkspaceLlm and openTask so workspace- and chat-scoped restores agree.
   */
  const applyLlm = async (saved?: WorkspaceLlm): Promise<void> => {
    if (saved) {
      set({
        provider: saved.provider,
        model: saved.model,
        ollamaModel: saved.ollamaModel ?? DEFAULT_LLM_CONFIG.ollamaModel,
        openRouterModel: saved.openRouterModel ?? DEFAULT_LLM_CONFIG.openRouterModel,
        codexModel: saved.codexModel,
        codexSandbox: saved.codexSandbox,
        codexReasoning: saved.codexReasoning,
        copilotModel: saved.copilotModel ?? DEFAULT_LLM_CONFIG.copilotModel,
        copilotPermission: saved.copilotPermission ?? DEFAULT_LLM_CONFIG.copilotPermission,
        copilotReasoning: saved.copilotReasoning ?? DEFAULT_LLM_CONFIG.copilotReasoning,
        claudeModel: saved.claudeModel,
        claudePermission: saved.claudePermission,
        geminiModel: saved.geminiModel ?? DEFAULT_LLM_CONFIG.geminiModel,
        geminiPermission: saved.geminiPermission ?? DEFAULT_LLM_CONFIG.geminiPermission,
        glmMode: saved.glmMode,
        wproviderService: saved.wproviderService ?? DEFAULT_LLM_CONFIG.wproviderService
      })
    }
    const provider = get().provider
    if (await switchToSshProviderIfNeeded()) return
    if (provider === 'openrouter' && (!get().openRouterEnabled || !get().openRouterApiKey.trim())) {
      set({ provider: 'lmstudio' })
      await api.llm.setConfig({ provider: 'lmstudio' })
      await get().refreshModels()
      return
    }
    await api.llm.setConfig({
      provider,
      model: get().model,
      ollamaModel: get().ollamaModel,
      openRouterModel: get().openRouterModel,
      codexModel: get().codexModel,
      codexSandbox: get().codexSandbox,
      codexReasoning: get().codexReasoning,
      copilotModel: get().copilotModel,
      copilotPermission: get().copilotPermission,
      copilotReasoning: get().copilotReasoning,
      claudeModel: get().claudeModel,
      claudePermission: get().claudePermission,
      geminiModel: get().geminiModel,
      geminiPermission: get().geminiPermission,
      glmMode: get().glmMode,
      wproviderService: get().wproviderService
    })
    if (provider === 'codex') await get().checkCodex()
    else if (provider === 'copilot') await get().checkCopilot()
    else if (provider === 'claude') await get().checkClaude()
    else if (provider === 'gemini') await get().checkGemini()
    else if (provider === 'glm') await get().checkGlm()
    else if (provider === 'wprovider') await get().checkWProvider()
    else await get().refreshModels()
  }

  return {
  view: 'home',
  workspaces: [],
  workspaceOrder: [],
  collapsedWorkspaces: {},
  active: null,
  tasksByWorkspace: {},
  activeTaskId: null,
  archivedTaskId: null,
  activeTaskTitle: '',
  runs: {},
  treeRoots: [],
  childrenByPath: {},
  expanded: {},
  treeLoading: false,
  treeError: null,
  openFiles: [],
  activeFile: null,

  liveUrl: null,
  livePort: null,
  liveRoot: null,
  previewUrl: null,
  previewMode: 'docked',
  dockLayout: null,
  terminalRequest: null,

  sshConnections: [],
  openSshTerminals: [],
  activeSsh: null,
  sshElevated: {},
  sshModalOpen: false,
  sshEditing: null,

  provider: DEFAULT_LLM_CONFIG.provider,
  workspaceLlm: {},
  taskLlm: {},
  baseUrl: DEFAULT_LLM_CONFIG.baseUrl,
  model: '',
  ollamaBaseUrl: DEFAULT_LLM_CONFIG.ollamaBaseUrl,
  ollamaModel: DEFAULT_LLM_CONFIG.ollamaModel,
  models: [],
  connection: 'unknown',
  lmStudioReachable: false,
  ollamaReachable: false,
  openRouterEnabled: DEFAULT_LLM_CONFIG.openRouterEnabled,
  openRouterApiKey: DEFAULT_LLM_CONFIG.openRouterApiKey,
  openRouterModel: DEFAULT_LLM_CONFIG.openRouterModel,
  codexPath: DEFAULT_LLM_CONFIG.codexPath,
  codexModel: DEFAULT_LLM_CONFIG.codexModel,
  codexSandbox: DEFAULT_LLM_CONFIG.codexSandbox,
  codexReasoning: DEFAULT_LLM_CONFIG.codexReasoning,
  codexThreadId: null,
  codexCheck: null,
  codexChecking: false,
  codexUsage: null,
  copilotPath: DEFAULT_LLM_CONFIG.copilotPath,
  copilotModel: DEFAULT_LLM_CONFIG.copilotModel,
  copilotPermission: DEFAULT_LLM_CONFIG.copilotPermission,
  copilotReasoning: DEFAULT_LLM_CONFIG.copilotReasoning,
  copilotSessionId: null,
  copilotCheck: null,
  copilotChecking: false,
  copilotAuthOpen: false,
  claudePath: DEFAULT_LLM_CONFIG.claudePath,
  claudeModel: DEFAULT_LLM_CONFIG.claudeModel,
  claudePermission: DEFAULT_LLM_CONFIG.claudePermission,
  claudeSessionId: null,
  claudeCheck: null,
  claudeChecking: false,
  claudeUsage: null,
  geminiPath: DEFAULT_LLM_CONFIG.geminiPath,
  geminiModel: DEFAULT_LLM_CONFIG.geminiModel,
  geminiPermission: DEFAULT_LLM_CONFIG.geminiPermission,
  geminiSessionId: null,
  geminiCheck: null,
  geminiChecking: false,
  glmPath: DEFAULT_LLM_CONFIG.glmPath,
  glmMode: DEFAULT_LLM_CONFIG.glmMode,
  glmSessionId: null,
  glmCheck: null,
  glmChecking: false,
  wproviderService: DEFAULT_LLM_CONFIG.wproviderService,
  wproviderCheck: null,
  wproviderChecks: {},
  wproviderChecking: false,
  wproviderLoggingIn: false,
  settingsOpen: false,
  usageOpen: false,
  themePreference: 'dark',
  resolvedTheme: 'dark',
  appLanguage: 'en',
  sidebarCollapsed: false,
  skills: DEFAULT_SKILLS,
  skillsOpen: false,

  mode: 'ask',
  messages: [],
  convo: [],
  streaming: false,
  streamId: null,
  thinking: false,
  thinkingTokens: 0,
  thinkingStartedAt: null,

  async init() {
    const [
      workspaces,
      cfg,
      savedTheme,
      savedLanguage,
      savedOrder,
      savedCollapsed,
      savedLlm,
      savedTaskLlm,
      savedSidebar,
      savedSkills,
      savedSsh
    ] = await Promise.all([
        api.workspace.list(),
        api.llm.config(),
        api.settings.get<ThemePreference>('appearance.theme'),
        api.settings.get<AppLanguage>('appearance.language'),
        api.settings.get<string[]>('workspace.order'),
        api.settings.get<Record<string, boolean>>('workspace.collapsed'),
        api.settings.get<Record<string, WorkspaceLlm>>('workspace.llm'),
        api.settings.get<Record<string, WorkspaceLlm>>('task.llm'),
        api.settings.get<boolean>('sidebar.collapsed'),
        api.settings.get<Skill[]>('skills'),
        api.settings.get<SshConnection[]>('ssh.connections')
      ])
    const workspaceOrder = Array.isArray(savedOrder) ? savedOrder : []
    const collapsedWorkspaces =
      savedCollapsed && typeof savedCollapsed === 'object' ? savedCollapsed : {}
    const workspaceLlm = savedLlm && typeof savedLlm === 'object' ? savedLlm : {}
    const taskLlm = savedTaskLlm && typeof savedTaskLlm === 'object' ? savedTaskLlm : {}
    const ordered = sortWorkspaces(workspaces, workspaceOrder)
    const themePreference = isThemePreference(savedTheme) ? savedTheme : 'dark'
    const resolvedTheme = applyTheme(themePreference)
    const appLanguage = isLanguageCode(savedLanguage) ? savedLanguage : 'en'
    applyLanguage(appLanguage)
    const sshConnections = Array.isArray(savedSsh) ? savedSsh : []
    const taskLists = await Promise.all(
      [
        ...ordered.map((workspace) => workspace.id),
        // SSH hosts keep their chats under a pseudo-workspace, loaded up front
        // so the rail shows each host's history before it ever connects.
        ...sshConnections.map((conn) => sshWorkspaceId(conn.id))
      ].map(async (id) => [id, await api.workspace.tasks(id)] as const)
    )
    set({
      workspaces: ordered,
      workspaceOrder,
      collapsedWorkspaces,
      workspaceLlm,
      taskLlm,
      tasksByWorkspace: Object.fromEntries(taskLists),
      sidebarCollapsed: savedSidebar === true,
      // First run (no saved value) seeds the defaults; an empty saved array is
      // respected (the user removed every skill).
      skills: Array.isArray(savedSkills) ? savedSkills : DEFAULT_SKILLS,
      sshConnections,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      ollamaBaseUrl: cfg.ollamaBaseUrl,
      ollamaModel: cfg.ollamaModel,
      openRouterEnabled: cfg.openRouterEnabled,
      openRouterApiKey: cfg.openRouterApiKey,
      openRouterModel: cfg.openRouterModel,
      codexPath: cfg.codexPath,
      codexModel: cfg.codexModel,
      codexSandbox: cfg.codexSandbox,
      codexReasoning: cfg.codexReasoning,
      copilotPath: cfg.copilotPath,
      copilotModel: cfg.copilotModel,
      copilotPermission: cfg.copilotPermission,
      copilotReasoning: cfg.copilotReasoning,
      claudePath: cfg.claudePath,
      claudeModel: cfg.claudeModel,
      claudePermission: cfg.claudePermission,
      geminiPath: cfg.geminiPath,
      geminiModel: cfg.geminiModel,
      geminiPermission: cfg.geminiPermission,
      glmPath: cfg.glmPath,
      glmMode: cfg.glmMode,
      wproviderService: cfg.wproviderService,
      themePreference,
      resolvedTheme,
      appLanguage
    })
    if (ordered.length > 0) {
      await get().loadWorkspaceData(ordered[0])
      // Apply that workspace's saved model/provider and check the connection.
      await get().syncWorkspaceLlm(ordered[0].id)
    } else {
      await get().refreshModels()
      if (cfg.provider === 'codex') await get().checkCodex()
      if (cfg.provider === 'copilot') await get().checkCopilot()
      if (cfg.provider === 'claude') await get().checkClaude()
      if (cfg.provider === 'gemini') await get().checkGemini()
      if (cfg.provider === 'glm') await get().checkGlm()
      if (cfg.provider === 'wprovider') await get().checkWProvider()
    }
    // Keep the LM Studio / Ollama backend options in sync with the local servers.
    void probeLocalServers()
    if (!localServerProbeTimer)
      localServerProbeTimer = setInterval(() => void probeLocalServers(), 5000)
  },

  async openFolder() {
    const ws = await api.dialog.openFolder()
    if (!ws) return
    const workspaces = await api.workspace.list()
    const tasks = await api.workspace.tasks(ws.id)
    set((state) => ({
      workspaces: sortWorkspaces(workspaces, state.workspaceOrder),
      tasksByWorkspace: { ...state.tasksByWorkspace, [ws.id]: tasks }
    }))
    await get().openWorkspace(ws)
  },

  async loadWorkspaceData(ws) {
    set({
      active: ws,
      activeSsh: null,
      treeLoading: true,
      treeRoots: [],
      childrenByPath: {},
      expanded: {},
      openFiles: [],
      activeFile: null
    })
    const roots = await api.fs.readTree(ws.path)
    set({ treeRoots: roots, treeLoading: false })
  },

  async openWorkspace(ws) {
    // Re-selecting the workspace that's actively streaming just returns to its
    // live view (don't blank the in-progress task). Switching to a different
    // workspace stashes the running task to the background so it keeps going.
    if (get().streaming && get().active?.id === ws.id) {
      set({ view: 'workspace' })
      return
    }
    stashAndDetach()
    await get().loadWorkspaceData(ws)
    const tasks = await api.workspace.tasks(ws.id)
    set((state) => ({
      view: 'workspace',
      messages: [],
      convo: [],
      activeTaskId: null,
      activeTaskTitle: '',
      codexThreadId: null,
      copilotSessionId: null,
      claudeSessionId: null,
      geminiSessionId: null,
      glmSessionId: null,
      // Selecting a workspace makes it the active context, not an SSH host.
      activeSsh: null,
      tasksByWorkspace: { ...state.tasksByWorkspace, [ws.id]: tasks }
    }))
    // Switch to this project's saved model/provider.
    await get().syncWorkspaceLlm(ws.id)
  },

  async loadSshData(id) {
    const conn = get().sshConnections.find((c) => c.id === id)
    if (!conn) return
    // Keep any foreground run alive in the background before switching to SSH.
    stashAndDetach()
    const placeholder = sshWorkspace(conn)
    set({
      active: placeholder,
      activeSsh: id,
      treeLoading: true,
      treeRoots: [],
      childrenByPath: {},
      expanded: {},
      openFiles: [],
      activeFile: null,
      messages: [],
      convo: [],
      activeTaskId: null,
      activeTaskTitle: '',
      codexThreadId: null,
      copilotSessionId: null,
      claudeSessionId: null,
      geminiSessionId: null,
      glmSessionId: null,
      view: 'workspace'
    })
    void switchToSshProviderIfNeeded()
    const pwd = await api.ssh.exec(id, 'pwd')
    const root = !sshFailed(pwd) && pwd.stdout?.trim()
      ? (pwd.stdout.trim().split(/\r?\n/).at(-1) ?? '~')
      : '~'
    const ws = sshWorkspace(conn, root)
    const [tasks, tree] = await Promise.all([
      api.workspace.tasks(ws.id).catch(() => [] as TaskSummary[]),
      sshReadTree(id, root, root)
    ])
    set((state) => ({
      active: ws,
      activeSsh: id,
      treeRoots: tree.nodes,
      treeError: tree.error ?? null,
      treeLoading: false,
      // A fresh connection starts unelevated (main resets the session too).
      sshElevated: { ...state.sshElevated, [id]: false },
      tasksByWorkspace: { ...state.tasksByWorkspace, [ws.id]: tasks }
    }))
  },

  toggleWorkspaceCollapsed(id) {
    set((s) => {
      const next = { ...s.collapsedWorkspaces }
      if (next[id]) delete next[id]
      else next[id] = true
      void api.settings.set('workspace.collapsed', next)
      return { collapsedWorkspaces: next }
    })
  },

  setAllWorkspacesCollapsed(collapsed) {
    set((s) => {
      // Keep SSH host collapse state intact: this control manages only the
      // regular Workspaces section in the left rail.
      const workspaceIds = new Set(s.workspaces.map((workspace) => workspace.id))
      const next = Object.fromEntries(
        Object.entries(s.collapsedWorkspaces).filter(([id]) => !workspaceIds.has(id))
      ) as Record<string, boolean>
      if (collapsed) {
        for (const workspace of s.workspaces) next[workspace.id] = true
      }
      void api.settings.set('workspace.collapsed', next)
      return { collapsedWorkspaces: next }
    })
  },

  reorderWorkspaces(draggedId, targetId) {
    if (draggedId === targetId) return
    set((s) => {
      const list = [...s.workspaces]
      const from = list.findIndex((w) => w.id === draggedId)
      if (from === -1) return {}
      const [moved] = list.splice(from, 1)
      const to = list.findIndex((w) => w.id === targetId)
      // Drop the dragged folder just before the target row.
      list.splice(to === -1 ? list.length : to, 0, moved)
      const workspaceOrder = list.map((w) => w.id)
      void api.settings.set('workspace.order', workspaceOrder)
      return { workspaces: list, workspaceOrder }
    })
  },

  async openTask(ws, taskId, includeDeleted = false) {
    // Re-selecting the task that's already open (e.g. coming back from Analytics
    // while it's still streaming) just returns to it — never reload it from disk,
    // which would clobber the in-flight messages/convo.
    if (get().activeTaskId === taskId) {
      set({ view: 'workspace', archivedTaskId: includeDeleted ? taskId : null })
      return
    }
    // Stash whatever is streaming in the foreground so it keeps running while we
    // switch — and so its async updates land in its snapshot, not on this task.
    stashAndDetach()
    const switchingWorkspace = get().active?.id !== ws.id
    if (switchingWorkspace) await get().loadWorkspaceData(ws)
    // If this task has a live run in the background, restore it as-is; otherwise
    // load its persisted history from disk.
    if (get().runs[taskId]) {
      set({ active: ws, activeSsh: null, view: 'workspace' })
      hydrateForeground(taskId)
    } else {
      const task = await api.workspace.task(taskId, includeDeleted)
      if (!task || task.workspaceId !== ws.id) return
      set({
        active: ws,
        activeTaskId: task.id,
        archivedTaskId: task.deletedAt ? task.id : null,
        activeTaskTitle: task.title,
        messages: task.messages,
        convo: task.convo,
        streaming: false,
        streamId: null,
        thinking: false,
        thinkingTokens: 0,
        thinkingStartedAt: null,
        // Restore the CLI session handles so a reopened chat keeps its context;
        // null for older records and non-CLI chats (which resume from convo).
        codexThreadId: task.sessions?.codexThreadId ?? null,
        copilotSessionId: task.sessions?.copilotSessionId ?? null,
        claudeSessionId: task.sessions?.claudeSessionId ?? null,
        geminiSessionId: task.sessions?.geminiSessionId ?? null,
        glmSessionId: task.sessions?.glmSessionId ?? null,
        // Opening a task returns the active context to its workspace, not an SSH host.
        activeSsh: null,
        view: 'workspace'
      })
    }
    // Restore this chat's own model/provider; fall back to the project default
    // when the chat has no saved selection yet (e.g. older tasks).
    const savedTaskLlm = get().taskLlm[taskId]
    if (savedTaskLlm) await applyLlm(savedTaskLlm)
    else if (switchingWorkspace) await get().syncWorkspaceLlm(ws.id)
  },

  async deleteTask(ws, taskId) {
    const liveRun = readRun(taskId)
    if (liveRun?.streaming) {
      deletedRuns.add(taskId)
      get().stopStreaming(taskId)
    }
    await api.workspace.deleteTask(taskId)
    set((state) => {
      const tasks = state.tasksByWorkspace[ws.id] ?? []
      const nextTasks = tasks.filter((task) => task.id !== taskId)
      const next = { ...state.tasksByWorkspace, [ws.id]: nextTasks }
      const runs = { ...state.runs }
      delete runs[taskId]
      // Drop the deleted chat's pinned model selection.
      const taskLlm = { ...state.taskLlm }
      if (taskId in taskLlm) {
        delete taskLlm[taskId]
        void api.settings.set('task.llm', taskLlm)
      }
      // If the deleted task was open, drop its draft state and return home.
      const wasActive = state.activeTaskId === taskId
      return wasActive
        ? {
            tasksByWorkspace: next,
            runs,
            taskLlm,
            messages: [],
            convo: [],
            activeTaskId: null,
            activeTaskTitle: '',
            streaming: false,
            streamId: null,
            thinking: false,
            thinkingTokens: 0,
            thinkingStartedAt: null,
            codexThreadId: null,
            copilotSessionId: null,
            claudeSessionId: null,
            geminiSessionId: null,
            glmSessionId: null,
            // Deleting the open chat of an SSH host keeps its context on
            // screen (the terminal is still connected) with a blank composer.
            view: isSshWorkspaceId(ws.id) ? state.view : state.active ? 'home' : state.view
          }
        : { tasksByWorkspace: next, runs, taskLlm }
    })
  },

  async renameWorkspace(id, name) {
    const value = name.trim()
    if (!value) return false
    const renamed = await api.workspace.rename(id, value)
    if (!renamed) return false
    set((state) => ({
      workspaces: state.workspaces.map((workspace) => workspace.id === id ? renamed : workspace),
      active: state.active?.id === id ? renamed : state.active
    }))
    return true
  },

  async restoreTask(ws, taskId) {
    const restored = await api.workspace.restoreTask(taskId)
    if (!restored) return
    set((state) => ({
      tasksByWorkspace: {
        ...state.tasksByWorkspace,
        [ws.id]: [restored, ...(state.tasksByWorkspace[ws.id] ?? []).filter((task) => task.id !== taskId)]
      },
      archivedTaskId: state.archivedTaskId === taskId ? null : state.archivedTaskId
    }))
  },

  async saveTaskRun(taskId, status) {
    if (deletedRuns.has(taskId)) return
    const run = readRun(taskId)
    if (!run || !run.workspaceId) return
    try {
      const summary = await api.workspace.saveTask({
        id: taskId,
        workspaceId: run.workspaceId,
        title: run.title,
        status,
        updatedAt: Date.now(),
        messages: run.messages,
        convo: run.convo,
        // Keep the CLI session handles so reopening this chat resumes its
        // server-side context instead of starting the agent from scratch.
        sessions: {
          codexThreadId: run.codexThreadId,
          copilotSessionId: run.copilotSessionId,
          claudeSessionId: run.claudeSessionId,
          geminiSessionId: run.geminiSessionId,
          glmSessionId: run.glmSessionId
        }
      })
      set((current) => {
        const tasks = current.tasksByWorkspace[summary.workspaceId] ?? []
        return {
          tasksByWorkspace: {
            ...current.tasksByWorkspace,
            [summary.workspaceId]: [summary, ...tasks.filter((task) => task.id !== summary.id)]
          }
        }
      })
    } catch (error) {
      console.error('[tasks] failed to save task:', error)
    }
  },

  goHome() {
    set({ view: 'home' })
  },

  openAnalytics() {
    set({ view: 'analytics' })
  },

  closeAnalytics() {
    set({ view: get().active ? 'workspace' : 'home' })
  },

  async toggleDir(node) {
    const { active, activeSsh, expanded, childrenByPath } = get()
    const isOpen = !!expanded[node.path]
    if (isOpen) {
      set({ expanded: { ...expanded, [node.path]: false } })
      return
    }
    if (!childrenByPath[node.path]) {
      if (activeSsh) {
        const tree = await sshReadTree(activeSsh, node.path, active?.path ?? '.')
        set((s) => ({
          childrenByPath: { ...s.childrenByPath, [node.path]: tree.nodes },
          treeError: tree.error ?? null
        }))
      } else {
        const children = await api.fs.readTree(node.path)
        set((s) => ({ childrenByPath: { ...s.childrenByPath, [node.path]: children } }))
      }
    }
    set((s) => ({ expanded: { ...s.expanded, [node.path]: true } }))
  },

  async refreshDirectory(path) {
    const { active, activeSsh } = get()
    if (!active) return
    if (!activeSsh) {
      const children = await api.fs.readTree(path)
      const normalize = (value: string): string =>
        value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (normalize(path) === normalize(active.path)) set({ treeRoots: children })
      else set((state) => ({ childrenByPath: { ...state.childrenByPath, [path]: children } }))
      return
    }
    const tree = await sshReadTree(activeSsh, path, active.path)
    const normalize = (value: string): string =>
      value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (normalize(path) === normalize(active.path)) {
      set({ treeRoots: tree.nodes, treeError: tree.error ?? null })
      return
    }
    set((state) => ({
      childrenByPath: { ...state.childrenByPath, [path]: tree.nodes },
      treeError: tree.error ?? null
    }))
  },

  async goUpDirectory() {
    const { active, activeSsh } = get()
    if (!active || !activeSsh) return
    const parent = remoteParent(active.path)
    if (parent === active.path) return // already at the filesystem root
    set({ treeLoading: true })
    const tree = await sshReadTree(activeSsh, parent, parent)
    set((state) => ({
      active: state.active ? { ...state.active, path: parent } : state.active,
      treeRoots: tree.nodes,
      treeError: tree.error ?? null,
      treeLoading: false,
      // The new root is a different directory; old expansion/children are stale.
      expanded: {},
      childrenByPath: {}
    }))
  },

  async toggleSshElevation() {
    const { activeSsh, active, sshElevated } = get()
    if (!activeSsh || !active) return
    const enabled = !sshElevated[activeSsh]
    await api.ssh.setElevation(activeSsh, enabled)
    // Listing as a different user can change visibility/permissions, so drop the
    // cached expansion and re-list from the root.
    set((state) => ({
      sshElevated: { ...state.sshElevated, [activeSsh]: enabled },
      expanded: {},
      childrenByPath: {}
    }))
    await get().refreshDirectory(active.path)
  },

  async openFile(node) {
    const existing = get().openFiles.find((f) => f.path === node.path)
    if (existing) {
      set({ activeFile: node.path, view: 'workspace' })
      return
    }
    const { active, activeSsh } = get()
    const file = activeSsh
      ? await sshReadFileContent(activeSsh, node.path, active?.path ?? '.')
      : await api.fs.readFile(node.path)
    set((s) => ({
      openFiles: [
        ...s.openFiles,
        {
          path: file.path,
          name: node.name,
          content: file.content,
          language: file.language,
          truncated: file.truncated
        }
      ],
      activeFile: file.path,
      view: 'workspace'
    }))
  },

  createFile(parentPath, name) {
    const id = get().activeSsh
    return id ? sshCreateFile(id, parentPath, name) : api.fs.createFile(parentPath, name)
  },

  createDirectory(parentPath, name) {
    const id = get().activeSsh
    return id ? sshCreateDirectory(id, parentPath, name) : api.fs.createDirectory(parentPath, name)
  },

  renamePath(path, newName, type) {
    const id = get().activeSsh
    return id
      ? sshRenamePath(id, path, newName)
      : type === 'directory'
        ? api.fs.renameDirectory(path, newName)
        : api.fs.renameFile(path, newName)
  },

  movePath(path, targetDirectoryPath) {
    const id = get().activeSsh
    return id ? sshMovePath(id, path, targetDirectoryPath) : api.fs.movePath(path, targetDirectoryPath)
  },

  deleteFilePath(path) {
    const id = get().activeSsh
    return id ? sshDeleteFile(id, path) : api.fs.deleteFile(path)
  },

  deleteDirectoryPath(path) {
    const id = get().activeSsh
    return id ? sshDeleteDirectory(id, path) : api.fs.deleteDirectory(path)
  },

  renameOpenFile(oldPath, newPath, newName) {
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.path === oldPath ? { ...file, path: newPath, name: newName } : file
      ),
      activeFile: state.activeFile === oldPath ? newPath : state.activeFile
    }))
  },

  renameOpenPathPrefix(oldPath, newPath) {
    const normalize = (path: string): string => path.replace(/\\/g, '/')
    const oldPrefix = `${normalize(oldPath).replace(/\/+$/, '')}/`
    const rewrite = (path: string): string => {
      const normalized = normalize(path)
      if (!normalized.startsWith(oldPrefix)) return path
      const separator = newPath.includes('\\') ? '\\' : '/'
      const tail = normalized.slice(oldPrefix.length).replace(/\//g, separator)
      return `${newPath.replace(/[\\/]+$/, '')}${separator}${tail}`
    }
    set((state) => ({
      openFiles: state.openFiles.map((file) => ({ ...file, path: rewrite(file.path) })),
      activeFile: state.activeFile ? rewrite(state.activeFile) : null
    }))
  },

  closeFilesUnder(path) {
    const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
    const prefix = `${normalize(path)}/`
    set((state) => {
      const openFiles = state.openFiles.filter((file) => !normalize(file.path).startsWith(prefix))
      const activeFile =
        state.activeFile && normalize(state.activeFile).startsWith(prefix)
          ? (openFiles.at(-1)?.path ?? null)
          : state.activeFile
      return { openFiles, activeFile }
    })
  },

  closeFile(path) {
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      const activeFile = s.activeFile === path ? (openFiles.at(-1)?.path ?? null) : s.activeFile
      return { openFiles, activeFile }
    })
  },

  closeOtherFiles(path) {
    set((s) => {
      const kept = s.openFiles.find((f) => f.path === path)
      return kept ? { openFiles: [kept], activeFile: kept.path } : {}
    })
  },

  closeFilesToRight(path) {
    set((s) => {
      const index = s.openFiles.findIndex((f) => f.path === path)
      if (index === -1) return {}
      const openFiles = s.openFiles.slice(0, index + 1)
      // Keep the current file active unless it was one of the closed (right-side) tabs.
      const activeFile = openFiles.some((f) => f.path === s.activeFile) ? s.activeFile : path
      return { openFiles, activeFile }
    })
  },

  closeAllFiles() {
    set({ openFiles: [], activeFile: null })
  },

  setActiveFile(path) {
    set({ activeFile: path })
  },

  updateOpenFileContent(path, content) {
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.path === path && file.content !== content
          ? { ...file, content, dirty: true }
          : file
      )
    }))
  },

  async saveActiveFile() {
    const { active, activeSsh, openFiles, activeFile } = get()
    if (!active || !activeFile) return
    const file = openFiles.find((f) => f.path === activeFile)
    if (!file || file.truncated || file.saving || !file.dirty) return
    set((state) => ({
      openFiles: state.openFiles.map((f) => (f.path === file.path ? { ...f, saving: true } : f))
    }))
    const result = activeSsh
      ? await sshWriteFile(activeSsh, file.path, file.content, active.path)
      : await api.agent.writeFile(active.path, localRelativePath(active.path, file.path), file.content)
    if (!result.ok) {
      set((state) => ({
        openFiles: state.openFiles.map((f) => (f.path === file.path ? { ...f, saving: false } : f))
      }))
      window.alert(result.error ?? 'Failed to save file.')
      return
    }
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === file.path ? { ...f, dirty: false, saving: false } : f
      )
    }))
  },

  async goLive() {
    const { active, activeSsh, openFiles, activeFile, liveUrl, liveRoot } = get()
    if (!active || activeSsh) return
    const file = openFiles.find((f) => f.path === activeFile)
    if (!file || !/\.html?$/i.test(file.name)) return

    let base = liveUrl
    if (!base || liveRoot !== active.path) {
      const result = await api.live.start(active.path)
      if (!result.ok || !result.url) {
        window.alert(result.error ?? 'Failed to start Live Server.')
        return
      }
      base = result.url
      set({ liveUrl: result.url, livePort: result.port ?? null, liveRoot: active.path })
    }

    // URL of the active file relative to the workspace root the server serves.
    const root = active.path.replace(/\\/g, '/').replace(/\/+$/, '')
    const full = file.path.replace(/\\/g, '/')
    const rel = full.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? full.slice(root.length + 1)
      : (full.split('/').pop() ?? '')
    const encoded = rel.split('/').map(encodeURIComponent).join('/')
    // The status bar "Live" button always brings the preview back docked.
    const wasWindow = get().previewMode === 'window'
    set({ previewUrl: `${base}/${encoded}`, previewMode: 'docked' })
    if (wasWindow) void api.live.closeWindow()
  },

  async stopLive() {
    await api.live.stop()
    set({ liveUrl: null, livePort: null, liveRoot: null, previewUrl: null, previewMode: 'docked' })
  },

  closePreview() {
    const wasWindow = get().previewMode === 'window'
    set({ previewUrl: null, previewMode: 'docked' })
    if (wasWindow) void api.live.closeWindow()
  },

  detachPreview() {
    const url = get().previewUrl
    if (!url) return
    set({ previewMode: 'window' })
    void api.live.openWindow(url)
  },

  handlePreviewWindowClosed() {
    // User closed the detached window → drop the preview (server keeps running).
    if (get().previewMode === 'window') set({ previewUrl: null, previewMode: 'docked' })
  },

  openPreviewInBrowser() {
    const url = get().previewUrl
    if (url) void api.live.openExternal(url)
  },

  setDockLayout(layout) {
    set({ dockLayout: layout })
  },

  runFile(node) {
    // The built-in terminal is local-only (it's hidden while an SSH host is the
    // active context), so running a remote file there wouldn't make sense.
    if (node.type !== 'file' || get().activeSsh) return
    const command = runCommandForFile(node.path)
    if (!command) return
    set((s) => ({ terminalRequest: { command, nonce: (s.terminalRequest?.nonce ?? 0) + 1 } }))
  },

  openSshModal(conn) {
    set({ sshModalOpen: true, sshEditing: conn ?? null })
  },

  closeSshModal() {
    set({ sshModalOpen: false, sshEditing: null })
  },

  saveSshConnection(conn) {
    set((state) => {
      const exists = state.sshConnections.some((c) => c.id === conn.id)
      const sshConnections = exists
        ? state.sshConnections.map((c) => (c.id === conn.id ? conn : c))
        : [...state.sshConnections, conn]
      void api.settings.set('ssh.connections', sshConnections)
      return { sshConnections, sshModalOpen: false, sshEditing: null }
    })
  },

  deleteSshConnection(id) {
    get().closeSshTerminal(id)
    // Removing a host removes its saved chats too — nothing else can reach them.
    const wsId = sshWorkspaceId(id)
    for (const chat of get().tasksByWorkspace[wsId] ?? []) void api.workspace.deleteTask(chat.id)
    set((state) => {
      const sshConnections = state.sshConnections.filter((c) => c.id !== id)
      void api.settings.set('ssh.connections', sshConnections)
      const tasksByWorkspace = { ...state.tasksByWorkspace }
      delete tasksByWorkspace[wsId]
      return { sshConnections, tasksByWorkspace }
    })
  },

  pickSshKey() {
    return api.ssh.pickKey()
  },

  openSshTerminal(id) {
    const alreadyActive = get().activeSsh === id && isSshWorkspaceId(get().active?.id)
    set((state) => ({
      openSshTerminals: state.openSshTerminals.includes(id)
        ? state.openSshTerminals
        : [...state.openSshTerminals, id],
      activeSsh: id,
      view: 'workspace'
    }))
    void switchToSshProviderIfNeeded()
    if (!alreadyActive || get().treeRoots.length === 0) void get().loadSshData(id)
  },

  closeSshTerminal(id) {
    void api.ssh.disconnect(id)
    set((state) => {
      const openSshTerminals = state.openSshTerminals.filter((t) => t !== id)
      const activeSsh =
        state.activeSsh === id ? (openSshTerminals.at(-1) ?? null) : state.activeSsh
      const leavingSshContext = state.activeSsh === id && !activeSsh && isSshWorkspaceId(state.active?.id)
      return {
        openSshTerminals,
        activeSsh,
        ...(leavingSshContext
          ? {
              active: null,
              treeRoots: [],
              childrenByPath: {},
              expanded: {},
              openFiles: [],
              activeFile: null,
              messages: [],
              convo: [],
              activeTaskId: null,
              activeTaskTitle: '',
              view: 'home' as const
            }
          : {})
      }
    })
    const next = get().activeSsh
    if (next) void get().loadSshData(next)
  },

  async openSshTask(connId, taskId) {
    // Re-selecting the chat that's already open just returns to its view.
    if (get().activeTaskId === taskId && get().activeSsh === connId) {
      set({ view: 'workspace' })
      return
    }
    const sameContext = get().activeSsh === connId && isSshWorkspaceId(get().active?.id)
    set((state) => ({
      openSshTerminals: state.openSshTerminals.includes(connId)
        ? state.openSshTerminals
        : [...state.openSshTerminals, connId],
      activeSsh: connId,
      view: 'workspace'
    }))
    void switchToSshProviderIfNeeded()
    // Bring the host context up first (loadSshData stashes any streaming task
    // and blanks the chat pane), then hydrate this chat on top of it.
    if (!sameContext || get().treeRoots.length === 0) await get().loadSshData(connId)
    else stashAndDetach()
    // The user may have switched context while the connection was coming up.
    if (get().activeSsh !== connId) return
    if (!hydrateForeground(taskId)) {
      const task = await api.workspace.task(taskId)
      if (!task || task.workspaceId !== sshWorkspaceId(connId)) return
      if (get().activeSsh !== connId) return
      set({
        activeTaskId: task.id,
        activeTaskTitle: task.title,
        messages: task.messages,
        convo: task.convo,
        streaming: false,
        streamId: null,
        thinking: false,
        thinkingTokens: 0,
        thinkingStartedAt: null,
        codexThreadId: null,
        copilotSessionId: null,
        claudeSessionId: null,
        geminiSessionId: null,
        glmSessionId: null
      })
    }
    // Restore this chat's own model/provider when it has one pinned.
    const savedTaskLlm = get().taskLlm[taskId]
    if (savedTaskLlm) await applyLlm(savedTaskLlm)
  },

  newSshTask(connId) {
    const alreadyActive = get().activeSsh === connId && isSshWorkspaceId(get().active?.id)
    if (!alreadyActive) {
      // Opening the host fresh already lands on a blank chat.
      get().openSshTerminal(connId)
      return
    }
    stashAndDetach()
    set({
      messages: [],
      convo: [],
      activeTaskId: null,
      activeTaskTitle: '',
      streaming: false,
      streamId: null,
      thinking: false,
      thinkingTokens: 0,
      thinkingStartedAt: null,
      codexThreadId: null,
      copilotSessionId: null,
      claudeSessionId: null,
      geminiSessionId: null,
      glmSessionId: null,
      view: 'workspace'
    })
  },

  async deleteSshTask(connId, taskId) {
    const conn = get().sshConnections.find((c) => c.id === connId)
    if (!conn) return
    await get().deleteTask(sshWorkspace(conn), taskId)
  },

  async refreshModels() {
    set({ connection: 'connecting', connectionError: undefined })
    const res = await api.llm.listModels()
    const isOpenRouter = get().provider === 'openrouter'
    const isOllama = get().provider === 'ollama'
    if (res.ok) {
      const models = (res.models ?? []).map((m) => m.id)
      const selected =
        (isOpenRouter ? get().openRouterModel : isOllama ? get().ollamaModel : get().model) ||
        models[0] ||
        ''
      set(
        isOpenRouter
          ? { models, connection: 'connected', openRouterModel: selected }
          : isOllama
            ? { models, connection: 'connected', ollamaModel: selected, ollamaReachable: true }
            : { models, connection: 'connected', model: selected, lmStudioReachable: true }
      )
      if (selected) {
        void api.llm.setConfig(
          isOpenRouter
            ? { openRouterModel: selected }
            : isOllama
              ? { ollamaModel: selected }
              : { model: selected }
        )
      }
    } else {
      // Drop the previous backend's model list so a failed provider never shows
      // another's models (e.g. OpenRouter's list under a down LM Studio).
      set({
        connection: 'error',
        connectionError: res.error,
        models: [],
        ...(isOllama ? { ollamaReachable: false } : {}),
        ...(!isOpenRouter && !isOllama ? { lmStudioReachable: false } : {})
      })
    }
  },

  setModel(model) {
    set({ model })
    void api.llm.setConfig({ model })
    get().persistWorkspaceLlm()
  },

  async setBaseUrl(url) {
    set({ baseUrl: url })
    await api.llm.setConfig({ baseUrl: url })
    await get().refreshModels()
  },

  setOllamaModel(ollamaModel) {
    set({ ollamaModel })
    void api.llm.setConfig({ ollamaModel })
    get().persistWorkspaceLlm()
  },

  async setOllamaBaseUrl(url) {
    set({ ollamaBaseUrl: url })
    await api.llm.setConfig({ ollamaBaseUrl: url })
    await get().refreshModels()
  },

  async setProvider(provider) {
    if (get().activeSsh && !isSshCapableProvider(provider)) return
    set({ provider })
    await api.llm.setConfig({ provider })
    get().persistWorkspaceLlm()
    if (provider === 'codex') await get().checkCodex()
    else if (provider === 'copilot') await get().checkCopilot()
    else if (provider === 'claude') await get().checkClaude()
    else if (provider === 'gemini') await get().checkGemini()
    else if (provider === 'glm') await get().checkGlm()
    else if (provider === 'wprovider') await get().checkWProvider()
    else await get().refreshModels()
  },

  async setOpenRouterEnabled(openRouterEnabled) {
    set({ openRouterEnabled })
    await api.llm.setConfig({ openRouterEnabled })
    if (!openRouterEnabled && get().provider === 'openrouter') {
      await get().setProvider('lmstudio')
    } else if (get().provider === 'openrouter') {
      await get().refreshModels()
    }
  },

  async setOpenRouterApiKey(apiKey) {
    const openRouterApiKey = normalizeOpenRouterApiKey(apiKey)
    set({ openRouterApiKey })
    await api.llm.setConfig({ openRouterApiKey })
    if ((!openRouterApiKey || !get().openRouterEnabled) && get().provider === 'openrouter') {
      await get().setProvider('lmstudio')
    } else if (get().provider === 'openrouter') {
      await get().refreshModels()
    }
  },

  setOpenRouterModel(openRouterModel) {
    set({ openRouterModel })
    void api.llm.setConfig({ openRouterModel })
    get().persistWorkspaceLlm()
  },

  async setCodexPath(path) {
    set({ codexPath: path })
    await api.llm.setConfig({ codexPath: path })
    await get().checkCodex()
  },

  setCodexModel(codexModel) {
    set({ codexModel })
    void api.llm.setConfig({ codexModel })
    get().persistWorkspaceLlm()
  },

  setCodexSandbox(codexSandbox) {
    set({ codexSandbox })
    void api.llm.setConfig({ codexSandbox })
    get().persistWorkspaceLlm()
  },

  setCodexReasoning(codexReasoning) {
    set({ codexReasoning })
    void api.llm.setConfig({ codexReasoning })
    get().persistWorkspaceLlm()
  },

  async checkCodex() {
    set({ codexChecking: true })
    try {
      const res = await api.codex.check()
      set({ codexCheck: res, codexChecking: false })
      if (res.installed && res.loggedIn) void get().refreshCodexUsage()
    } catch (err) {
      set({
        codexCheck: { ok: false, installed: false, error: err instanceof Error ? err.message : String(err) },
        codexChecking: false
      })
    }
  },

  async refreshCodexUsage() {
    try {
      const res = await api.codex.usage()
      set({ codexUsage: res })
    } catch (err) {
      set({
        codexUsage: { ok: false, loggedIn: false, windows: [], error: err instanceof Error ? err.message : String(err) }
      })
    }
  },

  async setCopilotPath(path) {
    set({ copilotPath: path })
    await api.llm.setConfig({ copilotPath: path })
    await get().checkCopilot()
  },

  setCopilotModel(copilotModel) {
    set({ copilotModel })
    void api.llm.setConfig({ copilotModel })
    get().persistWorkspaceLlm()
  },

  setCopilotPermission(copilotPermission) {
    set({ copilotPermission })
    void api.llm.setConfig({ copilotPermission })
    get().persistWorkspaceLlm()
  },

  setCopilotReasoning(copilotReasoning) {
    set({ copilotReasoning })
    void api.llm.setConfig({ copilotReasoning })
    get().persistWorkspaceLlm()
  },

  async checkCopilot(verifyAuth = false) {
    set({ copilotChecking: true })
    try {
      const res = await api.copilot.check(verifyAuth)
      set({ copilotCheck: res, copilotChecking: false })
    } catch (err) {
      set({
        copilotCheck: { ok: false, installed: false, error: err instanceof Error ? err.message : String(err) },
        copilotChecking: false
      })
    }
  },

  setCopilotAuthOpen(open) {
    set({ copilotAuthOpen: open })
  },

  async setClaudePath(path) {
    set({ claudePath: path })
    await api.llm.setConfig({ claudePath: path })
    await get().checkClaude()
  },

  setClaudeModel(claudeModel) {
    set({ claudeModel })
    void api.llm.setConfig({ claudeModel })
    get().persistWorkspaceLlm()
  },

  setClaudePermission(claudePermission) {
    set({ claudePermission })
    void api.llm.setConfig({ claudePermission })
    get().persistWorkspaceLlm()
  },

  async checkClaude() {
    set({ claudeChecking: true })
    try {
      const res = await api.claude.check()
      set({ claudeCheck: res, claudeChecking: false })
      // Pull subscription usage once we know Claude Code is installed/signed in.
      if (res.installed) void get().refreshClaudeUsage()
    } catch (err) {
      set({
        claudeCheck: { ok: false, installed: false, error: err instanceof Error ? err.message : String(err) },
        claudeChecking: false
      })
    }
  },

  async refreshClaudeUsage() {
    try {
      const res = await api.claude.usage()
      set({ claudeUsage: res })
    } catch (err) {
      set({
        claudeUsage: { ok: false, loggedIn: false, windows: [], error: err instanceof Error ? err.message : String(err) }
      })
    }
  },

  async setGeminiPath(path) {
    set({ geminiPath: path })
    await api.llm.setConfig({ geminiPath: path })
    await get().checkGemini()
  },

  setGeminiModel(geminiModel) {
    set({ geminiModel })
    void api.llm.setConfig({ geminiModel })
    get().persistWorkspaceLlm()
  },

  setGeminiPermission(geminiPermission) {
    set({ geminiPermission })
    void api.llm.setConfig({ geminiPermission })
    get().persistWorkspaceLlm()
  },

  async checkGemini() {
    set({ geminiChecking: true })
    try {
      const res = await api.gemini.check()
      set({ geminiCheck: res, geminiChecking: false })
    } catch (err) {
      set({
        geminiCheck: { ok: false, installed: false, error: err instanceof Error ? err.message : String(err) },
        geminiChecking: false
      })
    }
  },

  async setGlmPath(path) {
    set({ glmPath: path })
    await api.llm.setConfig({ glmPath: path })
    await get().checkGlm()
  },

  setGlmMode(glmMode) {
    set({ glmMode })
    void api.llm.setConfig({ glmMode })
    get().persistWorkspaceLlm()
  },

  async checkGlm() {
    set({ glmChecking: true })
    try {
      const res = await api.glm.check()
      set({ glmCheck: res, glmChecking: false })
    } catch (err) {
      set({
        glmCheck: { ok: false, installed: false, error: err instanceof Error ? err.message : String(err) },
        glmChecking: false
      })
    }
  },

  async setWProviderService(wproviderService) {
    if (get().wproviderService === wproviderService) return
    set({ wproviderService, wproviderCheck: null })
    await api.llm.setConfig({ wproviderService })
    get().persistWorkspaceLlm()
    if (get().provider === 'wprovider') await get().checkWProvider()
  },

  async checkWProvider(service, opts) {
    // Probe only the selected service, not every one — each check drives a
    // hidden browser, so looping all of them made switching chats/services
    // needlessly re-verify (and always hit Qwen first). Results accumulate in
    // `wproviderChecks` so the composer picker can still grey out signed-out ones.
    const target = service ?? get().wproviderService
    const cached = get().wproviderChecks[target]
    // Reuse a prior result on ordinary provider/chat switches so we don't
    // re-drive the browser every time. Sign-in and the explicit Re-check
    // button pass { force } to refresh.
    if (!opts?.force && cached) {
      if (get().wproviderService === target) set({ wproviderCheck: cached })
      return
    }
    set({ wproviderChecking: true })
    const result = await api.wprovider.check(target).catch(
      (err): WProviderCheckResult => ({
        ok: false,
        service: target,
        loggedIn: false,
        error: err instanceof Error ? err.message : String(err)
      })
    )
    set((s) => ({
      wproviderChecks: { ...s.wproviderChecks, [target]: result },
      wproviderCheck: get().wproviderService === target ? result : s.wproviderCheck,
      wproviderChecking: false
    }))
  },

  async wproviderLogin() {
    if (get().wproviderLoggingIn) return
    set({ wproviderLoggingIn: true })
    try {
      await api.wprovider.login()
    } finally {
      set({ wproviderLoggingIn: false })
    }
    await get().checkWProvider(undefined, { force: true })
  },

  async wproviderLogout() {
    set({ wproviderChecking: true })
    const res = await api.wprovider.logout().catch(() => null)
    set((s) => ({
      wproviderCheck: res,
      wproviderChecks: res ? { ...s.wproviderChecks, [res.service]: res } : s.wproviderChecks,
      wproviderChecking: false
    }))
  },

  persistWorkspaceLlm() {
    const snapshot = snapshotLlm(get())
    const id = get().active?.id
    if (id) {
      const workspaceLlm = { ...get().workspaceLlm, [id]: snapshot }
      set({ workspaceLlm })
      void api.settings.set('workspace.llm', workspaceLlm)
    }
    // Also pin the selection to the open chat so each chat keeps its own model.
    const taskId = get().activeTaskId
    if (taskId) {
      const taskLlm = { ...get().taskLlm, [taskId]: snapshot }
      set({ taskLlm })
      void api.settings.set('task.llm', taskLlm)
    }
  },

  async syncWorkspaceLlm(workspaceId) {
    // No saved choice yet → keep the current selection (it becomes this
    // workspace's pinned choice the first time the user picks a model here).
    await applyLlm(get().workspaceLlm[workspaceId])
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  setUsageOpen(open) {
    set({ usageOpen: open })
    // Pull the freshest numbers each time the breakdown is opened.
    if (open) {
      const provider = get().provider
      if (provider === 'codex') void get().refreshCodexUsage()
      else if (provider === 'claude') void get().refreshClaudeUsage()
    }
  },

  setThemePreference(themePreference) {
    const resolvedTheme = applyTheme(themePreference)
    set({ themePreference, resolvedTheme })
    void api.settings.set('appearance.theme', themePreference)
  },

  setAppLanguage(appLanguage) {
    applyLanguage(appLanguage)
    set({ appLanguage })
    void api.settings.set('appearance.language', appLanguage)
  },

  syncSystemTheme() {
    const { themePreference, resolvedTheme } = get()
    if (themePreference !== 'system') return
    const next = applyTheme(themePreference)
    if (next !== resolvedTheme) set({ resolvedTheme: next })
  },

  toggleSidebar() {
    set((s) => {
      const sidebarCollapsed = !s.sidebarCollapsed
      void api.settings.set('sidebar.collapsed', sidebarCollapsed)
      return { sidebarCollapsed }
    })
  },

  setSkillsOpen(open) {
    set({ skillsOpen: open })
  },

  toggleSkill(id) {
    set((s) => {
      const skills = s.skills.map((sk) => (sk.id === id ? { ...sk, enabled: !sk.enabled } : sk))
      void api.settings.set('skills', skills)
      return { skills }
    })
  },

  addSkill() {
    const id = crypto.randomUUID()
    set((s) => {
      const skills = [
        ...s.skills,
        { id, name: 'New skill', description: '', instructions: '', enabled: true }
      ]
      void api.settings.set('skills', skills)
      return { skills }
    })
    return id
  },

  updateSkill(id, patch) {
    set((s) => {
      const skills = s.skills.map((sk) => (sk.id === id ? { ...sk, ...patch } : sk))
      void api.settings.set('skills', skills)
      return { skills }
    })
  },

  deleteSkill(id) {
    set((s) => {
      const skills = s.skills.filter((sk) => sk.id !== id)
      void api.settings.set('skills', skills)
      return { skills }
    })
  },

  setMode(mode) {
    set({ mode })
  },

  async submitTask(text) {
    const trimmed = text.trim()
    const active = get().active
    if (!trimmed || !active || get().streaming) return
    const root = active.path
    const workspaceId = active.id
    const workspaceName = active.name
    const taskId = get().activeTaskId ?? crypto.randomUUID()
    const title = get().activeTaskTitle || taskTitle(trimmed)
    let finalStatus: TaskSummary['status'] = 'idle'

    abortedRuns.delete(taskId)
    // Capture the whole backend selection up front so switching the foreground
    // model or workspace while this run is in flight never changes it mid-task.
    const provider = get().provider
    const sshId = get().activeSsh
    const mode = get().mode
    const lmModel = get().model
    const ollamaModel = get().ollamaModel
    const orModel = get().openRouterModel
    const codexModel = get().codexModel
    const codexSandbox = get().codexSandbox
    const codexReasoning = get().codexReasoning
    const copilotModel = get().copilotModel
    const copilotPermission = get().copilotPermission
    const copilotReasoning = get().copilotReasoning
    const claudeModel = get().claudeModel
    const claudePermission = get().claudePermission
    const geminiModel = get().geminiModel
    const geminiPermission = get().geminiPermission
    const glmMode = get().glmMode
    const wproviderService = get().wproviderService
    const sshConn = get().sshConnections.find((c) => c.id === sshId)
    const sshHost = sshConn ? `${sshConn.username}@${sshConn.host}` : undefined
    runProviders.set(taskId, provider)
    // Model name stamped on this turn's assistant messages (captured now so a
    // later model switch leaves these messages labelled with their real model).
    const assistantModel = modelLabel(get())
    // Enabled skills injected into the agent (system prompt for LM Studio; once
    // per CLI session, since those keep their own server-side context).
    const skillsBlock = skillsToPrompt(get().skills)
    // Cumulative streamed output length → live token estimate for the Thinking… badge.
    let streamedChars = 0
    const aborted = (): boolean => abortedRuns.has(taskId)
    // Every run-state write routes to THIS task — whether it's the foreground
    // task or stashed in the background — so the loop keeps updating its own
    // task even after the user switches workspace and starts another.
    const patch = (id: string, p: Partial<ChatMessage>): void =>
      writeRun(taskId, (r) => ({ messages: r.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }))
    const addMsg = (m: ChatMessage): void =>
      writeRun(taskId, (r) => ({ messages: [...r.messages, m] }))
    const removeMsg = (id: string): void =>
      writeRun(taskId, (r) => ({ messages: r.messages.filter((m) => m.id !== id) }))
    const pushConvo = (m: LlmMessage): void =>
      writeRun(taskId, (r) => ({ convo: [...r.convo, m] }))

    set((s) => ({
      view: 'workspace',
      streaming: true,
      thinking: true,
      thinkingTokens: 0,
      thinkingStartedAt: Date.now(),
      activeTaskId: taskId,
      activeTaskTitle: title,
      messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', kind: 'text', text: trimmed }],
      convo: [...s.convo, { role: 'user', content: trimmed }]
    }))
    // Pin the composer selection to this chat now that it has an id (a brand-new
    // chat had no task to persist against until this first submit).
    get().persistWorkspaceLlm()
    await get().saveTaskRun(taskId, 'running')

    try {
      const agentProvider = provider
      if (sshId && !isSshCapableProvider(agentProvider)) {
        finalStatus = 'error'
        addMsg({
          id: crypto.randomUUID(),
          role: 'assistant',
          kind: 'text',
          model: assistantModel,
          text:
            "⚠ can't work from ssh. " +
            'Switch the provider to LM Studio or Ascora WProvider to work over SSH, or pick a local workspace.'
        })
        return
      }
      // ===== Codex / Copilot / Claude / GLM CLI backends: delegate the turn to the agent CLI =====
      if (
        agentProvider === 'codex' ||
        agentProvider === 'copilot' ||
        agentProvider === 'claude' ||
        agentProvider === 'gemini' ||
        agentProvider === 'glm'
      ) {
        const isCodex = agentProvider === 'codex'
        const isCopilot = agentProvider === 'copilot'
        const isClaude = agentProvider === 'claude'
        const isGemini = agentProvider === 'gemini'
        const isGlm = agentProvider === 'glm'
        let glmCaptcha: { captchaVerifyParam?: string; captchaRegion?: string } = {}
        if (isGlm) {
          try {
            const captcha = await api.glm.captchaConfig()
            if (captcha.error) throw new Error(captcha.error)
            if (captcha.required) {
              if (!captcha.config) throw new Error('ZCode CAPTCHA configuration is missing')
              glmCaptcha = {
                captchaVerifyParam: await solveZCodeCaptcha(captcha.config),
                captchaRegion: captcha.config.region
              }
            }
          } catch (err) {
            finalStatus = 'error'
            addMsg({
              id: crypto.randomUUID(),
              role: 'assistant',
              kind: 'text',
              model: assistantModel,
              text: `⚠ ${err instanceof Error ? err.message : String(err)}`
            })
            return
          }
        }
        const hadCopilotSession = Boolean(readRun(taskId)?.copilotSessionId)
        const copilotRunSessionId = readRun(taskId)?.copilotSessionId ?? taskId
        if (isCopilot) writeRun(taskId, { copilotSessionId: copilotRunSessionId })
        const setSession = (threadId: string): void =>
          writeRun(
            taskId,
            isGlm
              ? { glmSessionId: threadId }
              : isClaude
                ? { claudeSessionId: threadId }
                : isGemini
                  ? { geminiSessionId: threadId }
                  : isCopilot
                    ? { copilotSessionId: threadId }
                    : { codexThreadId: threadId }
          )
        const runId = crypto.randomUUID()
        writeRun(taskId, { streamId: runId })
        const itemCards = new Map<string, string>() // agent item id → chat card id
        const itemChars = new Map<string, number>() // agent item id → chars already counted
        let sawError = false

        // Grow the live token estimate as generated text arrives (without
        // double-counting an item that streams in via successive updates).
        const countText = (key: string, text: string): void => {
          const prev = itemChars.get(key) ?? 0
          if (text.length <= prev) return
          streamedChars += text.length - prev
          itemChars.set(key, text.length)
          writeRun(taskId, { thinkingTokens: tokensFromChars(streamedChars) })
        }

        const handleEvent = (event: CodexEvent): void => {
          if (aborted()) return
          if (event.kind === 'thread') {
            if (event.threadId) setSession(event.threadId)
          } else if (event.kind === 'item') {
            const it = event.item
            if (it.type === 'reasoning') {
              const text = (it.text ?? '').trim()
              if (!text) return
              countText(it.id, text)
              const existingId = itemCards.get(it.id)
              if (existingId) patch(existingId, { text })
              else {
                const cardId = crypto.randomUUID()
                itemCards.set(it.id, cardId)
                addMsg({ id: cardId, role: 'assistant', kind: 'text', reasoning: true, text })
              }
              return
            }
            if (it.type === 'agent_message') {
              if (event.phase === 'completed' && it.text?.trim()) {
                countText(it.id, it.text.trim())
                addMsg({ id: crypto.randomUUID(), role: 'assistant', kind: 'text', model: assistantModel, text: it.text.trim() })
              }
              return
            }
            const card = codexItemToCard(it)
            const existingId = itemCards.get(it.id)
            if (existingId) patch(existingId, card)
            else {
              const cardId = crypto.randomUUID()
              itemCards.set(it.id, cardId)
              addMsg({ id: cardId, role: 'assistant', kind: 'tool', text: '', ...card })
            }
          } else if (event.kind === 'error') {
            sawError = true
            addMsg({ id: crypto.randomUUID(), role: 'assistant', kind: 'text', model: assistantModel, text: `⚠ ${event.message}` })
          }
        }

        // Prepend the enabled skills only when starting a fresh CLI session;
        // a resumed session already carries them from its first turn.
        const skillsPrompt = (hasSession: boolean): string =>
          !hasSession && skillsBlock ? `${skillsBlock}\n\n${trimmed}` : trimmed

        const res = isGemini
          ? await api.gemini.run(
              runId,
              {
                prompt: skillsPrompt(!!readRun(taskId)?.geminiSessionId),
                cwd: root,
                sessionId: readRun(taskId)?.geminiSessionId ?? undefined,
                model: geminiModel || undefined,
                permission: geminiPermission
              },
              handleEvent
            )
          : isGlm
            ? await api.glm.run(
                runId,
                {
                  prompt: skillsPrompt(!!readRun(taskId)?.glmSessionId),
                  cwd: root,
                  sessionId: readRun(taskId)?.glmSessionId ?? undefined,
                  mode: glmMode,
                  ...glmCaptcha
                },
                handleEvent
              )
            : isClaude
              ? await api.claude.run(
                  runId,
                  {
                    prompt: skillsPrompt(!!readRun(taskId)?.claudeSessionId),
                    cwd: root,
                    sessionId: readRun(taskId)?.claudeSessionId ?? undefined,
                    model: claudeModel || undefined,
                    permission: claudePermission
                  },
                  handleEvent
                )
              : isCopilot
                ? await api.copilot.run(
                    runId,
                    {
                      prompt: skillsPrompt(hadCopilotSession),
                      cwd: root,
                      sessionId: copilotRunSessionId,
                      model: copilotModel || undefined,
                      permission: copilotPermission,
                      reasoning: copilotReasoning || undefined
                    },
                    handleEvent
                  )
                : await api.codex.run(
                    runId,
                    {
                      prompt: skillsPrompt(!!readRun(taskId)?.codexThreadId),
                      cwd: root,
                      threadId: readRun(taskId)?.codexThreadId ?? undefined,
                      model: codexModel || undefined,
                      sandbox: codexSandbox,
                      reasoning: codexReasoning || undefined
                    },
                    handleEvent
                  )

        writeRun(taskId, { streamId: null, thinking: false })
        if (res.threadId) setSession(res.threadId)
        // A CLI-agent turn just consumed quota; refresh the active usage indicator.
        if (isCodex) void get().refreshCodexUsage()
        if (isClaude) void get().refreshClaudeUsage()

        // Record usage for the dashboard (real token counts when reported).
        {
          const usage = res.usage ?? { inputTokens: estTokens(trimmed), outputTokens: 0 }
          void api.analytics.record({
            workspaceId,
            workspaceName,
            taskId,
            provider: agentProvider,
            model: isGlm
              ? 'glm'
              : isClaude
                ? claudeModel && claudeModel !== 'default'
                  ? claudeModel
                  : 'claude'
                : isGemini
                  ? geminiModel || 'gemini'
                : isCopilot
                  ? copilotModel || 'copilot'
                  : codexModel || 'codex',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            userMessages: 1,
            assistantMessages: 1,
            estimated: !res.usage
          })
        }

        if (!res.ok && !res.aborted) {
          finalStatus = 'error'
          addMsg({
            id: crypto.randomUUID(),
            role: 'assistant',
            kind: 'text',
            model: assistantModel,
            text: `⚠ ${
              res.error ??
              (isGlm
                ? 'ZCode run failed.'
                : isClaude
                  ? 'Claude run failed.'
                  : isGemini
                    ? 'Gemini run failed.'
                    : isCopilot
                      ? 'Copilot run failed.'
                      : 'Codex run failed.')
            }`
          })
        } else if (sawError) {
          finalStatus = 'error'
        }
        return // skip the local OpenAI-compatible loop; finally still resets state + saves
      }

      const isOpenRouter = agentProvider === 'openrouter'
      const isOllama = agentProvider === 'ollama'
      const isWProvider = agentProvider === 'wprovider'
      for (let step = 0; step < MAX_STEPS && !aborted(); step += 1) {
        // 1) Stream one model turn into a fresh assistant bubble.
        const replyId = crypto.randomUUID()
        addMsg({ id: replyId, role: 'assistant', kind: 'text', model: assistantModel, text: '' })
        writeRun(taskId, { streamId: replyId, thinking: true })
        const base = buildSystemPrompt(sshHost, sshHost ? root : undefined)
        // Web chats have no native function calling — pin the model to the
        // text tool protocol so every tool request arrives as a parseable block.
        const wpNote = isWProvider
          ? '\n\nIMPORTANT: In this environment you CANNOT emit native/structured tool calls. ' +
            'To use a tool, reply with ONLY one fenced ```tool_call block in the exact format above — ' +
            'no prose before or after it. Reply in plain prose (no tool_call block) only when the task is fully done.'
          : ''
        const systemPrompt = (skillsBlock ? `${base}\n\n${skillsBlock}` : base) + wpNote
        const messages: LlmMessage[] = [
          { role: 'system', content: systemPrompt },
          ...(readRun(taskId)?.convo ?? [])
        ]
        const onDelta = (delta: string): void => {
          streamedChars += delta.length
          writeRun(taskId, (r) => ({
            thinkingTokens: tokensFromChars(streamedChars),
            messages: r.messages.map((m) => (m.id === replyId ? { ...m, text: m.text + delta } : m))
          }))
        }
        // WProvider relays the turn through the provider's web chat in a hidden
        // browser (the site keeps its own history, so only new messages travel).
        // The chat request id doubles as this bubble's id so stopStreaming's
        // abort (which sends streamId) reaches the right in-flight turn.
        const result = isWProvider
          ? await api.wprovider.chat(
              replyId,
              { sessionKey: taskId, service: wproviderService, messages },
              onDelta
            )
          : await api.llm.chat(
              crypto.randomUUID(),
              { model: isOpenRouter ? orModel : isOllama ? ollamaModel : lmModel, messages, tools: TOOLS },
              onDelta
            )
        writeRun(taskId, { streamId: null, thinking: false })
        if (result.aborted || aborted()) {
          const partial = readRun(taskId)?.messages.find((message) => message.id === replyId)?.text ?? ''
          if (!partial.trim()) removeMsg(replyId)
          break
        }
        // The connection indicator only reflects the foreground backend.
        if (get().activeTaskId === taskId) {
          set({ connection: result.ok ? 'connected' : get().connection })
        }

        if (!result.ok) {
          finalStatus = 'error'
          const prev = readRun(taskId)?.messages.find((m) => m.id === replyId)?.text ?? ''
          patch(replyId, { text: prev ? `${prev}\n\n⚠ ${result.error}` : `⚠ ${result.error}` })
          break
        }

        // Record usage for the dashboard (real tokens when the server reports them).
        {
          const usage = result.usage ?? {
            inputTokens: estTokens(messages.map((m) => m.content).join('\n')),
            outputTokens: estTokens(result.content)
          }
          void api.analytics.record({
            workspaceId,
            workspaceName,
            taskId,
            provider: isWProvider ? 'wprovider' : isOpenRouter ? 'openrouter' : isOllama ? 'ollama' : 'lmstudio',
            model: isWProvider
              ? `${wproviderService}-web`
              : isOpenRouter
                ? orModel || 'openrouter/free'
                : isOllama
                  ? ollamaModel || 'ollama'
                  : lmModel || 'local-model',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            userMessages: step === 0 ? 1 : 0,
            assistantMessages: 1,
            estimated: !result.usage
          })
        }

        // 2) Resolve tool calls — native first, then the text fallback.
        const native = !!(result.toolCalls && result.toolCalls.length > 0)
        let calls: ParsedCall[] = []
        let displayText = result.content

        if (native) {
          calls = result.toolCalls!.map((c, i) => ({
            id: c.id || `call_${step}_${i}`,
            name: c.name,
            args: safeArgs(c.arguments)
          }))
          pushConvo({
            role: 'assistant',
            content: result.content,
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args) }
            }))
          })
        } else {
          const parsed = parseTextToolCall(result.content)
          if (parsed) {
            calls = [parsed.call]
            displayText = result.content.replace(parsed.block, '').trim()
          }
          pushConvo({ role: 'assistant', content: result.content })
        }

        // Tidy the bubble: keep prose, drop it if the turn was tool-only.
        if (displayText.trim()) patch(replyId, { text: displayText.trim() })
        else if (calls.length > 0) removeMsg(replyId)
        else patch(replyId, { text: '_(no content returned)_' })

        if (calls.length === 0) break // final answer — done

        const appendResult = (call: ParsedCall, content: string): void =>
          pushConvo(
            native
              ? { role: 'tool', tool_call_id: call.id, content }
              : { role: 'user', content: `Tool result (${call.name}):\n${content}` }
          )

        // 3) Execute each requested tool.
        for (const call of calls) {
          if (aborted()) break

          if (!isToolName(call.name)) {
            const note = `Unknown tool: ${call.name}`
            addMsg({
              id: crypto.randomUUID(), role: 'assistant', kind: 'tool',
              tool: call.name, args: call.args, status: 'error', error: note, text: ''
            })
            appendResult(call, `Error: ${note}`)
            continue
          }

          const cardId = crypto.randomUUID()
          const mutating =
            call.name === 'write_file' || call.name === 'edit_file' || call.name === 'run_command'
          // The SSH target (if any) was captured for this run at submit time.

          // For file changes, read the current file first so the card can show a diff.
          let oldContent = ''
          let newContent = ''
          if ((call.name === 'write_file' || call.name === 'edit_file') && asStr(call.args.path)) {
            const cur = sshId
              ? await sshReadFile(sshId, asStr(call.args.path), undefined, root)
              : await api.agent.readFile(root, asStr(call.args.path))
            oldContent = cur.ok && !cur.truncated ? (cur.content ?? '') : ''
          }
          if (call.name === 'write_file') {
            newContent = asStr(call.args.content)
          } else if (call.name === 'edit_file') {
            const preview = applyEdit(
              oldContent,
              asStr(call.args.old_string),
              asStr(call.args.new_string),
              call.args.replace_all === true
            )
            newContent = preview.ok ? preview.content : oldContent
          }

          const isEdit = call.name === 'write_file' || call.name === 'edit_file'
          const stat = isEdit ? diffStat(oldContent, newContent) : null
          const needsApproval = mutating && mode === 'ask'
          addMsg({
            id: cardId, role: 'assistant', kind: 'tool', text: '',
            tool: call.name, args: call.args,
            status: needsApproval ? 'awaiting' : 'running',
            ...(isEdit && stat
              ? { oldContent, newContent, addedLines: stat.added, removedLines: stat.removed }
              : {})
          })

          if (needsApproval) {
            const approved = await new Promise<boolean>((resolve) =>
              pendingApprovals.set(cardId, { taskId, resolve })
            )
            pendingApprovals.delete(cardId)
            if (!approved) {
              patch(cardId, { status: 'rejected' })
              appendResult(
                call,
                'The user rejected this action. Do not retry it; suggest an alternative or ask how to proceed.'
              )
              continue
            }
            patch(cardId, { status: 'running' })
          }

          if (aborted()) {
            patch(cardId, { status: 'rejected' })
            break
          }

          // 4) Run the tool and record the outcome on the card + transcript.
          if (call.name === 'list_dir') {
            const r = sshId
              ? await sshListDir(sshId, asStr(call.args.path) || '.', root)
              : await api.agent.listDir(root, asStr(call.args.path) || '.')
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.ok ? `${r.entries?.length ?? 0} entries` : undefined,
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? `Directory ${r.path}:\n${(r.entries ?? [])
                    .map((e) => (e.type === 'directory' ? `${e.name}/` : e.name))
                    .join('\n') || '(empty)'}`
                : `Error: ${r.error}`
            )
          } else if (call.name === 'read_file') {
            const startLine = asLine(call.args.start_line)
            const endLine = asLine(call.args.end_line)
            const range = startLine || endLine ? { startLine, endLine } : undefined
            const r = sshId
              ? await sshReadFile(sshId, asStr(call.args.path), range, root)
              : await api.agent.readFile(root, asStr(call.args.path), range)
            const ranged = r.ok && r.startLine != null && r.endLine != null
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.ok
                ? r.truncated
                  ? 'binary or too large'
                  : ranged
                    ? `lines ${r.startLine}-${r.endLine} of ${r.totalLines}`
                    : `${r.totalLines ?? (r.content ?? '').split('\n').length} lines`
                : undefined,
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? r.truncated
                  ? `(${r.path} is binary or too large to read)`
                  : ranged
                    ? `Contents of ${r.path} (lines ${r.startLine}-${r.endLine} of ${r.totalLines}):\n${r.content}`
                    : `Contents of ${r.path}:\n${r.content}`
                : `Error: ${r.error}`
            )
          } else if (call.name === 'search_files') {
            const opts = searchOptionsFromArgs(call.args)
            const r = sshId
              ? await sshSearch(sshId, asStr(call.args.query), opts, root)
              : await api.agent.search(root, asStr(call.args.query), opts)
            const hits = r.matches ?? []
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.ok
                ? hits.length
                  ? hits.map(formatMatch).join('\n')
                  : 'No matches.'
                : undefined,
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? hits.length
                  ? `${hits.length}${r.truncated ? '+' : ''} match(es) for "${asStr(call.args.query)}":\n` +
                    hits.map(formatMatch).join('\n') +
                    (r.truncated ? '\n…(more matches truncated)' : '')
                  : `No matches for "${asStr(call.args.query)}".`
                : `Error: ${r.error}`
            )
          } else if (call.name === 'edit_file') {
            const path = asStr(call.args.path)
            const r = sshId
              ? await sshEditFile(
                  sshId,
                  path,
                  asStr(call.args.old_string),
                  asStr(call.args.new_string),
                  call.args.replace_all === true,
                  root
                )
              : await api.agent.editFile(
                  root,
                  path,
                  asStr(call.args.old_string),
                  asStr(call.args.new_string),
                  call.args.replace_all === true
                )
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              ...(r.ok
                ? {
                    changes: [
                      {
                        path: r.path ?? path,
                        kind: 'update',
                        added: stat?.added ?? 0,
                        removed: stat?.removed ?? 0
                      }
                    ]
                  }
                : {}),
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? `Edited ${r.path} (${r.replacements} replacement${r.replacements === 1 ? '' : 's'}).`
                : `Error: ${r.error}`
            )
          } else if (call.name === 'write_file') {
            const path = asStr(call.args.path)
            const r = sshId
              ? await sshWriteFile(sshId, path, asStr(call.args.content), root)
              : await api.agent.writeFile(root, path, asStr(call.args.content))
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              created: r.created,
              ...(r.ok
                ? {
                    changes: [
                      {
                        path: r.path ?? path,
                        kind: r.created ? 'add' : 'update',
                        added: stat?.added ?? 0,
                        removed: stat?.removed ?? 0
                      }
                    ]
                  }
                : {}),
              error: r.error
            })
            appendResult(
              call,
              r.ok ? `${r.created ? 'Created' : 'Updated'} ${r.path} (${r.bytes} bytes).` : `Error: ${r.error}`
            )
          } else if (call.name === 'web_fetch') {
            const url = asStr(call.args.url)
            const r = await api.web.fetch(url, asCount(call.args.max_chars))
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.ok
                ? `${r.title ? `${r.title} — ` : ''}${(r.content ?? '').length} chars${r.truncated ? ' (truncated)' : ''}`
                : undefined,
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? `Fetched ${r.url}${r.title ? `\nTitle: ${r.title}` : ''}\n\n${r.content ?? ''}` +
                  (r.truncated ? '\n…(content truncated)' : '')
                : `Error: ${r.error}`
            )
          } else if (call.name === 'web_search') {
            const query = asStr(call.args.query)
            const r = await api.web.search(query)
            const items = r.results ?? []
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.ok
                ? items.length
                  ? items.map((it) => `${it.title}\n${it.url}`).join('\n\n')
                  : 'No results.'
                : undefined,
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? items.length
                  ? `Web results for "${query}":\n` +
                    items
                      .map((it, i) => `${i + 1}. ${it.title}\n   ${it.url}${it.snippet ? `\n   ${it.snippet}` : ''}`)
                      .join('\n')
                  : `No web results for "${query}".`
                : `Error: ${r.error}`
            )
          } else {
            const command = asStr(call.args.command)
            // When an SSH session is open, type the command into the visible
            // remote console; otherwise run locally (Workspaces — unchanged).
            const r = sshId
              ? await api.ssh.run(sshId, command)
              : await api.agent.runCommand(root, command)
            const timedOut = 'timedOut' in r ? r.timedOut === true : false
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.stdout,
              stderr: r.stderr,
              exitCode: timedOut ? null : r.code,
              error: r.error
            })
            const where = sshId ? ' (remote)' : ''
            const head = timedOut ? 'Exit: killed (timeout)' : `Exit code: ${r.code}${where}`
            const body = [head]
            if (r.stdout?.trim()) body.push(`stdout:\n${r.stdout}`)
            if (r.stderr?.trim()) body.push(`stderr:\n${r.stderr}`)
            appendResult(call, r.ok ? truncate(body.join('\n'), 16000) : `Error: ${r.error}`)
          }
        }
      }

      if (!aborted() && (readRun(taskId)?.convo.length ?? 0) > 0) {
        // Surface a hint if we bailed out at the step cap mid-task.
        const last = readRun(taskId)?.messages.at(-1)
        if (last?.kind === 'tool') {
          addMsg({
            id: crypto.randomUUID(), role: 'assistant', kind: 'text', model: assistantModel,
            text: '_Reached the tool-step limit for this task._'
          })
        }
      }
    } finally {
      writeRun(taskId, { streaming: false, streamId: null, thinking: false, thinkingStartedAt: null })
      await get().saveTaskRun(taskId, finalStatus)
      abortedRuns.delete(taskId)
      runProviders.delete(taskId)
      deletedRuns.delete(taskId)
      // A finished background run no longer needs its snapshot; reopening it
      // loads the freshly-saved history from disk.
      if (get().activeTaskId !== taskId) {
        set((s) => {
          const runs = { ...s.runs }
          delete runs[taskId]
          return { runs }
        })
      }
    }
  },

  approveTool(id) {
    const entry = pendingApprovals.get(id)
    if (entry) {
      pendingApprovals.delete(id)
      entry.resolve(true)
    }
  },

  rejectTool(id) {
    const entry = pendingApprovals.get(id)
    if (entry) {
      pendingApprovals.delete(id)
      entry.resolve(false)
    }
  },

  stopStreaming(taskId) {
    const id = taskId ?? get().activeTaskId
    if (!id) return
    abortedRuns.add(id)
    writeRun(id, { thinking: false })
    const streamId = readRun(id)?.streamId
    if (streamId) {
      const p = runProviders.get(id) ?? get().provider
      if (p === 'codex') void api.codex.abort(streamId)
      else if (p === 'copilot') void api.copilot.abort(streamId)
      else if (p === 'claude') void api.claude.abort(streamId)
      else if (p === 'gemini') void api.gemini.abort(streamId)
      else if (p === 'glm') void api.glm.abort(streamId)
      else if (p === 'wprovider') void api.wprovider.abort(streamId)
      else void api.llm.abort(streamId)
    }
    // Reject only this run's pending Ask-mode approvals.
    for (const [cardId, entry] of pendingApprovals) {
      if (entry.taskId === id) {
        pendingApprovals.delete(cardId)
        entry.resolve(false)
      }
    }
  },

  newTask() {
    // Keep any running task alive in the background, then open a blank composer.
    stashAndDetach()
    set({
      messages: [],
      convo: [],
      activeTaskId: null,
      activeTaskTitle: '',
      streaming: false,
      streamId: null,
      thinking: false,
      thinkingTokens: 0,
      thinkingStartedAt: null,
      codexThreadId: null,
      copilotSessionId: null,
      claudeSessionId: null,
      geminiSessionId: null,
      glmSessionId: null,
      view: 'home'
    })
  }
  }
})
