import { create } from 'zustand'
import type {
  Workspace,
  TreeNode,
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

const TOOL_NAMES = ['list_dir', 'read_file', 'write_file', 'run_command'] as const
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
      description: 'Read a UTF-8 text file from the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Workspace-relative file path.' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a workspace file with the given full content.',
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

const SYSTEM_PROMPT = [
  'You are Ascora, an AI coding agent embedded in a desktop IDE, working inside the',
  "user's open project folder via a local LLM (LM Studio).",
  '',
  'You can use tools to inspect and change the project:',
  '- list_dir(path): list a directory ("." is the project root)',
  '- read_file(path): read a text file',
  '- write_file(path, content): create/overwrite a file with its FULL new content',
  '- run_command(command): run a shell command in the project root and read its output',
  '',
  'All paths are relative to the project root. Work step by step: call one tool at a',
  'time, wait for its result, then decide the next step. Read a file before editing it,',
  'and always write back the complete file (these tools do not apply patches). When the',
  'task is done, reply with a short plain-text summary and NO tool call.',
  '',
  'If you cannot emit native tool calls, request a tool by replying with ONLY a fenced',
  'block in this exact format (no prose around it):',
  '```tool_call',
  '{"tool": "read_file", "args": {"path": "package.json"}}',
  '```'
].join('\n')

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
  return Math.max(0, Math.round((text?.length ?? 0) / 4))
}

