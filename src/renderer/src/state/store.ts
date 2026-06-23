import { create } from 'zustand'
import type {
  Workspace,
  TreeNode,
  SshConnection,
  LlmMessage,
  TaskMessage,
  TaskSummary,
  ToolDef,
  LlmProvider,
  CodexSandbox,
  CodexReasoning,
  ClaudePermissionMode,
  GlmMode,
  CodexEvent,
  CodexItem,
  CodexCheckResult
} from '@shared/ipc'
import { DEFAULT_LLM_CONFIG } from '@shared/ipc'
import { api } from '@/lib/api'
import { diffStat } from '@/lib/diff'
import { solveZCodeCaptcha } from '@/lib/zcode-captcha'

export type View = 'home' | 'workspace' | 'analytics'
/** Agent permission mode — mirrors ZCode's "Ask before changes" control. */
export type AgentMode = 'ask' | 'auto'
export type Connection = 'unknown' | 'connecting' | 'connected' | 'error'
export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
}

/** Lifecycle and shape of chat entries persisted with a task. */
export type ToolStatus = NonNullable<TaskMessage['status']>
export type ChatMessage = TaskMessage

/** How many tool round-trips a single task may take before we stop. */
const MAX_STEPS = 16

const TOOL_NAMES = [
  'list_dir',
  'read_file',
  'search_files',
  'write_file',
  'edit_file',
  'run_command'
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
        'Search the workspace for a literal, case-insensitive text and return matching ' +
        'file:line locations. Use this to find code instead of reading files one by one.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for (case-insensitive substring).' },
          path: { type: 'string', description: 'Optional subdirectory to scope the search to.' }
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
  }
]

