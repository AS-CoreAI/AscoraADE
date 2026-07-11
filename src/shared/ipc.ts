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
    openFolder: 'dialog:openFolder',
    openFiles: 'dialog:openFiles'
  },
  fs: {
    readTree: 'fs:readTree',
    readFile: 'fs:readFile',
    openPath: 'fs:openPath',
    importFiles: 'fs:importFiles',
    movePath: 'fs:movePath',
    renameFile: 'fs:renameFile',
    deleteFile: 'fs:deleteFile',
    createFile: 'fs:createFile',
    createDirectory: 'fs:createDirectory',
    renameDirectory: 'fs:renameDirectory',
    deleteDirectory: 'fs:deleteDirectory'
  },
  live: {
    start: 'live:start',
    stop: 'live:stop',
    openExternal: 'live:openExternal',
    openWindow: 'live:openWindow',
    closeWindow: 'live:closeWindow',
    windowClosed: 'live:windowClosed'
  },
  ssh: {
    connect: 'ssh:connect',
    input: 'ssh:input',
    resize: 'ssh:resize',
    disconnect: 'ssh:disconnect',
    exec: 'ssh:exec',
    run: 'ssh:run',
    setElevation: 'ssh:setElevation',
    pickKey: 'ssh:pickKey',
    data: 'ssh:data',
    exit: 'ssh:exit'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    all: 'settings:all'
  },
  workspace: {
    list: 'workspace:list',
    add: 'workspace:add',
    rename: 'workspace:rename',
    tasks: 'workspace:tasks',
    task: 'workspace:task',
    saveTask: 'workspace:saveTask',
    deleteTask: 'workspace:deleteTask',
    restoreTask: 'workspace:restoreTask'
  },
  llm: {
    config: 'llm:config',
    setConfig: 'llm:setConfig',
    listModels: 'llm:listModels',
    checkLmStudio: 'llm:checkLmStudio',
    checkOllama: 'llm:checkOllama',
    chat: 'llm:chat',
    chunk: 'llm:chunk',
    abort: 'llm:abort'
  },
  codex: {
    check: 'codex:check',
    run: 'codex:run',
    abort: 'codex:abort',
    event: 'codex:event',
    usage: 'codex:usage'
  },
  copilot: {
    check: 'copilot:check',
    login: 'copilot:login',
    run: 'copilot:run',
    abort: 'copilot:abort',
    event: 'copilot:event'
  },
  claude: {
    check: 'claude:check',
    run: 'claude:run',
    abort: 'claude:abort',
    event: 'claude:event',
    usage: 'claude:usage'
  },
  gemini: {
    check: 'gemini:check',
    run: 'gemini:run',
    abort: 'gemini:abort',
    event: 'gemini:event'
  },
  glm: {
    check: 'glm:check',
    captchaConfig: 'glm:captchaConfig',
    run: 'glm:run',
    abort: 'glm:abort',
    event: 'glm:event'
  },
  wprovider: {
    check: 'wprovider:check',
    login: 'wprovider:login',
    logout: 'wprovider:logout',
    chat: 'wprovider:chat',
    chunk: 'wprovider:chunk',
    abort: 'wprovider:abort'
  },
  blueprint: {
    list: 'blueprint:list',
    save: 'blueprint:save',
    remove: 'blueprint:remove',
    run: 'blueprint:run',
    stop: 'blueprint:stop',
    event: 'blueprint:event'
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
    pull: 'git:pull',
    fetch: 'git:fetch',
    branches: 'git:branches',
    checkout: 'git:checkout',
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
    editFile: 'agent:editFile',
    search: 'agent:search',
    runCommand: 'agent:runCommand'
  },
  web: {
    fetch: 'web:fetch',
    search: 'web:search'
  },
  update: {
    check: 'update:check',
    changelog: 'update:changelog',
    openDownload: 'update:openDownload'
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
  /** Epoch ms when the task was soft-deleted; present (and filtered out) when set. */
  deletedAt?: number
}

export interface TaskFileChange {
  path: string
  kind: string
  added?: number
  removed?: number
}

