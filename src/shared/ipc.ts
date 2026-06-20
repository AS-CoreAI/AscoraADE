/**
 * Shared IPC contract between the Electron main process and the renderer.
 *
 * Channel names live here so main handlers, the preload bridge, and the
 * renderer API wrapper can never drift out of sync. Payload/result types are
 * declared alongside so the whole bridge is type-checked end to end.
 */

export const IPC = {
  window: {
    minimize: 'window:minimize',
    maximizeToggle: 'window:maximizeToggle',
    close: 'window:close',
    isMaximized: 'window:isMaximized'
  },
  dialog: {
    openFolder: 'dialog:openFolder'
  },
  fs: {
    readTree: 'fs:readTree',
    readFile: 'fs:readFile'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    all: 'settings:all'
  },
  workspace: {
    list: 'workspace:list',
    add: 'workspace:add',
    tasks: 'workspace:tasks'
  },
  llm: {
    config: 'llm:config',
    setConfig: 'llm:setConfig',
    listModels: 'llm:listModels',
    chat: 'llm:chat',
    chunk: 'llm:chunk',
    abort: 'llm:abort'
  },
  git: {
    status: 'git:status',
    diff: 'git:diff',
    stage: 'git:stage',
    unstage: 'git:unstage',
    discard: 'git:discard',
    commit: 'git:commit',
    push: 'git:push',
    fetch: 'git:fetch',
    history: 'git:history',
    commitFiles: 'git:commitFiles',
    commitDiff: 'git:commitDiff'
  },
  terminal: {
    start: 'terminal:start',
    input: 'terminal:input',
    kill: 'terminal:kill',
    data: 'terminal:data',
    exit: 'terminal:exit'
  },
  agent: {
    listDir: 'agent:listDir',
    readFile: 'agent:readFile',
    writeFile: 'agent:writeFile',
    runCommand: 'agent:runCommand'
  }
} as const

/** A single node in the project file tree. */
export interface TreeNode {
  name: string
  /** Absolute path on disk. */
  path: string
  type: 'file' | 'directory'
  /** Populated lazily for directories; may be undefined until expanded. */
  children?: TreeNode[]
}

export interface FileContent {
  path: string
  content: string
  /** Monaco language id inferred from the extension. */
  language: string
  /** True when the file looked binary / too large and content was withheld. */
  truncated: boolean
}

/** A project folder the user has opened (mirrors the ZCode "Workspaces" rail). */
export interface Workspace {
  id: string
  name: string
  path: string
  lastOpenedAt: number
}

/** A recorded task/conversation under a workspace. */
export interface TaskSummary {
  id: string
  workspaceId: string
  title: string
  updatedAt: number
  /** Visual status dot in the rail. */
  status: 'idle' | 'running' | 'error'
}

// ---------- LLM (LM Studio, OpenAI-compatible /v1 API) ----------

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool'

/** A native (OpenAI-style) tool call requested by the model. */
export interface ToolCall {
  /** Provider id, echoed back on the matching `tool` message. */
  id: string
  name: string
  /** Raw JSON string of arguments (parsed by the caller). */
  arguments: string
}

export interface LlmMessage {
  role: LlmRole
  content: string
  /** Present on assistant turns that requested native tool calls. */
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  /** Present on `role: 'tool'` results, linking back to the call. */
  tool_call_id?: string
}

/** OpenAI-compatible function/tool definition sent with a chat request. */
export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface LlmModel {
  id: string
}

export interface LlmConfig {
  /** OpenAI-compatible base, e.g. http://localhost:1234/v1 */
  baseUrl: string
  /** Default model id used when a request doesn't specify one. */
  model: string
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'http://localhost:1234/v1',
  model: ''
}

export interface ChatParams {
  model?: string
  messages: LlmMessage[]
  temperature?: number
  /** When set, advertised to the model for native function-calling. */
  tools?: ToolDef[]
}

/** Streaming token delivered from main → renderer during a chat request. */
export interface ChatChunkPayload {
  id: string
  delta: string
}