/** Build the system prompt for the local (LM Studio) agent loop. */
function buildSystemPrompt(sshHost?: string): string {
  const onWin = api.system.platform === 'win32'
  const shellNote = onWin
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
    '- search_files(query, [path]): find where text appears across the project',
    '- write_file(path, content): create or fully overwrite a file',
    '- edit_file(path, old_string, new_string, [replace_all]): change part of a file in place',
    '- run_command(command): run a shell command in the project root and read its output',
    '',
    'All paths are relative to the project root. Work step by step: call one tool at a time,',
    'wait for its result, then decide the next step. Prefer search_files to locate code and',
    'edit_file for surgical changes; reach for write_file only for new files or full rewrites.',
    'Always read a snippet before editing it so old_string matches exactly.',
    shellNote,
    ...(sshHost
      ? [
          `An SSH session to ${sshHost} is connected — run_command runs on that REMOTE host, ` +
            'not the local project. The file tools (read_file/write_file/edit_file/search_files/' +
            'list_dir) still operate on the local project folder.'
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

// ---- agent-loop helpers (module scope; one task runs at a time) ----

/** Pending Ask-mode approvals: card id → resolver. */
const pendingApprovals = new Map<string, (approved: boolean) => void>()
/** Set by stopStreaming to break the loop and reject pending approvals. */
let runAborted = false

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
  codexModel: string
  claudeModel: string
}): string {
  switch (s.provider) {
    case 'lmstudio':
      return s.model || 'local model'
    case 'codex':
      return s.codexModel || 'Codex'
    case 'claude':
      return s.claudeModel && s.claudeModel !== 'default' ? s.claudeModel : 'Claude'
    case 'glm':
      return 'GLM'
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

/** Parse a fenced ```tool_call / ```json block from assistant text (fallback path). */
function parseTextToolCall(content: string): { call: ParsedCall; block: string } | null {
  const fence = content.match(/```(?:tool_call|json)?\s*([\s\S]*?)```/i)
  if (!fence) return null
  try {
    const obj = JSON.parse(fence[1].trim()) as Record<string, unknown>
    const name = asStr(obj.tool) || asStr(obj.name)
    if (!isToolName(name)) return null
    const rawArgs = obj.args ?? obj.arguments ?? {}
    const args =
      rawArgs && typeof rawArgs === 'object'
        ? (rawArgs as Record<string, unknown>)
        : safeArgs(asStr(rawArgs))
    return { call: { id: `call_${Math.random().toString(36).slice(2, 9)}`, name, args }, block: fence[0] }
  } catch {
    return null
  }
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
  codexModel: string
  codexSandbox: CodexSandbox
  codexReasoning: CodexReasoning | ''
  claudeModel: string
  claudePermission: ClaudePermissionMode
  glmMode: GlmMode
}

/** Snapshot the active backend selection for persisting against a workspace. */
function snapshotLlm(s: {
  provider: LlmProvider
  model: string
  codexModel: string
  codexSandbox: CodexSandbox
  codexReasoning: CodexReasoning | ''
  claudeModel: string
  claudePermission: ClaudePermissionMode
  glmMode: GlmMode
}): WorkspaceLlm {
  return {
    provider: s.provider,
    model: s.model,
    codexModel: s.codexModel,
    codexSandbox: s.codexSandbox,
    codexReasoning: s.codexReasoning,
    claudeModel: s.claudeModel,
    claudePermission: s.claudePermission,
    glmMode: s.glmMode
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
  activeTaskTitle: string

  treeRoots: TreeNode[]
  childrenByPath: Record<string, TreeNode[]>
  expanded: Record<string, boolean>
  treeLoading: boolean

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

  // SSH terminals
  /** Saved SSH hosts shown under Workspaces (persisted in app settings). */
  sshConnections: SshConnection[]
  /** Connection ids whose terminal panel is open in the dock. */
  openSshTerminals: string[]
  /** Connection id the agent's run_command targets while a session is open. */
  activeSsh: string | null
  /** Whether the add/edit SSH connection modal is open. */
  sshModalOpen: boolean
  /** Connection being edited (null → adding a new one). */
  sshEditing: SshConnection | null

  // LLM provider
  provider: LlmProvider
  /** Per-workspace saved backend selections (workspace id → choice). */
  workspaceLlm: Record<string, WorkspaceLlm>
  // LM Studio
  baseUrl: string
  model: string
  models: string[]
  connection: Connection
  connectionError?: string
  // Codex CLI
  codexPath: string
  codexModel: string
  codexSandbox: CodexSandbox
  codexReasoning: CodexReasoning | ''
  codexThreadId: string | null
  codexCheck: CodexCheckResult | null
  codexChecking: boolean
  // Claude Code
  claudePath: string
  claudeModel: string
  claudePermission: ClaudePermissionMode
  claudeSessionId: string | null
  claudeCheck: CodexCheckResult | null
  claudeChecking: boolean
  // GLM / ZCode
  glmPath: string
  glmMode: GlmMode
  glmSessionId: string | null
  glmCheck: CodexCheckResult | null
  glmChecking: boolean
  settingsOpen: boolean
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
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
  reorderWorkspaces: (draggedId: string, targetId: string) => void
  openTask: (ws: Workspace, taskId: string) => Promise<void>
  deleteTask: (ws: Workspace, taskId: string) => Promise<void>
  saveActiveTask: (status: TaskSummary['status']) => Promise<void>
  goHome: () => void
  openAnalytics: () => void
  closeAnalytics: () => void
  toggleDir: (node: TreeNode) => Promise<void>
  refreshDirectory: (path: string) => Promise<void>
  openFile: (node: TreeNode) => Promise<void>
  renameOpenFile: (oldPath: string, newPath: string, newName: string) => void
  renameOpenPathPrefix: (oldPath: string, newPath: string) => void
  closeFilesUnder: (path: string) => void
  closeFile: (path: string) => void
  closeOtherFiles: (path: string) => void
  closeFilesToRight: (path: string) => void
  closeAllFiles: () => void
  setActiveFile: (path: string) => void

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
  /** Open (or focus) an SSH terminal for a saved connection. */
  openSshTerminal: (id: string) => void
  /** Close an SSH terminal panel and disconnect its session. */
  closeSshTerminal: (id: string) => void

  refreshModels: () => Promise<void>
  setModel: (m: string) => void
  setBaseUrl: (url: string) => Promise<void>
  setProvider: (p: LlmProvider) => Promise<void>
  setCodexPath: (path: string) => Promise<void>
  setCodexModel: (m: string) => void
  setCodexSandbox: (s: CodexSandbox) => void
  setCodexReasoning: (r: CodexReasoning | '') => void
  checkCodex: () => Promise<void>
  setClaudePath: (path: string) => Promise<void>
  setClaudeModel: (m: string) => void
  setClaudePermission: (p: ClaudePermissionMode) => void
  checkClaude: () => Promise<void>
  setGlmPath: (path: string) => Promise<void>
  setGlmMode: (m: GlmMode) => void
  checkGlm: () => Promise<void>
  /** Save the current backend selection against the active workspace. */
  persistWorkspaceLlm: () => void
  /** Load a workspace's saved backend selection and re-check the connection. */
  syncWorkspaceLlm: (workspaceId: string) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  setThemePreference: (theme: ThemePreference) => void
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
  stopStreaming: () => void
  newTask: () => void
}

export const useApp = create<AppState>((set, get) => ({
  view: 'home',
  workspaces: [],
  workspaceOrder: [],
  collapsedWorkspaces: {},
  active: null,
  tasksByWorkspace: {},
  activeTaskId: null,
  activeTaskTitle: '',
  treeRoots: [],
  childrenByPath: {},
  expanded: {},
  treeLoading: false,
  openFiles: [],
  activeFile: null,

  liveUrl: null,
  livePort: null,
  liveRoot: null,
  previewUrl: null,
  previewMode: 'docked',
  dockLayout: null,

  sshConnections: [],
  openSshTerminals: [],
  activeSsh: null,
  sshModalOpen: false,
  sshEditing: null,

  provider: DEFAULT_LLM_CONFIG.provider,
  workspaceLlm: {},
  baseUrl: DEFAULT_LLM_CONFIG.baseUrl,
  model: '',
  models: [],
  connection: 'unknown',
  codexPath: DEFAULT_LLM_CONFIG.codexPath,
  codexModel: DEFAULT_LLM_CONFIG.codexModel,
  codexSandbox: DEFAULT_LLM_CONFIG.codexSandbox,
  codexReasoning: DEFAULT_LLM_CONFIG.codexReasoning,
  codexThreadId: null,
  codexCheck: null,
  codexChecking: false,
  claudePath: DEFAULT_LLM_CONFIG.claudePath,
  claudeModel: DEFAULT_LLM_CONFIG.claudeModel,
  claudePermission: DEFAULT_LLM_CONFIG.claudePermission,
  claudeSessionId: null,
  claudeCheck: null,
  claudeChecking: false,
  glmPath: DEFAULT_LLM_CONFIG.glmPath,
  glmMode: DEFAULT_LLM_CONFIG.glmMode,
  glmSessionId: null,
  glmCheck: null,
  glmChecking: false,
  settingsOpen: false,
  themePreference: 'dark',
  resolvedTheme: 'dark',
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
      savedOrder,
      savedCollapsed,
      savedLlm,
      savedSidebar,
      savedSkills,
      savedSsh
    ] = await Promise.all([
        api.workspace.list(),
        api.llm.config(),
        api.settings.get<ThemePreference>('appearance.theme'),
        api.settings.get<string[]>('workspace.order'),
        api.settings.get<Record<string, boolean>>('workspace.collapsed'),
        api.settings.get<Record<string, WorkspaceLlm>>('workspace.llm'),
        api.settings.get<boolean>('sidebar.collapsed'),
        api.settings.get<Skill[]>('skills'),
        api.settings.get<SshConnection[]>('ssh.connections')
      ])
    const workspaceOrder = Array.isArray(savedOrder) ? savedOrder : []
    const collapsedWorkspaces =
      savedCollapsed && typeof savedCollapsed === 'object' ? savedCollapsed : {}
    const workspaceLlm = savedLlm && typeof savedLlm === 'object' ? savedLlm : {}
    const ordered = sortWorkspaces(workspaces, workspaceOrder)
    const themePreference = isThemePreference(savedTheme) ? savedTheme : 'dark'
    const resolvedTheme = applyTheme(themePreference)
    const taskLists = await Promise.all(
      ordered.map(async (workspace) => [workspace.id, await api.workspace.tasks(workspace.id)] as const)
    )
    set({
      workspaces: ordered,
      workspaceOrder,
      collapsedWorkspaces,
      workspaceLlm,
      tasksByWorkspace: Object.fromEntries(taskLists),
      sidebarCollapsed: savedSidebar === true,
      // First run (no saved value) seeds the defaults; an empty saved array is
      // respected (the user removed every skill).
      skills: Array.isArray(savedSkills) ? savedSkills : DEFAULT_SKILLS,
      sshConnections: Array.isArray(savedSsh) ? savedSsh : [],
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      codexPath: cfg.codexPath,
      codexModel: cfg.codexModel,
      codexSandbox: cfg.codexSandbox,
      codexReasoning: cfg.codexReasoning,
      claudePath: cfg.claudePath,
      claudeModel: cfg.claudeModel,
      claudePermission: cfg.claudePermission,
      glmPath: cfg.glmPath,
      glmMode: cfg.glmMode,
      themePreference,
      resolvedTheme
    })
    if (ordered.length > 0) {
      await get().loadWorkspaceData(ordered[0])
      // Apply that workspace's saved model/provider and check the connection.
      await get().syncWorkspaceLlm(ordered[0].id)
    } else {
      await get().refreshModels()
      if (cfg.provider === 'codex') await get().checkCodex()
      if (cfg.provider === 'claude') await get().checkClaude()
      if (cfg.provider === 'glm') await get().checkGlm()
    }
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
    // Don't reset a streaming conversation when the workspace is re-selected in
    // the rail: re-selecting the active one returns to the live view; switching
    // to another mid-stream is suppressed so the running turn isn't orphaned.
    if (get().streaming) {
      if (get().active?.id === ws.id) set({ view: 'workspace' })
      return
    }
    await get().loadWorkspaceData(ws)
    const tasks = await api.workspace.tasks(ws.id)
    set((state) => ({
      view: 'workspace',
      messages: [],
      convo: [],
      activeTaskId: null,
      activeTaskTitle: '',
      codexThreadId: null,
      claudeSessionId: null,
      glmSessionId: null,
      tasksByWorkspace: { ...state.tasksByWorkspace, [ws.id]: tasks }
    }))
    // Switch to this project's saved model/provider.
    await get().syncWorkspaceLlm(ws.id)
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

  async openTask(ws, taskId) {
    // Re-selecting the task that's already open (e.g. coming back from Analytics
    // while it's still streaming) just returns to it — never reload it from disk,
    // which would clobber the in-flight messages/convo. Switching to a *different*
    // task is still suppressed mid-stream to protect the running turn.
    if (get().activeTaskId === taskId) {
      set({ view: 'workspace' })
      return
    }
    if (get().streaming) return
    const task = await api.workspace.task(taskId)
    if (!task || task.workspaceId !== ws.id) return
    const switchingWorkspace = get().active?.id !== ws.id
    if (switchingWorkspace) await get().loadWorkspaceData(ws)
    set({
      active: ws,
      activeTaskId: task.id,
      activeTaskTitle: task.title,
      messages: task.messages,
      convo: task.convo,
      codexThreadId: null,
      claudeSessionId: null,
      glmSessionId: null,
      view: 'workspace'
    })
    // Opening a task in a different project switches to that project's model.
    if (switchingWorkspace) await get().syncWorkspaceLlm(ws.id)
  },

  async deleteTask(ws, taskId) {
    await api.workspace.deleteTask(taskId)
    set((state) => {
      const tasks = state.tasksByWorkspace[ws.id] ?? []
      const nextTasks = tasks.filter((task) => task.id !== taskId)
      const next = { ...state.tasksByWorkspace, [ws.id]: nextTasks }
      // If the deleted task was open, drop its draft state and return home.
      const wasActive = state.activeTaskId === taskId
      return wasActive
        ? {
            tasksByWorkspace: next,
            messages: [],
            convo: [],
            activeTaskId: null,
            activeTaskTitle: '',
            codexThreadId: null,
            claudeSessionId: null,
            glmSessionId: null,
            view: state.active ? 'home' : state.view
          }
        : { tasksByWorkspace: next }
    })
  },

  async saveActiveTask(status) {
    const state = get()
    if (!state.active || !state.activeTaskId) return
    try {
      const summary = await api.workspace.saveTask({
        id: state.activeTaskId,
        workspaceId: state.active.id,
        title: state.activeTaskTitle,
        status,
        updatedAt: Date.now(),
        messages: state.messages,
        convo: state.convo
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
    const { expanded, childrenByPath } = get()
    const isOpen = !!expanded[node.path]
    if (isOpen) {
      set({ expanded: { ...expanded, [node.path]: false } })
      return
    }
    if (!childrenByPath[node.path]) {
      const children = await api.fs.readTree(node.path)
      set((s) => ({ childrenByPath: { ...s.childrenByPath, [node.path]: children } }))
    }
    set((s) => ({ expanded: { ...s.expanded, [node.path]: true } }))
  },

  async refreshDirectory(path) {
    const active = get().active
    if (!active) return
    const children = await api.fs.readTree(path)
    const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (normalize(path) === normalize(active.path)) {
      set({ treeRoots: children })
      return
    }
    set((state) => ({ childrenByPath: { ...state.childrenByPath, [path]: children } }))
  },

  async openFile(node) {
    const existing = get().openFiles.find((f) => f.path === node.path)
    if (existing) {
      set({ activeFile: node.path, view: 'workspace' })
      return
    }
    const file = await api.fs.readFile(node.path)
    set((s) => ({
      openFiles: [
        ...s.openFiles,
        { path: file.path, name: node.name, content: file.content, language: file.language }
      ],
      activeFile: file.path,
      view: 'workspace'
    }))
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

  async goLive() {
    const { active, openFiles, activeFile, liveUrl, liveRoot } = get()
    if (!active) return
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
    set((state) => {
      const sshConnections = state.sshConnections.filter((c) => c.id !== id)
      void api.settings.set('ssh.connections', sshConnections)
      return { sshConnections }
    })
  },

  pickSshKey() {
    return api.ssh.pickKey()
  },

  openSshTerminal(id) {
    set((state) => ({
      openSshTerminals: state.openSshTerminals.includes(id)
        ? state.openSshTerminals
        : [...state.openSshTerminals, id],
      // The agent's run_command targets the most recently opened host.
      activeSsh: id,
      view: 'workspace'
    }))
  },

  closeSshTerminal(id) {
    void api.ssh.disconnect(id)
    set((state) => {
      const openSshTerminals = state.openSshTerminals.filter((t) => t !== id)
      const activeSsh =
        state.activeSsh === id ? (openSshTerminals.at(-1) ?? null) : state.activeSsh
      return { openSshTerminals, activeSsh }
    })
  },

  async refreshModels() {
    set({ connection: 'connecting', connectionError: undefined })
    const res = await api.llm.listModels()
    if (res.ok) {
      const models = (res.models ?? []).map((m) => m.id)
      const model = get().model || models[0] || ''
      set({ models, connection: 'connected', model })
      if (model && model !== get().model) void api.llm.setConfig({ model })
    } else {
      set({ connection: 'error', connectionError: res.error })
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

  async setProvider(provider) {
    set({ provider })
    await api.llm.setConfig({ provider })
    get().persistWorkspaceLlm()
    if (provider === 'codex') await get().checkCodex()
    else if (provider === 'claude') await get().checkClaude()
    else if (provider === 'glm') await get().checkGlm()
    else await get().refreshModels()
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
    } catch (err) {
      set({
        codexCheck: { ok: false, installed: false, error: err instanceof Error ? err.message : String(err) },
        codexChecking: false
      })
    }
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
    } catch (err) {
      set({
        claudeCheck: { ok: false, installed: false, error: err instanceof Error ? err.message : String(err) },
        claudeChecking: false
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

  persistWorkspaceLlm() {
    const id = get().active?.id
    if (!id) return
    const workspaceLlm = { ...get().workspaceLlm, [id]: snapshotLlm(get()) }
    set({ workspaceLlm })
    void api.settings.set('workspace.llm', workspaceLlm)
  },

  async syncWorkspaceLlm(workspaceId) {
    const saved = get().workspaceLlm[workspaceId]
    // No saved choice yet → keep the current selection (it becomes this
    // workspace's pinned choice the first time the user picks a model here).
    if (saved) {
      set({
        provider: saved.provider,
        model: saved.model,
        codexModel: saved.codexModel,
        codexSandbox: saved.codexSandbox,
        codexReasoning: saved.codexReasoning,
        claudeModel: saved.claudeModel,
        claudePermission: saved.claudePermission,
        glmMode: saved.glmMode
      })
    }
    const provider = get().provider
    if (provider === 'codex') await get().checkCodex()
    else if (provider === 'claude') await get().checkClaude()
    else if (provider === 'glm') await get().checkGlm()
    else await get().refreshModels()
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  setThemePreference(themePreference) {
    const resolvedTheme = applyTheme(themePreference)
    set({ themePreference, resolvedTheme })
    void api.settings.set('appearance.theme', themePreference)
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
    const taskId = get().activeTaskId ?? crypto.randomUUID()
    const title = get().activeTaskTitle || taskTitle(trimmed)
    let finalStatus: TaskSummary['status'] = 'idle'

    runAborted = false
    // Model name stamped on this turn's assistant messages (captured now so a
    // later model switch leaves these messages labelled with their real model).
    const assistantModel = modelLabel(get())
    // Enabled skills injected into the agent (system prompt for LM Studio; once
    // per CLI session, since those keep their own server-side context).
    const skillsBlock = skillsToPrompt(get().skills)
    // Cumulative streamed output length → live token estimate for the Thinking… badge.
    let streamedChars = 0
    const patch = (id: string, p: Partial<ChatMessage>): void =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }))
    const addMsg = (m: ChatMessage): void => set((s) => ({ messages: [...s.messages, m] }))
    const removeMsg = (id: string): void =>
      set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }))
    const pushConvo = (m: LlmMessage): void => set((s) => ({ convo: [...s.convo, m] }))

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
    await get().saveActiveTask('running')

    try {
      // ===== Codex / Claude / GLM CLI backends: delegate the turn to the agent CLI =====
      const agentProvider = get().provider
      if (agentProvider === 'codex' || agentProvider === 'claude' || agentProvider === 'glm') {
        const isClaude = agentProvider === 'claude'
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
        const setSession = (threadId: string): void =>
          set(isGlm ? { glmSessionId: threadId } : isClaude ? { claudeSessionId: threadId } : { codexThreadId: threadId })
        const runId = crypto.randomUUID()
        set({ streamId: runId })
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
          set({ thinkingTokens: tokensFromChars(streamedChars) })
        }

        const handleEvent = (event: CodexEvent): void => {
          if (runAborted) return
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

        const res = isGlm
          ? await api.glm.run(
              runId,
              {
                prompt: skillsPrompt(!!get().glmSessionId),
                cwd: root,
                sessionId: get().glmSessionId ?? undefined,
                mode: get().glmMode,
                ...glmCaptcha
              },
              handleEvent
            )
          : isClaude
            ? await api.claude.run(
                runId,
                {
                  prompt: skillsPrompt(!!get().claudeSessionId),
                  cwd: root,
                  sessionId: get().claudeSessionId ?? undefined,
                  model: get().claudeModel || undefined,
                  permission: get().claudePermission
                },
                handleEvent
              )
            : await api.codex.run(
                runId,
                {
                  prompt: skillsPrompt(!!get().codexThreadId),
                  cwd: root,
                  threadId: get().codexThreadId ?? undefined,
                  model: get().codexModel || undefined,
                  sandbox: get().codexSandbox,
                  reasoning: get().codexReasoning || undefined
                },
                handleEvent
              )

        set({ streamId: null, thinking: false })
        if (res.threadId) setSession(res.threadId)

        // Record usage for the dashboard (real token counts when reported).
        {
          const usage = res.usage ?? { inputTokens: estTokens(trimmed), outputTokens: 0 }
          const claudeModel = get().claudeModel
          void api.analytics.record({
            workspaceId: active.id,
            workspaceName: active.name,
            taskId,
            provider: agentProvider,
            model: isGlm
              ? 'glm'
              : isClaude
                ? claudeModel && claudeModel !== 'default'
                  ? claudeModel
                  : 'claude'
                : get().codexModel || 'codex',
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
            text: `⚠ ${res.error ?? (isGlm ? 'ZCode run failed.' : isClaude ? 'Claude run failed.' : 'Codex run failed.')}`
          })
        } else if (sawError) {
          finalStatus = 'error'
        }
        return // skip the LM Studio loop; finally still resets state + saves
      }

      for (let step = 0; step < MAX_STEPS && !runAborted; step += 1) {
        // 1) Stream one model turn into a fresh assistant bubble.
        const replyId = crypto.randomUUID()
        addMsg({ id: replyId, role: 'assistant', kind: 'text', model: assistantModel, text: '' })
        set({ streamId: replyId, thinking: true })
        const sshConn = get().sshConnections.find((c) => c.id === get().activeSsh)
        const sshHost = sshConn ? `${sshConn.username}@${sshConn.host}` : undefined
        const base = buildSystemPrompt(sshHost)
        const systemPrompt = skillsBlock ? `${base}\n\n${skillsBlock}` : base
        const messages: LlmMessage[] = [{ role: 'system', content: systemPrompt }, ...get().convo]
        const result = await api.llm.chat(
          crypto.randomUUID(),
          { model: get().model, messages, tools: TOOLS },
          (delta) => {
            streamedChars += delta.length
            set((s) => ({
              thinkingTokens: tokensFromChars(streamedChars),
              messages: s.messages.map((m) => (m.id === replyId ? { ...m, text: m.text + delta } : m))
            }))
          }
        )
        set({ streamId: null, thinking: false, connection: result.ok ? 'connected' : get().connection })

        if (!result.ok) {
          finalStatus = 'error'
          const prev = get().messages.find((m) => m.id === replyId)?.text ?? ''
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
            workspaceId: active.id,
            workspaceName: active.name,
            taskId,
            provider: 'lmstudio',
            model: get().model || 'local-model',
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
          if (runAborted) break

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

          // For file changes, read the current file first so the card can show a diff.
          let oldContent = ''
          let newContent = ''
          if ((call.name === 'write_file' || call.name === 'edit_file') && asStr(call.args.path)) {
            const cur = await api.agent.readFile(root, asStr(call.args.path))
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
          const needsApproval = mutating && get().mode === 'ask'
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
              pendingApprovals.set(cardId, resolve)
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

          if (runAborted) {
            patch(cardId, { status: 'rejected' })
            break
          }

          // 4) Run the tool and record the outcome on the card + transcript.
          if (call.name === 'list_dir') {
            const r = await api.agent.listDir(root, asStr(call.args.path) || '.')
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
            const r = await api.agent.readFile(root, asStr(call.args.path), range)
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
            const r = await api.agent.search(
              root,
              asStr(call.args.query),
              asStr(call.args.path) || undefined
            )
            const hits = r.matches ?? []
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.ok
                ? hits.length
                  ? hits.map((mt) => `${mt.path}:${mt.line}: ${mt.text}`).join('\n')
                  : 'No matches.'
                : undefined,
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? hits.length
                  ? `${hits.length}${r.truncated ? '+' : ''} match(es) for "${asStr(call.args.query)}":\n` +
                    hits.map((mt) => `${mt.path}:${mt.line}: ${mt.text}`).join('\n') +
                    (r.truncated ? '\n…(more matches truncated)' : '')
                  : `No matches for "${asStr(call.args.query)}".`
                : `Error: ${r.error}`
            )
          } else if (call.name === 'edit_file') {
            const path = asStr(call.args.path)
            const r = await api.agent.editFile(
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
            const r = await api.agent.writeFile(root, path, asStr(call.args.content))
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
          } else {
            const command = asStr(call.args.command)
            // When an SSH session is open, run_command targets the remote host.
            const sshId = get().activeSsh
            const r = sshId
              ? await api.ssh.exec(sshId, command)
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

      if (!runAborted && get().convo.length > 0) {
        // Surface a hint if we bailed out at the step cap mid-task.
        const last = get().messages.at(-1)
        if (last?.kind === 'tool') {
          addMsg({
            id: crypto.randomUUID(), role: 'assistant', kind: 'text', model: assistantModel,
            text: '_Reached the tool-step limit for this task._'
          })
        }
      }
    } finally {
      set({ streaming: false, streamId: null, thinking: false, thinkingStartedAt: null })
      await get().saveActiveTask(finalStatus)
    }
  },

  approveTool(id) {
    const resolve = pendingApprovals.get(id)
    if (resolve) {
      pendingApprovals.delete(id)
      resolve(true)
    }
  },

  rejectTool(id) {
    const resolve = pendingApprovals.get(id)
    if (resolve) {
      pendingApprovals.delete(id)
      resolve(false)
    }
  },

  stopStreaming() {
    runAborted = true
    set({ thinking: false })
    const id = get().streamId
    if (id) {
      const p = get().provider
      if (p === 'codex') void api.codex.abort(id)
      else if (p === 'claude') void api.claude.abort(id)
      else if (p === 'glm') void api.glm.abort(id)
      else void api.llm.abort(id)
    }
    for (const [cardId, resolve] of pendingApprovals) {
      pendingApprovals.delete(cardId)
      resolve(false)
    }
  },

  newTask() {
    set({
      messages: [],
      convo: [],
      activeTaskId: null,
      activeTaskTitle: '',
      codexThreadId: null,
      claudeSessionId: null,
      glmSessionId: null,
      view: 'home'
    })
  }
}))