/** A renderer chat entry persisted as part of a task. */
export interface TaskMessage {
  id: string
  role: 'user' | 'assistant'
  kind: 'text' | 'tool'
  text: string
  /** Display name of the model that produced this assistant turn, stamped at
   *  creation so a mid-chat model switch leaves earlier messages untouched. */
  model?: string
  /** True for a `text` message that holds the agent's reasoning/thinking. */
  reasoning?: boolean
  tool?: string
  args?: Record<string, unknown>
  status?: 'awaiting' | 'running' | 'done' | 'rejected' | 'error'
  output?: string
  stderr?: string
  exitCode?: number | null
  oldContent?: string
  newContent?: string
  created?: boolean
  /** Lines added by this edit (write_file/edit_file/apply_patch), for the +N stat. */
  addedLines?: number
  /** Lines removed by this edit, for the -M stat. */
  removedLines?: number
  /** Per-file changes for the task change summary/popover. */
  changes?: TaskFileChange[]
  error?: string
}

/** CLI-agent session handles that carry a chat's server-side context across
 *  reopens (each CLI keeps its own history keyed by these ids). Local/web
 *  backends restore their context from `convo` instead and need none of these. */
export interface TaskSessions {
  codexThreadId?: string | null
  copilotSessionId?: string | null
  claudeSessionId?: string | null
  geminiSessionId?: string | null
  glmSessionId?: string | null
}

/** Complete persisted task, including display history and LLM context. */
export interface TaskRecord extends TaskSummary {
  messages: TaskMessage[]
  convo: LlmMessage[]
  /** CLI-agent session ids, so a reopened chat resumes its session instead of
   *  starting the agent fresh; absent for older records and non-CLI chats. */
  sessions?: TaskSessions
}

// ---------- LLM (provider-agnostic; local OpenAI-compatible, OpenRouter or CLI agents) ----------

/** Which backend drives the agent chat. */
export type LlmProvider =
  | 'lmstudio'
  | 'ollama'
  | 'openrouter'
  | 'codex'
  | 'copilot'
  | 'claude'
  | 'gemini'
  | 'glm'
  | 'wprovider'

export const SSH_CAPABLE_LLM_PROVIDERS: readonly LlmProvider[] = ['lmstudio', 'wprovider']

export function isSshCapableProvider(provider: LlmProvider): boolean {
  return SSH_CAPABLE_LLM_PROVIDERS.includes(provider)
}

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

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