export interface ChatResult {
  ok: boolean
  content: string
  /** Native tool calls the model asked for, assembled from the stream. */
  toolCalls?: ToolCall[]
  /** OpenAI finish_reason for the turn (e.g. 'stop', 'tool_calls'). */
  finishReason?: string
  error?: string
  aborted?: boolean
}

export interface ListModelsResult {
  ok: boolean
  models?: LlmModel[]
  error?: string
}

// ---------- Git / Source Control ----------

export type GitFileStatus = ' ' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' | 'T'

export interface GitStatusFile {
  /** Repo-relative path using Git's slash separators. */
  path: string
  /** Previous path for renames/copies, when Git reports one. */
  originalPath?: string
  /** Status in the index/staging area. */
  index: GitFileStatus
  /** Status in the working tree. */
  workTree: GitFileStatus
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export interface GitCommitSummary {
  hash: string
  shortHash: string
  subject: string
  author: string
  timestamp: number
}

export interface GitCommitFile {
  path: string
  originalPath?: string
  status: GitFileStatus
}

export interface GitStatusResult {
  ok: boolean
  root?: string
  branch?: string
  upstream?: string
  ahead?: number
  behind?: number
  files?: GitStatusFile[]
  outgoingCommits?: GitCommitSummary[]
  error?: string
}

export interface GitDiffRequest {
  path?: string
  staged?: boolean
}

export interface GitDiffResult {
  ok: boolean
  diff?: string
  error?: string
}

export interface GitHistoryResult {
  ok: boolean
  commits?: GitCommitSummary[]
  error?: string
}

export interface GitCommitFilesResult {
  ok: boolean
  files?: GitCommitFile[]
  error?: string
}

export interface GitCommitDiffRequest {
  commit: string
  path?: string
}

export interface GitActionResult {
  ok: boolean
  output?: string
  error?: string
}

// ---------- Terminal (PTY-less shell over child_process) ----------

/**
 * Which shell the main process spawned. The renderer uses this to pick the
 * one-liner it appends after each command to report the working directory
 * (emitted as an OSC 7 escape that xterm consumes invisibly).
 */
export type TerminalShellKind = 'powershell' | 'posix'

export interface TerminalStartOptions {
  /** Directory to launch the shell in; falls back to the user's home. */
  cwd?: string
}

export interface TerminalStartResult {
  ok: boolean
  pid?: number
  /** Display name of the spawned shell, e.g. "powershell.exe". */
  shell?: string
  kind?: TerminalShellKind
  /** Resolved working directory the shell actually started in. */
  cwd?: string
  error?: string
}

/** Shell stdout/stderr forwarded main → renderer. */
export interface TerminalDataPayload {
  id: string
  data: string
}

/** Emitted main → renderer when the shell process exits. */
export interface TerminalExitPayload {
  id: string
  code: number | null
}

// ---------- Agent tools (sandboxed to the active workspace root) ----------

export interface AgentDirEntry {
  name: string
  type: 'file' | 'directory'
}

export interface AgentListResult {
  ok: boolean
  /** Repo-relative path that was listed. */
  path?: string
  entries?: AgentDirEntry[]
  error?: string
}

export interface AgentReadResult {
  ok: boolean
  path?: string
  content?: string
  /** True when the file was binary/too large and content was withheld. */
  truncated?: boolean
  error?: string
}

export interface AgentWriteResult {
  ok: boolean
  path?: string
  /** True when the file did not exist before this write. */
  created?: boolean
  /** Bytes written. */
  bytes?: number
  error?: string
}

export interface AgentRunResult {
  ok: boolean
  stdout?: string
  stderr?: string
  /** Process exit code; null if killed (e.g. timeout). */
  code?: number | null
  /** True when the command was killed by the timeout. */
  timedOut?: boolean
  error?: string
}

/** Directory names excluded from the project tree and analysis (spec 5.1). */
export const EXCLUDED_DIRS = new Set<string>([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.next',
  'venv',
  '.venv',
  '__pycache__',
  'out',
  '.cache'
])
