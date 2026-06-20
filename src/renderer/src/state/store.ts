import { create } from 'zustand'
import type { Workspace, TreeNode, LlmMessage, ToolDef } from '@shared/ipc'
import { DEFAULT_LLM_CONFIG } from '@shared/ipc'
import { api } from '@/lib/api'

export type View = 'home' | 'workspace'
/** Agent permission mode — mirrors ZCode's "Ask before changes" control. */
export type AgentMode = 'ask' | 'auto'
export type Connection = 'unknown' | 'connecting' | 'connected' | 'error'

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
}

/** Lifecycle of a tool-call card in the chat. */
export type ToolStatus = 'awaiting' | 'running' | 'done' | 'rejected' | 'error'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** 'text' is an ordinary chat bubble; 'tool' is a tool-call card. */
  kind: 'text' | 'tool'
  text: string
  // ----- tool-card fields (kind === 'tool') -----
  tool?: string
  args?: Record<string, unknown>
  status?: ToolStatus
  /** Primary output / short summary shown on the card. */
  output?: string
  stderr?: string
  exitCode?: number | null
  /** write_file: previous + proposed content, for the inline diff. */
  oldContent?: string
  newContent?: string
  created?: boolean
  error?: string
}

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

interface AppState {
  view: View
  workspaces: Workspace[]
  active: Workspace | null

  treeRoots: TreeNode[]
  childrenByPath: Record<string, TreeNode[]>
  expanded: Record<string, boolean>
  treeLoading: boolean

  openFiles: OpenFile[]
  activeFile: string | null

  // LLM / LM Studio
  baseUrl: string
  model: string
  models: string[]
  connection: Connection
  connectionError?: string
  settingsOpen: boolean

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
  goHome: () => void
  toggleDir: (node: TreeNode) => Promise<void>
  openFile: (node: TreeNode) => Promise<void>
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void

  refreshModels: () => Promise<void>
  setModel: (m: string) => void
  setBaseUrl: (url: string) => Promise<void>
  setSettingsOpen: (open: boolean) => void

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
  active: null,
  treeRoots: [],
  childrenByPath: {},
  expanded: {},
  treeLoading: false,
  openFiles: [],
  activeFile: null,

  baseUrl: DEFAULT_LLM_CONFIG.baseUrl,
  model: '',
  models: [],
  connection: 'unknown',
  settingsOpen: false,

  mode: 'ask',
  messages: [],
  convo: [],
  streaming: false,
  streamId: null,

  async init() {
    const [workspaces, cfg] = await Promise.all([api.workspace.list(), api.llm.config()])
    set({ workspaces, baseUrl: cfg.baseUrl, model: cfg.model })
    if (workspaces.length > 0) await get().loadWorkspaceData(workspaces[0])
    await get().refreshModels()
  },

  async openFolder() {
    const ws = await api.dialog.openFolder()
    if (!ws) return
    const workspaces = await api.workspace.list()
    set({ workspaces })
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
    set({ view: 'workspace', messages: [], convo: [] })
  },

  goHome() {
    set({ view: 'home' })
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

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  setMode(mode) {
    set({ mode })
  },

  async submitTask(text) {
    const trimmed = text.trim()
    const active = get().active
    if (!trimmed || !active || get().streaming) return
    const root = active.path

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
      messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', kind: 'text', text: trimmed }],
      convo: [...s.convo, { role: 'user', content: trimmed }]
    }))

    try {
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
          const prev = get().messages.find((m) => m.id === replyId)?.text ?? ''
          patch(replyId, { text: prev ? `${prev}\n\n⚠ ${result.error}` : `⚠ ${result.error}` })
          break
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
    if (id) void api.llm.abort(id)
    for (const [cardId, resolve] of pendingApprovals) {
      pendingApprovals.delete(cardId)
      resolve(false)
    }
  },

  newTask() {
    set({ messages: [], convo: [], view: 'home' })
  }
}))