export function normalizeOpenRouterApiKey(value: string): string {
  let key = stripWrappingQuotes(value.trim())
  const header = key.match(/authorization\s*:\s*(?:bearer\s+)?([^\s"'`]+)/i)
  if (header) return stripWrappingQuotes(header[1])
  const bearer = key.match(/^bearer\s+(.+)$/i)
  if (bearer) key = bearer[1].trim()
  return stripWrappingQuotes(key).split(/\s+/)[0] ?? ''
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

/**
 * Suggested Claude model aliases ('default' → Claude Code's own default). The
 * CLI resolves each alias to the newest model of that family, so the list only
 * needs updating when a new family ships (e.g. Fable alongside Opus).
 */
export const CLAUDE_MODEL_PRESETS = ['default', 'fable', 'opus', 'sonnet', 'haiku']

/**
 * GitHub Copilot CLI permission profile. `plan` keeps Copilot in planning mode,
 * `workspace` allows read/write/shell tools inside the current folder, and
 * `full` maps to Copilot's own --allow-all / --yolo behavior.
 */
export type CopilotPermissionMode = 'plan' | 'workspace' | 'full'

/** Selectable GitHub Copilot CLI permission profiles, from most to least restrictive. */
export const COPILOT_PERMISSION_MODES: CopilotPermissionMode[] = ['plan', 'workspace', 'full']

/** Reasoning effort for GitHub Copilot CLI models (`--reasoning-effort`). */
export type CopilotReasoning = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Selectable Copilot reasoning levels, in ascending order of effort. */
export const COPILOT_REASONING_LEVELS: CopilotReasoning[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Gemini CLI approval mode (`gemini --approval-mode`). */
export type GeminiApprovalMode = 'plan' | 'default' | 'auto_edit' | 'yolo'

/** Selectable Gemini CLI approval modes, from most to least restrictive. */
export const GEMINI_APPROVAL_MODES: GeminiApprovalMode[] = ['plan', 'default', 'auto_edit', 'yolo']

/**
 * Permission mode for the GLM / ZCode CLI (`zcode --prompt … --mode <mode>`).
 * `plan` is read-only; `yolo` auto-approves everything (the CLI's own default
 * for `--prompt`). `build`/`edit` may prompt for approval, which can stall a
 * headless run, so `yolo` (autonomous) is our default.
 */
export type GlmMode = 'plan' | 'build' | 'edit' | 'yolo'

/** Selectable GLM permission modes, from most to least restrictive. */
export const GLM_MODES: GlmMode[] = ['plan', 'build', 'edit', 'yolo']

// ---------- Ascora WProvider (drives a provider's web chat in a hidden browser) ----------
// WProvider emulates an API on top of a chat website: the user signs in to the
// site in a visible window once; afterwards a hidden BrowserWindow types the
// prompt into the site's own composer and the reply is captured from the
// site's streaming response. Tool use rides the agent loop's text protocol
// (the fenced ```tool_call blocks), since web chats have no native tool calls.

/** Which web chat the WProvider drives. */
export type WProviderService =
  | 'qwen'
  | 'deepseek'
  | 'alice'
  | 'mistral'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'chatgpt'

export const WPROVIDER_SERVICES: WProviderService[] = [
  'qwen',
  'deepseek',
  'alice',
  'mistral',
  'claude',
  'grok',
  'gemini',
  'chatgpt'
]

/** Display name + login origin for each supported web service. */
export const WPROVIDER_SERVICE_INFO: Record<WProviderService, { label: string; origin: string }> = {
  qwen: { label: 'Qwen', origin: 'https://chat.qwen.ai' },
  deepseek: { label: 'DeepSeek', origin: 'https://chat.deepseek.com' },
  alice: { label: 'Alice', origin: 'https://alice.yandex.ru' },
  mistral: { label: 'Mistral', origin: 'https://chat.mistral.ai' },
  claude: { label: 'Claude', origin: 'https://claude.ai' },
  grok: { label: 'Grok', origin: 'https://grok.com' },
  gemini: { label: 'Gemini', origin: 'https://gemini.google.com' },
  chatgpt: { label: 'ChatGPT', origin: 'https://chatgpt.com' }
}

/** Result of probing the WProvider web session (provider-specific sign-in state). */
export interface WProviderCheckResult {
  ok: boolean
  service: WProviderService
  /** True when the persisted browser session holds a login for the service. */
  loggedIn: boolean
  error?: string
}

export interface WProviderLoginResult {
  ok: boolean
  loggedIn: boolean
  error?: string
}

export interface WProviderChatParams {
  /**
   * Stable key of the conversation (the ADE task id). The main process keeps a
   * web chat per key and only sends messages the site hasn't seen yet — the
   * chat website carries its own history, unlike a stateless API.
   */
  sessionKey: string
  /** Optional per-conversation service. Blueprints use this so agents can use
   *  different signed-in web chats without racing the global settings picker. */
  service?: WProviderService
  /** Full agent transcript; main relays the not-yet-sent slice to the site. */
  messages: LlmMessage[]
}

// ---------- Blueprints (independent multi-agent automation scenarios) ----------

export type BlueprintStepType = 'agent' | 'telegram' | 'delay' | 'webhook'
export type BlueprintRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
export type BlueprintStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** Stable source node used by the visual Blueprint graph. */
export const BLUEPRINT_START_NODE_ID = '__blueprint_start__'

export interface BlueprintNodePosition {
  x: number
  y: number
}

export interface BlueprintConnection {
  id: string
  from: string
  to: string
  /** Destination port. Missing means a regular dependency for older saved graphs. */
  toPort?: 'input' | 'repeat'
  /** Total bounded passes through a repeat connection, including the first pass. */
  iterations?: number
}

/** Optional visual execution graph. Older definitions continue to use step order. */
export interface BlueprintGraph {
  positions: Record<string, BlueprintNodePosition>
  connections: BlueprintConnection[]
}

/** A named WProvider participant. Every participant owns an isolated web-chat session. */
export interface BlueprintAgent {
  id: string
  name: string
  /** Human-readable responsibility shown in the editor and injected into the system prompt. */
  role: string
  /** Stable operating instructions for this participant. */
  instructions: string
  /** Web service driven by Ascora WProvider for this participant. */
  service: WProviderService
  enabled: boolean
}

/**
 * One ordered action in a Blueprint. Type-specific properties are optional so
 * the renderer can change an action's type without rebuilding the entire form.
 */
export interface BlueprintStep {
  id: string
  name: string
  type: BlueprintStepType
  /** Run the action this many times during one scenario pass (1 by default). */
  repeat?: number
  /** Continue with later actions after this one fails. */
  continueOnError?: boolean

  // agent
  agentId?: string
  prompt?: string
  /** Enable the multi-turn tool loop only for this agent step. */
  agentMode?: boolean

  // telegram
  telegramBotToken?: string
  telegramChatId?: string
  message?: string

  // delay
  delaySeconds?: number

  // generic webhook
  webhookUrl?: string
  webhookMethod?: 'POST' | 'PUT' | 'PATCH'
  /** JSON object serialized as request headers. */
  webhookHeaders?: string
  /** Text or JSON body after Blueprint variable interpolation. */
  webhookBody?: string
}

export interface BlueprintSchedule {
  enabled: boolean
  /** Interval between automatic runs. Kept in minutes to make accidental tight loops unlikely. */
  intervalMinutes: number
  /** Input supplied to every scheduled pass. */
  input?: string
}

export interface BlueprintStepRun {
  id: string
  stepId: string
  stepName: string
  type: BlueprintStepType
  attempt: number
  status: BlueprintStepStatus
  startedAt?: number
  finishedAt?: number
  output?: string
  error?: string
  /** Persistent audit trail for tools executed by an agent-mode step. */
  tools?: BlueprintToolRun[]
}

export type BlueprintToolRunStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface BlueprintToolRun {
  id: string
  tool: string
  args: Record<string, unknown>
  status: BlueprintToolRunStatus
  startedAt: number
  finishedAt?: number
  /** Size-capped result kept for the execution log. */
  output?: string
  error?: string
}

export interface BlueprintRunSummary {
  id: string
  blueprintId: string
  trigger: 'manual' | 'schedule'
  input: string
  status: BlueprintRunStatus
  startedAt: number
  finishedAt?: number
  steps: BlueprintStepRun[]
  error?: string
}

/** Persisted, project-independent automation script. */
export interface BlueprintDefinition {
  id: string
  name: string
  description: string
  /** Run WProvider participants through the built-in multi-turn tool loop. */
  agentMode: boolean
  /** Optional local workspace used by file and shell tools in agent mode. */
  workspaceId?: string
  agents: BlueprintAgent[]
  steps: BlueprintStep[]
  graph?: BlueprintGraph
  schedule: BlueprintSchedule
  createdAt: number
  updatedAt: number
  lastRun?: BlueprintRunSummary
}

export interface BlueprintRunRequest {
  blueprintId: string
  input?: string
}

export interface BlueprintRunResult {
  ok: boolean
  runId?: string
  error?: string
}

export type BlueprintEventKind =
  | 'run-started'
  | 'step-started'
  | 'step-delta'
  | 'step-completed'
  | 'step-failed'
  | 'run-completed'
  | 'run-failed'
  | 'run-stopped'

/** Live execution event emitted by the main-process Blueprint engine. */
export interface BlueprintEvent {
  kind: BlueprintEventKind
  blueprintId: string
  runId: string
  run: BlueprintRunSummary
  stepId?: string
  delta?: string
}

export interface LlmConfig {
  /** Active backend for the agent chat. */
  provider: LlmProvider
  /** OpenAI-compatible base, e.g. http://localhost:1234/v1 (LM Studio). */
  baseUrl: string
  /** Default LM Studio model id used when a request doesn't specify one. */
  model: string
  /** OpenAI-compatible base for Ollama, usually http://localhost:11434/v1. */
  ollamaBaseUrl: string
  /** Default Ollama model id used when selected. */
  ollamaModel: string
  /** Whether OpenRouter is exposed as a selectable agent backend. */
  openRouterEnabled: boolean
  /** OpenRouter API key. Stored locally in app settings. */
  openRouterApiKey: string
  /** Default OpenRouter model id used when selected. */
  openRouterModel: string
  /** Path to the `codex` binary; empty → auto-detect (PATH / bundled extension). */
  codexPath: string
  /** Model passed to `codex exec -m`; empty → Codex's own default. */
  codexModel: string
  /** Sandbox policy Codex runs commands under. */
  codexSandbox: CodexSandbox
  /** Reasoning effort for Codex; empty → use Codex's own default. */
  codexReasoning: CodexReasoning | ''
  /** Path to the `copilot` binary; empty -> auto-detect from PATH. */
  copilotPath: string
  /** Model passed to `copilot --model`; empty -> Copilot CLI's own default. */
  copilotModel: string
  /** Permission profile used for Copilot CLI runs. */
  copilotPermission: CopilotPermissionMode
  /** Reasoning effort for Copilot CLI; empty -> use Copilot's own default. */
  copilotReasoning: CopilotReasoning | ''
  /** Path to the `claude` binary; empty → auto-detect (PATH / bundled extension). */
  claudePath: string
  /** Model passed to `claude --model`; empty → Claude Code's own default. */
  claudeModel: string
  /** Permission mode Claude Code runs under. */
  claudePermission: ClaudePermissionMode
  /** Path to the `gemini` binary; empty -> auto-detect from PATH. */
  geminiPath: string
  /** Model passed to `gemini --model`; empty -> Gemini CLI's own default. */
  geminiModel: string
  /** Approval mode Gemini CLI runs under. */
  geminiPermission: GeminiApprovalMode
  /**
   * Path to the ZCode install (folder, `ZCode.exe`, or `zcode.cjs`); empty →
   * auto-detect the per-user install. The bundled `zcode.cjs` is driven via
   * `ZCode.exe` with `ELECTRON_RUN_AS_NODE=1`.
   */
  glmPath: string
  /** Permission mode the GLM/ZCode agent runs under (`--mode`). */
  glmMode: GlmMode
  /** Which web chat Ascora WProvider drives (hidden-browser backend). */
  wproviderService: WProviderService
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: 'lmstudio',
  baseUrl: 'http://localhost:1234/v1',
  model: '',
  ollamaBaseUrl: 'http://localhost:11434/v1',
  ollamaModel: '',
  openRouterEnabled: false,
  openRouterApiKey: '',
  openRouterModel: 'openrouter/free',
  codexPath: '',
  codexModel: '',
  codexSandbox: 'workspace-write',
  codexReasoning: '',
  copilotPath: '',
  copilotModel: '',
  copilotPermission: 'workspace',
  copilotReasoning: '',
  claudePath: '',
  claudeModel: '',
  claudePermission: 'acceptEdits',
  geminiPath: '',
  geminiModel: '',
  geminiPermission: 'yolo',
  glmPath: '',
  glmMode: 'yolo',
  wproviderService: 'qwen'
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
  /** file_change: the files touched and how (with per-file line counts when Codex reports them). */
  changes?: TaskFileChange[]
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

// ---------- GitHub Copilot CLI (`copilot -p --output-format=json`) ----------
// The Copilot backend reuses Codex's normalized CodexEvent / CodexItem /
// CodexRunResult / CodexCheckResult shapes so the renderer drives every CLI
// backend with one code path.

export interface CopilotRunParams {
  prompt: string
  /** Working root the spawned `copilot` runs in. */
  cwd: string
  /** Resume or create this Copilot CLI session (`--session-id <id>`). */
  sessionId?: string
  /** Overrides the configured model (`--model`); empty -> config/default. */
  model?: string
  /** Overrides the configured permission profile. */
  permission?: CopilotPermissionMode
  /** Overrides the configured reasoning effort (`--reasoning-effort`). */
  reasoning?: CopilotReasoning | ''
}

export interface CopilotLoginResult {
  ok: boolean
  error?: string
}

// ---------- Gemini CLI (`gemini -p --output-format stream-json`) ----------
// The Gemini backend reuses Codex's normalized CodexEvent / CodexItem /
// CodexRunResult / CodexCheckResult shapes so the renderer drives every CLI
// backend with one code path.

export interface GeminiRunParams {
  prompt: string
  /** Working root the spawned `gemini` runs in. */
  cwd: string
  /** Resume this Gemini CLI session instead of starting fresh (`--resume`). */
  sessionId?: string
  /** Overrides the configured model (`--model`); empty -> config/default. */
  model?: string
  /** Overrides the configured approval mode (`--approval-mode`). */
  permission?: GeminiApprovalMode
}

/** One normalized account rate-limit window for the status-bar usage indicator. */
export interface UsageLimitWindow {
  /** Display label, e.g. "session limit" / "weekly limit" / "weekly Opus limit". */
  label: string
  /** Percent of the window consumed, 0–100 (rounded). */
  percent: number
  /** Server-assessed severity; 'warning'/'critical' once the window is nearly spent. */
  severity: 'normal' | 'warning' | 'critical' | string
  /** ISO timestamp when the window resets, when reported. */
  resetsAt?: string
}

/** Result of probing an account/subscription usage-limit feed. */
export interface UsageLimitResult {
  ok: boolean
  /** False when local credentials are missing or expired. */
  loggedIn: boolean
  /** All reported limit windows, most-consumed first. */
  windows: UsageLimitWindow[]
  /** The window worth headlining (the most-consumed one), if any. */
  headline?: UsageLimitWindow
  error?: string
}

// ---------- GLM / ZCode (`zcode --prompt … --json`) ----------
// The GLM backend drives ZCode's bundled `zcode.cjs` headless CLI (an OpenCode
// fork that runs GLM/Zhipu & other Chinese models). It reuses Codex's
// normalized CodexEvent / CodexItem / CodexRunResult / CodexCheckResult shapes
// so the renderer drives all CLI backends with one code path.

export type ClaudeUsageWindow = UsageLimitWindow
export type ClaudeUsageResult = UsageLimitResult
export type CodexUsageResult = UsageLimitResult

export interface GlmRunParams {
  prompt: string
  /** Working root the spawned `zcode` runs in (`--cwd`). */
  cwd: string
  /** Resume a persisted ZCode session (`--resume sess_…`). */
  sessionId?: string
  /** Permission mode (`--mode`); defaults to the configured one. */
  mode?: GlmMode
  /** One-use Aliyun verification proof required by ZCode Start Plan. */
  captchaVerifyParam?: string
  /** Aliyun verification region paired with `captchaVerifyParam`. */
  captchaRegion?: string
}

export interface GlmCaptchaConfig {
  region: string
  prefix: string
  sceneId: string
  mode?: string
}

export interface GlmCaptchaConfigResult {
  /** True only for the desktop Start Plan provider. */
  required: boolean
  config?: GlmCaptchaConfig
  error?: string
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
  pushTarget?: string
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

export interface FileActionResult {
  ok: boolean
  path?: string
  error?: string
}

export interface AttachmentFile {
  /** Basename after import; may include a numeric suffix if a duplicate existed. */
  name: string
  /** Workspace-relative path using forward slashes, ready to reference in prompts. */
  path: string
  /** Absolute local path where the file is available to the agent. */
  absolutePath: string
}

export interface AttachmentImportResult {
  ok: boolean
  files?: AttachmentFile[]
  error?: string
}

// ---------- SSH terminals ----------

export type SshAuthType = 'key' | 'password'

/** A saved SSH host the user can open a terminal to (persisted in app settings). */
export interface SshConnection {
  id: string
  /** Display label in the rail. */
  name: string
  host: string
  port: number
  username: string
  authType: SshAuthType
  /** Absolute path to a PEM/private-key file (authType 'key'). */
  keyPath?: string
  /** Optional passphrase for an encrypted private key. */
  passphrase?: string
  /** Password (authType 'password'). Stored in local app settings. */
  password?: string
}

/** Window size for the remote pty, sent on connect/resize. */
export interface SshSize {
  cols: number
  rows: number
}

export interface SshConnectResult {
  ok: boolean
  error?: string
}

/** One-shot remote command result (used by the agent's run_command over SSH). */
export interface SshExecResult {
  ok: boolean
  stdout?: string
  stderr?: string
  code?: number | null
  error?: string
}

/** Remote shell output forwarded main → renderer. */
export interface SshDataPayload {
  id: string
  data: string
}

/** Emitted main → renderer when the SSH session ends. */
export interface SshExitPayload {
  id: string
  code: number | null
  error?: string
}

/** Result of starting (or reusing) the built-in Live Server for HTML preview. */
export interface LiveServerResult {
  ok: boolean
  /** Base URL of the running server, e.g. http://127.0.0.1:5500. */
  url?: string
  port?: number
  /** Absolute workspace root the server is serving. */
  root?: string
  error?: string
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitBranchesResult {
  ok: boolean
  branches?: GitBranch[]
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

/** Optional 1-based, inclusive line slice for a ranged read. */
export interface AgentReadRange {
  startLine?: number
  endLine?: number
}

export interface AgentReadResult {
  ok: boolean
  path?: string
  content?: string
  /** True when the file was binary/too large and content was withheld. */
  truncated?: boolean
  /** First line returned (1-based), present only when a slice was requested. */
  startLine?: number
  /** Last line returned (1-based), present only when a slice was requested. */
  endLine?: number
  /** Total line count of the whole file (so the model can page through it). */
  totalLines?: number
  error?: string
}

export interface AgentEditResult {
  ok: boolean
  path?: string
  /** How many occurrences of `oldString` were replaced. */
  replacements?: number
  error?: string
}

/** A single line that matched an `agent.search` query. */
export interface AgentSearchMatch {
  /** Repo-relative path using forward slashes. */
  path: string
  /** 1-based line number of the match. */
  line: number
  /** The matching line, trimmed and length-capped for token budgets. */
  text: string
  /** Context lines immediately before the match (when `context` > 0). */
  before?: string[]
  /** Context lines immediately after the match (when `context` > 0). */
  after?: string[]
}

/**
 * ripgrep-style options for `agent.search`. Defaults preserve the original
 * behavior: a literal, case-insensitive substring scan of the whole workspace.
 */
export interface AgentSearchOptions {
  /** Restrict the scan to this workspace-relative subdirectory. */
  path?: string
  /** Interpret `query` as a JavaScript regular expression instead of a literal. */
  regex?: boolean
  /** Only search files whose repo-relative path matches this glob (e.g. `**\/*.ts`). */
  glob?: string
  /** Include this many lines of context before and after each match (0 = none). */
  context?: number
  /** Match case-sensitively (default false = case-insensitive). */
  caseSensitive?: boolean
}

export interface AgentSearchResult {
  ok: boolean
  query?: string
  matches?: AgentSearchMatch[]
  /** True when the match list hit the cap and more results exist. */
  truncated?: boolean
  error?: string
}

// ---------- Web tools (outbound HTTP for the agent loop) ----------

export interface WebFetchResult {
  ok: boolean
  /** Final URL after redirects. */
  url?: string
  /** Page <title>, when the response was HTML. */
  title?: string
  /** Extracted plain text (HTML stripped) or the raw body for text responses. */
  content?: string
  /** Reported/served content type, e.g. "text/html". */
  contentType?: string
  /** True when the body was longer than the cap and `content` was truncated. */
  truncated?: boolean
  error?: string
}

export interface WebSearchItem {
  title: string
  url: string
  snippet: string
}

export interface WebSearchResult {
  ok: boolean
  query?: string
  results?: WebSearchItem[]
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

// ---------- App updates (checked against ade.ascoreai.com, then GitHub fallback) ----------

/**
 * Result of probing the release feeds for a newer build. The renderer uses this
 * to show/hide the title-bar "Update" badge; clicking it opens the download or
 * release page via `update.openDownload`.
 */
export interface UpdateInfo {
  ok: boolean
  /** This build's version (from app.getVersion()). */
  current: string
  /** Latest published version, when the feed was reachable. */
  latest?: string
  /** True when `latest` is strictly newer than `current`. */
  updateAvailable: boolean
  /** Changelog/release notes for the latest version (markdown), if any. */
  notes?: string
  /** Page to open when the user clicks the badge. */
  url?: string
  /** Populated when neither feed could be reached or parsed. */
  error?: string
}

/** One published release shown in the update modal's changelog list. */
export interface ReleaseEntry {
  version: string
  /** ISO publish date, when the feed provides one. */
  date?: string
  /** Release notes (markdown), if any. */
  notes?: string
}

/**
 * Changelog fetched when the user clicks the "Update" badge. Lists releases
 * newer than the running build (site `/api/releases` first, GitHub releases
 * as fallback); `url` is where the modal's "Update" button sends the user.
 */
export interface ChangelogInfo {
  ok: boolean
  /** Which feed answered — the site's changelog or the GitHub fallback. */
  source?: 'website' | 'github'
  /** Releases newer than the running build, newest first. */
  releases: ReleaseEntry[]
  /** Download/release page matching `source`. */
  url?: string
  /** Populated when neither feed could be reached or parsed. */
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
