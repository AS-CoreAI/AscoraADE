import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type TreeNode,
  type FileContent,
  type Workspace,
  type TaskSummary,
  type TaskRecord,
  type LlmConfig,
  type ChatParams,
  type ChatResult,
  type ChatChunkPayload,
  type ListModelsResult,
  type CodexCheckResult,
  type CodexRunParams,
  type CodexRunResult,
  type CodexEvent,
  type CodexEventPayload,
  type GitStatusResult,
  type GitDiffRequest,
  type GitDiffResult,
  type GitActionResult,
  type GitHistoryResult,
  type GitCommitFilesResult,
  type GitCommitDiffRequest,
  type TerminalStartOptions,
  type TerminalStartResult,
  type TerminalDataPayload,
  type TerminalExitPayload,
  type AgentListResult,
  type AgentReadResult,
  type AgentWriteResult,
  type AgentRunResult
} from '@shared/ipc'

/**
 * The single, typed surface the renderer is allowed to touch. Exposed on
 * `window.ascora` via contextBridge (context isolation is on).
 */
const api = {
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.window.minimize),
    maximizeToggle: (): Promise<boolean> => ipcRenderer.invoke(IPC.window.maximizeToggle),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.window.close),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.window.isMaximized)
  },
  dialog: {
    openFolder: (): Promise<Workspace | null> => ipcRenderer.invoke(IPC.dialog.openFolder)
  },
  fs: {
    readTree: (dir: string): Promise<TreeNode[]> => ipcRenderer.invoke(IPC.fs.readTree, dir),
    readFile: (file: string): Promise<FileContent> => ipcRenderer.invoke(IPC.fs.readFile, file)
  },
  settings: {
    get: <T = unknown>(key: string): Promise<T | undefined> =>
      ipcRenderer.invoke(IPC.settings.get, key),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke(IPC.settings.set, key, value),
    all: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(IPC.settings.all)
  },
  workspace: {
    list: (): Promise<Workspace[]> => ipcRenderer.invoke(IPC.workspace.list),
    add: (path: string): Promise<Workspace> => ipcRenderer.invoke(IPC.workspace.add, path),
    tasks: (workspaceId: string): Promise<TaskSummary[]> =>
      ipcRenderer.invoke(IPC.workspace.tasks, workspaceId),
    task: (taskId: string): Promise<TaskRecord | null> =>
      ipcRenderer.invoke(IPC.workspace.task, taskId),
    saveTask: (task: TaskRecord): Promise<TaskSummary> =>
      ipcRenderer.invoke(IPC.workspace.saveTask, task)
  },
  llm: {
    config: (): Promise<LlmConfig> => ipcRenderer.invoke(IPC.llm.config),
    setConfig: (patch: Partial<LlmConfig>): Promise<void> =>
      ipcRenderer.invoke(IPC.llm.setConfig, patch),
    listModels: (): Promise<ListModelsResult> => ipcRenderer.invoke(IPC.llm.listModels),
    /** Streams a chat completion; `onChunk` fires per content delta. */
    chat: (id: string, params: ChatParams, onChunk: (delta: string) => void): Promise<ChatResult> => {
      const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload): void => {
        if (payload.id === id) onChunk(payload.delta)
      }
      ipcRenderer.on(IPC.llm.chunk, listener)
      return ipcRenderer
        .invoke(IPC.llm.chat, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.llm.chunk, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.llm.abort, id)
  },
  codex: {
    check: (): Promise<CodexCheckResult> => ipcRenderer.invoke(IPC.codex.check),
    /** Runs a Codex turn; `onEvent` fires per normalized stream event. */
    run: (
      id: string,
      params: CodexRunParams,
      onEvent: (event: CodexEvent) => void
    ): Promise<CodexRunResult> => {
      const listener = (_e: IpcRendererEvent, payload: CodexEventPayload): void => {
        if (payload.id === id) onEvent(payload.event)
      }
      ipcRenderer.on(IPC.codex.event, listener)
      return ipcRenderer
        .invoke(IPC.codex.run, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.codex.event, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.codex.abort, id)
  },
  git: {
    status: (cwd: string): Promise<GitStatusResult> => ipcRenderer.invoke(IPC.git.status, cwd),
    diff: (cwd: string, request?: GitDiffRequest): Promise<GitDiffResult> =>
      ipcRenderer.invoke(IPC.git.diff, cwd, request),
    stage: (cwd: string, path?: string): Promise<GitActionResult> =>
      ipcRenderer.invoke(IPC.git.stage, cwd, path),
    unstage: (cwd: string, path?: string): Promise<GitActionResult> =>
      ipcRenderer.invoke(IPC.git.unstage, cwd, path),
    discard: (cwd: string, path: string): Promise<GitActionResult> =>
      ipcRenderer.invoke(IPC.git.discard, cwd, path),
    commit: (cwd: string, message: string): Promise<GitActionResult> =>
      ipcRenderer.invoke(IPC.git.commit, cwd, message),
    push: (cwd: string): Promise<GitActionResult> => ipcRenderer.invoke(IPC.git.push, cwd),
    fetch: (cwd: string): Promise<GitActionResult> => ipcRenderer.invoke(IPC.git.fetch, cwd),
    history: (cwd: string): Promise<GitHistoryResult> => ipcRenderer.invoke(IPC.git.history, cwd),
    commitFiles: (cwd: string, commit: string): Promise<GitCommitFilesResult> =>
      ipcRenderer.invoke(IPC.git.commitFiles, cwd, commit),
    commitDiff: (cwd: string, request: GitCommitDiffRequest): Promise<GitDiffResult> =>
      ipcRenderer.invoke(IPC.git.commitDiff, cwd, request)
  },
  terminal: {
    start: (id: string, opts: TerminalStartOptions): Promise<TerminalStartResult> =>
      ipcRenderer.invoke(IPC.terminal.start, id, opts),
    input: (id: string, data: string): Promise<void> =>
      ipcRenderer.invoke(IPC.terminal.input, id, data),
    kill: (id: string): Promise<void> => ipcRenderer.invoke(IPC.terminal.kill, id),
    /** Subscribe to shell output. Returns an unsubscribe function. */
    onData: (id: string, cb: (data: string) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: TerminalDataPayload): void => {
        if (p.id === id) cb(p.data)
      }
      ipcRenderer.on(IPC.terminal.data, listener)
      return () => ipcRenderer.removeListener(IPC.terminal.data, listener)
    },
    /** Subscribe to shell exit. Returns an unsubscribe function. */
    onExit: (id: string, cb: (code: number | null) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: TerminalExitPayload): void => {
        if (p.id === id) cb(p.code)
      }
      ipcRenderer.on(IPC.terminal.exit, listener)
      return () => ipcRenderer.removeListener(IPC.terminal.exit, listener)
    }
  },
  agent: {
    listDir: (root: string, path: string): Promise<AgentListResult> =>
      ipcRenderer.invoke(IPC.agent.listDir, root, path),
    readFile: (root: string, path: string): Promise<AgentReadResult> =>
      ipcRenderer.invoke(IPC.agent.readFile, root, path),
    writeFile: (root: string, path: string, content: string): Promise<AgentWriteResult> =>
      ipcRenderer.invoke(IPC.agent.writeFile, root, path, content),
    runCommand: (root: string, command: string): Promise<AgentRunResult> =>
      ipcRenderer.invoke(IPC.agent.runCommand, root, command)
  },
  system: {
    platform: process.platform
  }
}

export type AscoraApi = typeof api

contextBridge.exposeInMainWorld('ascora', api)