function taskTitle(text: string): string {
  const title = text.replace(/\s+/g, ' ').trim()
  return title.length > 72 ? `${title.slice(0, 69)}...` : title
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
    return {
      tool: 'apply_patch',
      args: { path: `${changes.length} file${changes.length === 1 ? '' : 's'}` },
      status,
      output: changes.map((c) => `${c.kind} ${baseName(c.path)}`).join('\n')
    }
  }
  // Unknown / other item type (incl. Claude's read_file/list_dir/etc.) — show
  // it generically with a short summary in the header.
  return { tool: it.type, args: { path: it.text ?? '' }, status }
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

  // LLM provider
  provider: LlmProvider
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

  mode: AgentMode
  messages: ChatMessage[]
  /** Raw LLM transcript (user/assistant/tool turns) driving multi-turn context. */
  convo: LlmMessage[]
  streaming: boolean
  streamId: string | null

  init: () => Promise<void>
  openFolder: () => Promise<void>
  loadWorkspaceData: (ws: Workspace) => Promise<void>
  openWorkspace: (ws: Workspace) => Promise<void>
  toggleWorkspaceCollapsed: (id: string) => void
  reorderWorkspaces: (draggedId: string, targetId: string) => void
  openTask: (ws: Workspace, taskId: string) => Promise<void>
  saveActiveTask: (status: TaskSummary['status']) => Promise<void>
  goHome: () => void
  openAnalytics: () => void
  closeAnalytics: () => void
  toggleDir: (node: TreeNode) => Promise<void>
  openFile: (node: TreeNode) => Promise<void>
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void

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
  setSettingsOpen: (open: boolean) => void
  setThemePreference: (theme: ThemePreference) => void
  syncSystemTheme: () => void

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

  provider: DEFAULT_LLM_CONFIG.provider,
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

  mode: 'ask',
  messages: [],
  convo: [],
  streaming: false,
  streamId: null,

  async init() {
    const [workspaces, cfg, savedTheme, savedOrder, savedCollapsed] = await Promise.all([
      api.workspace.list(),
      api.llm.config(),
      api.settings.get<ThemePreference>('appearance.theme'),
      api.settings.get<string[]>('workspace.order'),
      api.settings.get<Record<string, boolean>>('workspace.collapsed')
    ])
    const workspaceOrder = Array.isArray(savedOrder) ? savedOrder : []
    const collapsedWorkspaces =
      savedCollapsed && typeof savedCollapsed === 'object' ? savedCollapsed : {}
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
      tasksByWorkspace: Object.fromEntries(taskLists),
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
    if (ordered.length > 0) await get().loadWorkspaceData(ordered[0])
    await get().refreshModels()
    if (cfg.provider === 'codex') await get().checkCodex()
    if (cfg.provider === 'claude') await get().checkClaude()
    if (cfg.provider === 'glm') await get().checkGlm()
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
    if (get().streaming) return
    const task = await api.workspace.task(taskId)
    if (!task || task.workspaceId !== ws.id) return
    if (get().active?.id !== ws.id) await get().loadWorkspaceData(ws)
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

  closeFile(path) {
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      const activeFile = s.activeFile === path ? (openFiles.at(-1)?.path ?? null) : s.activeFile
      return { openFiles, activeFile }
    })
  },

  setActiveFile(path) {
    set({ activeFile: path })
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
  },

  async setBaseUrl(url) {
    set({ baseUrl: url })
    await api.llm.setConfig({ baseUrl: url })
    await get().refreshModels()
  },

  async setProvider(provider) {
    set({ provider })
    await api.llm.setConfig({ provider })
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
  },

  setCodexSandbox(codexSandbox) {
    set({ codexSandbox })
    void api.llm.setConfig({ codexSandbox })
  },

  setCodexReasoning(codexReasoning) {
    set({ codexReasoning })
    void api.llm.setConfig({ codexReasoning })
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
  },

  setClaudePermission(claudePermission) {
    set({ claudePermission })
    void api.llm.setConfig({ claudePermission })
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
    const patch = (id: string, p: Partial<ChatMessage>): void =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }))
    const addMsg = (m: ChatMessage): void => set((s) => ({ messages: [...s.messages, m] }))
    const removeMsg = (id: string): void =>
      set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }))
    const pushConvo = (m: LlmMessage): void => set((s) => ({ convo: [...s.convo, m] }))

    set((s) => ({
      view: 'workspace',
      streaming: true,
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
        let sawError = false

        const handleEvent = (event: CodexEvent): void => {
          if (runAborted) return
          if (event.kind === 'thread') {
            if (event.threadId) setSession(event.threadId)
          } else if (event.kind === 'item') {
            const it = event.item
            if (it.type === 'reasoning') {
              const text = (it.text ?? '').trim()
              if (!text) return
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
                addMsg({ id: crypto.randomUUID(), role: 'assistant', kind: 'text', text: it.text.trim() })
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
            addMsg({ id: crypto.randomUUID(), role: 'assistant', kind: 'text', text: `⚠ ${event.message}` })
          }
        }

        const res = isGlm
          ? await api.glm.run(
              runId,
              {
                prompt: trimmed,
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
                  prompt: trimmed,
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
                  prompt: trimmed,
                  cwd: root,
                  threadId: get().codexThreadId ?? undefined,
                  model: get().codexModel || undefined,
                  sandbox: get().codexSandbox,
                  reasoning: get().codexReasoning || undefined
                },
                handleEvent
              )

        set({ streamId: null })
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
        addMsg({ id: replyId, role: 'assistant', kind: 'text', text: '' })
        set({ streamId: replyId })
        const messages: LlmMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...get().convo]
        const result = await api.llm.chat(
          crypto.randomUUID(),
          { model: get().model, messages, tools: TOOLS },
          (delta) =>
            set((s) => ({
              messages: s.messages.map((m) => (m.id === replyId ? { ...m, text: m.text + delta } : m))
            }))
        )
        set({ streamId: null, connection: result.ok ? 'connected' : get().connection })

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
          const mutating = call.name === 'write_file' || call.name === 'run_command'

          // For edits, read the current file first so the card can show a diff.
          let oldContent = ''
          if (call.name === 'write_file' && asStr(call.args.path)) {
            const cur = await api.agent.readFile(root, asStr(call.args.path))
            oldContent = cur.ok && !cur.truncated ? (cur.content ?? '') : ''
          }

          const needsApproval = mutating && get().mode === 'ask'
          addMsg({
            id: cardId, role: 'assistant', kind: 'tool', text: '',
            tool: call.name, args: call.args,
            status: needsApproval ? 'awaiting' : 'running',
            ...(call.name === 'write_file'
              ? { oldContent, newContent: asStr(call.args.content) }
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
            const r = await api.agent.readFile(root, asStr(call.args.path))
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.ok
                ? r.truncated
                  ? 'binary or too large'
                  : `${(r.content ?? '').split('\n').length} lines`
                : undefined,
              error: r.error
            })
            appendResult(
              call,
              r.ok
                ? r.truncated
                  ? `(${r.path} is binary or too large to read)`
                  : `Contents of ${r.path}:\n${r.content}`
                : `Error: ${r.error}`
            )
          } else if (call.name === 'write_file') {
            const r = await api.agent.writeFile(root, asStr(call.args.path), asStr(call.args.content))
            patch(cardId, { status: r.ok ? 'done' : 'error', created: r.created, error: r.error })
            appendResult(
              call,
              r.ok ? `${r.created ? 'Created' : 'Updated'} ${r.path} (${r.bytes} bytes).` : `Error: ${r.error}`
            )
          } else {
            const r = await api.agent.runCommand(root, asStr(call.args.command))
            patch(cardId, {
              status: r.ok ? 'done' : 'error',
              output: r.stdout,
              stderr: r.stderr,
              exitCode: r.timedOut ? null : r.code,
              error: r.error
            })
            const head = r.timedOut ? 'Exit: killed (timeout)' : `Exit code: ${r.code}`
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
            id: crypto.randomUUID(), role: 'assistant', kind: 'text',
            text: '_Reached the tool-step limit for this task._'
          })
        }
      }
    } finally {
      set({ streaming: false, streamId: null })
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
