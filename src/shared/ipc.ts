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
    tasks: 'workspace:tasks',
    task: 'workspace:task',
    saveTask: 'workspace:saveTask'
  },
  llm: {
    config: 'llm:config',
    setConfig: 'llm:setConfig',
    listModels: 'llm:listModels',
    chat: 'llm:chat',
    chunk: 'llm:chunk',
    abort: 'llm:abort'
  },
  codex: {
    check: 'codex:check',
    run: 'codex:run',
    abort: 'codex:abort',
    event: 'codex:event'
  },
  claude: {
    check: 'claude:check',
    run: 'claude:run',
    abort: 'claude:abort',
    event: 'claude:event'
  },
  analytics: {
    record: 'analytics:record',
    list: 'analytics:list'
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

/** A renderer chat entry persisted as part of a task. */
export interface TaskMessage {
  id: string
  role: 'user' | 'assistant'
  kind: 'text' | 'tool'
  text: string
  tool?: string
  args?: Record<string, unknown>
  status?: 'awaiting' | 'running' | 'done' | 'rejected' | 'error'
  output?: string
  stderr?: string
  exitCode?: number | null
  oldContent?: string
  newContent?: string
  created?: boolean
  error?: string
}

/** Complete persisted task, including display history and LLM context. */
export interface TaskRecord extends TaskSummary {
  messages: TaskMessage[]
  convo: LlmMessage[]
}

// ---------- LLM (provider-agnostic; LM Studio or Codex CLI) ----------

/** Which backend drives the agent chat. */
export type LlmProvider = 'lmstudio' | 'codex' | 'claude'

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

/** Sandbox policy passed to `codex exec -s`. */
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Reasoning effort for Codex models (`-c model_reasoning_effort`). */
export type CodexReasoning = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** Selectable reasoning levels, in ascending order of effort. */
export const CODEX_REASONING_LEVELS: CodexReasoning[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

/** Claude Code permission mode (`claude --permission-mode`). */
export type ClaudePermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** Selectable Claude permission modes, from most to least restrictive. */
export const CLAUDE_PERMISSION_MODES: ClaudePermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions'
]

/** Suggested Claude model aliases (empty → Claude Code's own default). */
export const CLAUDE_MODEL_PRESETS = ['default', 'opus', 'sonnet', 'haiku']

export interface LlmConfig {
  /** Active backend for the agent chat. */
  provider: LlmProvider
  /** OpenAI-compatible base, e.g. http://localhost:1234/v1 (LM Studio). */
  baseUrl: string
  /** Default LM Studio model id used when a request doesn't specify one. */
  model: string
  /** Path to the `codex` binary; empty → auto-detect (PATH / bundled extension). */
  codexPath: string
  /** Model passed to `codex exec -m`; empty → Codex's own default. */
  codexModel: string
  /** Sandbox policy Codex runs commands under. */
  codexSandbox: CodexSandbox
  /** Reasoning effort for Codex; empty → use Codex's own default. */
  codexReasoning: CodexReasoning | ''
  /** Path to the `claude` binary; empty → auto-detect (PATH / bundled extension). */
  claudePath: string
  /** Model passed to `claude --model`; empty → Claude Code's own default. */
  claudeModel: string
  /** Permission mode Claude Code runs under. */
  claudePermission: ClaudePermissionMode
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: 'lmstudio',
  baseUrl: 'http://localhost:1234/v1',
  model: '',
  codexPath: '',
  codexModel: '',
  codexSandbox: 'workspace-write',
  codexReasoning: '',
  claudePath: '',
  claudeModel: '',
  claudePermission: 'acceptEdits'
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

/** Token counts for a single turn, when the backend reports them. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface ChatResult {
  ok: boolean
  content: string
  /** Native tool calls the model asked for, assembled from the stream. */
  toolCalls?: ToolCall[]
  /** OpenAI finish_reason for the turn (e.g. 'stop', 'tool_calls'). */
  finishReason?: string
  /** Token usage for the turn, if the server returned it. */
  usage?: TokenUsage
  error?: string
  aborted?: boolean
}

export interface ListModelsResult {
  ok: boolean
  models?: LlmModel[]
  error?: string
}

// ---------- Codex CLI (OpenAI's `codex exec --json` agent) ----------

/** Result of probing the local Codex CLI install + auth. */
export interface CodexCheckResult {
  ok: boolean
  /** True when a runnable `codex` binary was found. */
  installed: boolean
  /** Resolved path to the binary that was probed. */
  path?: string
  /** e.g. "codex-cli 0.142.0". */
  version?: string
  /** True when `codex login status` reports an authenticated account. */
  loggedIn?: boolean
  /** Human-readable auth note, e.g. "Logged in using ChatGPT". */
  authNote?: string
  error?: string
}

export interface CodexRunParams {
  prompt: string
  /** Working root passed to `codex exec -C`. */
  cwd: string
  /** Resume this Codex session/thread instead of starting a fresh one. */
  threadId?: string
  /** Overrides the configured model (`-m`); empty → config/default. */
  model?: string
  /** Overrides the configured sandbox policy (`-s`). */
  sandbox?: CodexSandbox
  /** Overrides the configured reasoning effort (`-c model_reasoning_effort`). */
  reasoning?: CodexReasoning | ''
}

/**
 * One normalized work item from a Codex turn. Mirrors the `item` object in
 * `codex exec --json` events (`agent_message`, `command_execution`,
 * `file_change`, `reasoning`, …); unknown types pass through via `type`/`text`.
 */
export interface CodexItem {
  id: string
  type: string
  /** agent_message / reasoning prose. */
  text?: string
  /** command_execution: the shell command line. */
  command?: string
  /** command_execution: combined stdout+stderr so far. */
  output?: string
  /** command_execution: exit code (null while running / when killed). */
  exitCode?: number | null
  /** file_change: the files touched and how. */
  changes?: { path: string; kind: string }[]
  /** "in_progress" | "completed" | "failed". */
  status?: string
}

/** Normalized Codex stream event delivered main → renderer. */
export type CodexEvent =
  | { kind: 'thread'; threadId: string }
  | { kind: 'turn-started' }
  | { kind: 'item'; phase: 'started' | 'updated' | 'completed'; item: CodexItem }
  | { kind: 'turn-completed' }
  /** A non-JSON line from Codex (notices, stderr) surfaced for visibility. */
  | { kind: 'notice'; text: string }
  | { kind: 'error'; message: string }

export interface CodexEventPayload {
  id: string
  event: CodexEvent
}

export interface CodexRunResult {
  ok: boolean
  /** Process exit code; null when killed (e.g. aborted). */
  code?: number | null
  /** Session id captured from the run, for a later resume. */
  threadId?: string
  /** Summed token usage across the run's turns, if reported. */
  usage?: TokenUsage
  aborted?: boolean
  error?: string
}

// ---------- Claude Code (`claude -p --output-format stream-json`) ----------
// The Claude backend reuses Codex's normalized CodexEvent / CodexItem /
// CodexRunResult / CodexCheckResult shapes so the renderer drives both with one
// code path (see runClaude, which maps Claude's stream-json onto CodexEvent).

export interface ClaudeRunParams {
  prompt: string
  /** Working root the spawned `claude` runs in. */
  cwd: string
  /** Resume this Claude session instead of starting fresh (`--resume`). */
  sessionId?: string
  /** Overrides the configured model (`--model`); empty → config/default. */
  model?: string
  /** Overrides the configured permission mode (`--permission-mode`). */
  permission?: ClaudePermissionMode
}

// ---------- Usage analytics ----------

/** One recorded model turn, the atom the analytics dashboard aggregates over. */
export interface UsageEvent {
  id: string
  /** When the turn completed (ms epoch). */
  ts: number
  workspaceId: string
  workspaceName: string
  taskId: string
  /** Which backend / "router" served the turn. */
  provider: LlmProvider
  model: string
  inputTokens: number
  outputTokens: number
  /** New user messages attributable to this turn. */
  userMessages: number
  /** New assistant messages attributable to this turn. */
  assistantMessages: number
  /** True when token counts are estimated (server didn't report usage). */
  estimated?: boolean
}

/** Payload to record a usage event; the main process fills in id + ts. */
export type UsageEventInput = Omit<UsageEvent, 'id' | 'ts'> & { ts?: number }

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
