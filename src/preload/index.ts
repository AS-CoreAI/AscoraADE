import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type TreeNode,
  type AttachmentImportResult,
  type FileContent,
  type FileActionResult,
  type LiveServerResult,
  type SshConnection,
  type SshConnectResult,
  type SshExecResult,
  type SshSize,
  type SshDataPayload,
  type SshExitPayload,
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
  type CodexUsageResult,
  type CopilotLoginResult,
  type CopilotRunParams,
  type ClaudeRunParams,
  type ClaudeUsageResult,
  type GeminiRunParams,
  type GrokRunParams,
  type GlmRunParams,
  type GlmCaptchaConfigResult,
  type WProviderChatParams,
  type WProviderAuthorization,
  type WProviderCheckResult,
  type WProviderLoginResult,
  type WProviderService,
  type OmnirouteAdminRequest,
  type OmnirouteAdminResponse,
  type OmnirouteLiveConnectRequest,
  type OmnirouteLiveEvent,
  type OmnirouteStatus,
  type BlueprintDefinition,
  type BlueprintEvent,
  type BlueprintRunRequest,
  type BlueprintRunResult,
  type UsageEvent,
  type UsageEventInput,
  type GitStatusResult,
  type GitDiffRequest,
  type GitDiffResult,
  type GitActionResult,
  type GitBranchesResult,
  type GitHistoryResult,
  type GitCommitFilesResult,
  type GitCommitDiffRequest,
  type TerminalStartOptions,
  type TerminalStartResult,
  type TerminalDataPayload,
  type TerminalExitPayload,
  type DeveloperToolId,
  type DeveloperToolsInfo,
  type DeveloperToolsInstallResult,
  type AgentListResult,
  type AgentReadRange,
  type AgentReadResult,
  type AgentWriteResult,
  type AgentEditResult,
  type AgentSearchOptions,
  type AgentSearchResult,
  type AgentRunResult,
  type WebFetchResult,
  type WebSearchResult,
  type PublicIpStatus,
  type VpnConfigureRequest,
  type VpnConnectRequest,
  type VpnAuthRequest,
  type VpnAuthResult,
  type VpnServersResult,
  type VpnStatus,
  type VpnTrafficResult,
  type VpnPaymentCreateResult,
  type VpnPaymentPlanCode,
  type VpnPaymentSyncResult,
  type UpdateInfo,
  type ChangelogInfo
} from '@shared/ipc'

let lastDroppedFilePaths: string[] = []

function safeFilePath(file: File): string {
  try {
    return webUtils.getPathForFile(file)
  } catch {
    return ''
  }
}

const preloadWindow = globalThis as typeof globalThis & {
  addEventListener?: (
    type: string,
    listener: (event: { dataTransfer?: { files?: ArrayLike<File> } }) => void,
    options?: boolean
  ) => void
}

preloadWindow.addEventListener?.('dragenter', () => {
  lastDroppedFilePaths = []
}, true)

preloadWindow.addEventListener?.(
  'drop',
  (event) => {
    lastDroppedFilePaths = Array.from(event.dataTransfer?.files ?? []).map(safeFilePath).filter(Boolean)
  },
  true
)

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
    openFolder: (): Promise<Workspace | null> => ipcRenderer.invoke(IPC.dialog.openFolder),
    openFiles: (): Promise<string[] | null> => ipcRenderer.invoke(IPC.dialog.openFiles)
  },
  fs: {
    readTree: (dir: string): Promise<TreeNode[]> => ipcRenderer.invoke(IPC.fs.readTree, dir),
    readFile: (file: string): Promise<FileContent> => ipcRenderer.invoke(IPC.fs.readFile, file),
    openPath: (dir: string): Promise<string> => ipcRenderer.invoke(IPC.fs.openPath, dir),
    importFiles: (root: string, filePaths: string[]): Promise<AttachmentImportResult> =>
      ipcRenderer.invoke(IPC.fs.importFiles, root, filePaths),
    movePath: (source: string, targetDirectory: string): Promise<FileActionResult> =>
      ipcRenderer.invoke(IPC.fs.movePath, source, targetDirectory),
    renameFile: (file: string, newName: string): Promise<FileActionResult> =>
      ipcRenderer.invoke(IPC.fs.renameFile, file, newName),
    deleteFile: (file: string): Promise<FileActionResult> =>
      ipcRenderer.invoke(IPC.fs.deleteFile, file),
    createFile: (parent: string, name: string): Promise<FileActionResult> =>
      ipcRenderer.invoke(IPC.fs.createFile, parent, name),
    createDirectory: (parent: string, name: string): Promise<FileActionResult> =>
      ipcRenderer.invoke(IPC.fs.createDirectory, parent, name),
    renameDirectory: (dir: string, newName: string): Promise<FileActionResult> =>
      ipcRenderer.invoke(IPC.fs.renameDirectory, dir, newName),
    deleteDirectory: (dir: string): Promise<FileActionResult> =>
      ipcRenderer.invoke(IPC.fs.deleteDirectory, dir)
  },
  ssh: {
    connect: (id: string, config: SshConnection, size?: SshSize): Promise<SshConnectResult> =>
      ipcRenderer.invoke(IPC.ssh.connect, id, config, size),
    input: (id: string, data: string): Promise<void> => ipcRenderer.invoke(IPC.ssh.input, id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IPC.ssh.resize, id, cols, rows),
    disconnect: (id: string): Promise<void> => ipcRenderer.invoke(IPC.ssh.disconnect, id),
    exec: (id: string, command: string): Promise<SshExecResult> =>
      ipcRenderer.invoke(IPC.ssh.exec, id, command),
    run: (id: string, command: string): Promise<SshExecResult> =>
      ipcRenderer.invoke(IPC.ssh.run, id, command),
    /** Toggle whether exec commands run via sudo (operate on the remote as root). */
    setElevation: (id: string, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.ssh.setElevation, id, enabled),
    pickKey: (): Promise<string | null> => ipcRenderer.invoke(IPC.ssh.pickKey),
    /** Subscribe to remote shell output. Returns an unsubscribe function. */
    onData: (id: string, cb: (data: string) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: SshDataPayload): void => {
        if (p.id === id) cb(p.data)
      }
      ipcRenderer.on(IPC.ssh.data, listener)
      return () => ipcRenderer.removeListener(IPC.ssh.data, listener)
    },
    /** Subscribe to session exit. Returns an unsubscribe function. */
    onExit: (id: string, cb: (code: number | null, error?: string) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: SshExitPayload): void => {
        if (p.id === id) cb(p.code, p.error)
      }
      ipcRenderer.on(IPC.ssh.exit, listener)
      return () => ipcRenderer.removeListener(IPC.ssh.exit, listener)
    }
  },
  live: {
    start: (root: string): Promise<LiveServerResult> => ipcRenderer.invoke(IPC.live.start, root),
    stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.live.stop),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.live.openExternal, url),
    openWindow: (url: string): Promise<void> => ipcRenderer.invoke(IPC.live.openWindow, url),
    closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.live.closeWindow),
    /** Fires when the detached preview window is closed. Returns an unsubscribe fn. */
    onWindowClosed: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.live.windowClosed, listener)
      return () => ipcRenderer.removeListener(IPC.live.windowClosed, listener)
    }
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
    listArchived: (): Promise<Workspace[]> => ipcRenderer.invoke(IPC.workspace.listArchived),
    add: (path: string): Promise<Workspace> => ipcRenderer.invoke(IPC.workspace.add, path),
    rename: (id: string, name: string): Promise<Workspace | null> =>
      ipcRenderer.invoke(IPC.workspace.rename, id, name),
    archive: (id: string): Promise<Workspace | null> =>
      ipcRenderer.invoke(IPC.workspace.archive, id),
    restore: (id: string): Promise<Workspace | null> =>
      ipcRenderer.invoke(IPC.workspace.restore, id),
    tasks: (workspaceId: string, deletedOnly = false): Promise<TaskSummary[]> =>
      ipcRenderer.invoke(IPC.workspace.tasks, workspaceId, deletedOnly),
    task: (taskId: string, includeDeleted = false): Promise<TaskRecord | null> =>
      ipcRenderer.invoke(IPC.workspace.task, taskId, includeDeleted),
    saveTask: (task: TaskRecord): Promise<TaskSummary> =>
      ipcRenderer.invoke(IPC.workspace.saveTask, task),
    deleteTask: (taskId: string): Promise<TaskSummary | null> =>
      ipcRenderer.invoke(IPC.workspace.deleteTask, taskId),
    restoreTask: (taskId: string): Promise<TaskSummary | null> =>
      ipcRenderer.invoke(IPC.workspace.restoreTask, taskId)
  },
  llm: {
    config: (): Promise<LlmConfig> => ipcRenderer.invoke(IPC.llm.config),
    setConfig: (patch: Partial<LlmConfig>): Promise<void> =>
      ipcRenderer.invoke(IPC.llm.setConfig, patch),
    listModels: (): Promise<ListModelsResult> => ipcRenderer.invoke(IPC.llm.listModels),
    /** Probe whether the local LM Studio server is reachable, regardless of the
     *  active provider — drives showing/hiding LM Studio in the backend list. */
    checkLmStudio: (): Promise<boolean> => ipcRenderer.invoke(IPC.llm.checkLmStudio),
    /** Same probe for the local Ollama server. */
    checkOllama: (): Promise<boolean> => ipcRenderer.invoke(IPC.llm.checkOllama),
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
    /** Opens a terminal running `codex login` (browser OAuth flow). */
    login: (): Promise<CopilotLoginResult> => ipcRenderer.invoke(IPC.codex.login),
    /** Signs the Codex CLI out (`codex logout`). */
    logout: (): Promise<CopilotLoginResult> => ipcRenderer.invoke(IPC.codex.logout),
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
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.codex.abort, id),
    /** Read the user's Codex account rate limits through the CLI app-server. */
    usage: (): Promise<CodexUsageResult> => ipcRenderer.invoke(IPC.codex.usage)
  },
  copilot: {
    check: (verifyAuth = false): Promise<CodexCheckResult> => ipcRenderer.invoke(IPC.copilot.check, verifyAuth),
    login: (): Promise<CopilotLoginResult> => ipcRenderer.invoke(IPC.copilot.login),
    /** Runs a GitHub Copilot CLI turn; `onEvent` fires per normalized stream event. */
    run: (
      id: string,
      params: CopilotRunParams,
      onEvent: (event: CodexEvent) => void
    ): Promise<CodexRunResult> => {
      const listener = (_e: IpcRendererEvent, payload: CodexEventPayload): void => {
        if (payload.id === id) onEvent(payload.event)
      }
      ipcRenderer.on(IPC.copilot.event, listener)
      return ipcRenderer
        .invoke(IPC.copilot.run, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.copilot.event, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.copilot.abort, id)
  },
  claude: {
    check: (): Promise<CodexCheckResult> => ipcRenderer.invoke(IPC.claude.check),
    /** Opens a terminal running `claude /login`. */
    login: (): Promise<CopilotLoginResult> => ipcRenderer.invoke(IPC.claude.login),
    /** Removes the stored Claude Code credentials (same effect as `/logout`). */
    logout: (): Promise<CopilotLoginResult> => ipcRenderer.invoke(IPC.claude.logout),
    /** Runs a Claude Code turn; `onEvent` fires per normalized stream event. */
    run: (
      id: string,
      params: ClaudeRunParams,
      onEvent: (event: CodexEvent) => void
    ): Promise<CodexRunResult> => {
      const listener = (_e: IpcRendererEvent, payload: CodexEventPayload): void => {
        if (payload.id === id) onEvent(payload.event)
      }
      ipcRenderer.on(IPC.claude.event, listener)
      return ipcRenderer
        .invoke(IPC.claude.run, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.claude.event, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.claude.abort, id),
    /** Read the user's Claude subscription usage limits (`/api/oauth/usage`). */
    usage: (): Promise<ClaudeUsageResult> => ipcRenderer.invoke(IPC.claude.usage)
  },
  gemini: {
    check: (): Promise<CodexCheckResult> => ipcRenderer.invoke(IPC.gemini.check),
    /** Runs a Gemini CLI turn; `onEvent` fires per normalized stream event. */
    run: (
      id: string,
      params: GeminiRunParams,
      onEvent: (event: CodexEvent) => void
    ): Promise<CodexRunResult> => {
      const listener = (_e: IpcRendererEvent, payload: CodexEventPayload): void => {
        if (payload.id === id) onEvent(payload.event)
      }
      ipcRenderer.on(IPC.gemini.event, listener)
      return ipcRenderer
        .invoke(IPC.gemini.run, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.gemini.event, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.gemini.abort, id)
  },
  grok: {
    check: (): Promise<CodexCheckResult> => ipcRenderer.invoke(IPC.grok.check),
    /** Opens a terminal running `grok login` (browser OAuth / SuperGrok). */
    login: (): Promise<CopilotLoginResult> => ipcRenderer.invoke(IPC.grok.login),
    /** Signs the Grok CLI out (`grok logout`). */
    logout: (): Promise<CopilotLoginResult> => ipcRenderer.invoke(IPC.grok.logout),
    /** Runs a Grok Build turn; `onEvent` fires per normalized stream event. */
    run: (
      id: string,
      params: GrokRunParams,
      onEvent: (event: CodexEvent) => void
    ): Promise<CodexRunResult> => {
      const listener = (_e: IpcRendererEvent, payload: CodexEventPayload): void => {
        if (payload.id === id) onEvent(payload.event)
      }
      ipcRenderer.on(IPC.grok.event, listener)
      return ipcRenderer
        .invoke(IPC.grok.run, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.grok.event, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.grok.abort, id)
  },
  glm: {
    check: (): Promise<CodexCheckResult> => ipcRenderer.invoke(IPC.glm.check),
    captchaConfig: (): Promise<GlmCaptchaConfigResult> => ipcRenderer.invoke(IPC.glm.captchaConfig),
    /** Runs a GLM/ZCode turn; `onEvent` fires per normalized stream event. */
    run: (
      id: string,
      params: GlmRunParams,
      onEvent: (event: CodexEvent) => void
    ): Promise<CodexRunResult> => {
      const listener = (_e: IpcRendererEvent, payload: CodexEventPayload): void => {
        if (payload.id === id) onEvent(payload.event)
      }
      ipcRenderer.on(IPC.glm.event, listener)
      return ipcRenderer
        .invoke(IPC.glm.run, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.glm.event, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.glm.abort, id)
  },
  wprovider: {
    /** Cheap persisted list of web services whose authorization was confirmed. */
    authorizations: (): Promise<WProviderAuthorization[]> =>
      ipcRenderer.invoke(IPC.wprovider.authorizations),
    /** Keep settings in sync when login, logout, a check or a chat confirms authorization. */
    onAuthorizationsChanged: (
      cb: (authorizations: WProviderAuthorization[]) => void
    ): (() => void) => {
      const listener = (_e: IpcRendererEvent, authorizations: WProviderAuthorization[]): void =>
        cb(authorizations)
      ipcRenderer.on(IPC.wprovider.authorizationsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.wprovider.authorizationsChanged, listener)
    },
    /** Probe the persisted web session for a signed-in state (defaults to the configured service). */
    check: (service?: WProviderService): Promise<WProviderCheckResult> =>
      ipcRenderer.invoke(IPC.wprovider.check, service),
    /** Open a visible browser window to sign in; resolves once signed in (or closed). */
    login: (): Promise<WProviderLoginResult> => ipcRenderer.invoke(IPC.wprovider.login),
    /** Clear the web session (cookies + storage) and forget site chats. */
    logout: (): Promise<WProviderCheckResult> => ipcRenderer.invoke(IPC.wprovider.logout),
    /** Runs one turn through the hidden web chat; `onChunk` fires per answer
     *  delta and also carries the full reasoning text whenever it grows. */
    chat: (
      id: string,
      params: WProviderChatParams,
      onChunk: (delta: string, thinking?: string) => void
    ): Promise<ChatResult> => {
      const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload): void => {
        if (payload.id === id) onChunk(payload.delta, payload.thinking)
      }
      ipcRenderer.on(IPC.wprovider.chunk, listener)
      return ipcRenderer
        .invoke(IPC.wprovider.chat, id, params)
        .finally(() => ipcRenderer.removeListener(IPC.wprovider.chunk, listener))
    },
    abort: (id: string): Promise<void> => ipcRenderer.invoke(IPC.wprovider.abort, id)
  },
  omniroute: {
    status: (): Promise<OmnirouteStatus> => ipcRenderer.invoke(IPC.omniroute.status),
    start: (): Promise<OmnirouteStatus> => ipcRenderer.invoke(IPC.omniroute.start),
    stop: (): Promise<OmnirouteStatus> => ipcRenderer.invoke(IPC.omniroute.stop),
    admin: (request: OmnirouteAdminRequest): Promise<OmnirouteAdminResponse> =>
      ipcRenderer.invoke(IPC.omniroute.admin, request),
    liveConnect: (request: OmnirouteLiveConnectRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.omniroute.liveConnect, request),
    liveDisconnect: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.omniroute.liveDisconnect, id),
    onLiveEvent: (cb: (event: OmnirouteLiveEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: OmnirouteLiveEvent): void => cb(payload)
      ipcRenderer.on(IPC.omniroute.liveEvent, listener)
      return () => ipcRenderer.removeListener(IPC.omniroute.liveEvent, listener)
    },
    onStatusChanged: (cb: (status: OmnirouteStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: OmnirouteStatus): void => cb(status)
      ipcRenderer.on(IPC.omniroute.statusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.omniroute.statusChanged, listener)
    }
  },
  blueprint: {
    list: (): Promise<BlueprintDefinition[]> => ipcRenderer.invoke(IPC.blueprint.list),
    save: (blueprint: BlueprintDefinition): Promise<BlueprintDefinition> =>
      ipcRenderer.invoke(IPC.blueprint.save, blueprint),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.blueprint.remove, id),
    run: (request: BlueprintRunRequest): Promise<BlueprintRunResult> =>
      ipcRenderer.invoke(IPC.blueprint.run, request),
    stop: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.blueprint.stop, id),
    onEvent: (cb: (event: BlueprintEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: BlueprintEvent): void => cb(payload)
      ipcRenderer.on(IPC.blueprint.event, listener)
      return () => ipcRenderer.removeListener(IPC.blueprint.event, listener)
    }
  },
  analytics: {
    record: (event: UsageEventInput): Promise<UsageEvent> =>
      ipcRenderer.invoke(IPC.analytics.record, event),
    list: (): Promise<UsageEvent[]> => ipcRenderer.invoke(IPC.analytics.list)
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
    pull: (cwd: string): Promise<GitActionResult> => ipcRenderer.invoke(IPC.git.pull, cwd),
    fetch: (cwd: string): Promise<GitActionResult> => ipcRenderer.invoke(IPC.git.fetch, cwd),
    branches: (cwd: string): Promise<GitBranchesResult> => ipcRenderer.invoke(IPC.git.branches, cwd),
    checkout: (cwd: string, branch: string): Promise<GitActionResult> =>
      ipcRenderer.invoke(IPC.git.checkout, cwd, branch),
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
  developerTools: {
    inspect: (): Promise<DeveloperToolsInfo> => ipcRenderer.invoke(IPC.developerTools.inspect),
    install: (ids: DeveloperToolId[]): Promise<DeveloperToolsInstallResult> =>
      ipcRenderer.invoke(IPC.developerTools.install, ids)
  },
  agent: {
    listDir: (root: string, path: string): Promise<AgentListResult> =>
      ipcRenderer.invoke(IPC.agent.listDir, root, path),
    readFile: (root: string, path: string, range?: AgentReadRange): Promise<AgentReadResult> =>
      ipcRenderer.invoke(IPC.agent.readFile, root, path, range),
    writeFile: (root: string, path: string, content: string): Promise<AgentWriteResult> =>
      ipcRenderer.invoke(IPC.agent.writeFile, root, path, content),
    editFile: (
      root: string,
      path: string,
      oldString: string,
      newString: string,
      replaceAll: boolean
    ): Promise<AgentEditResult> =>
      ipcRenderer.invoke(IPC.agent.editFile, root, path, oldString, newString, replaceAll),
    search: (root: string, query: string, options?: AgentSearchOptions): Promise<AgentSearchResult> =>
      ipcRenderer.invoke(IPC.agent.search, root, query, options),
    runCommand: (root: string, command: string): Promise<AgentRunResult> =>
      ipcRenderer.invoke(IPC.agent.runCommand, root, command),
    runTypescript: (root: string, code: string): Promise<AgentRunResult> =>
      ipcRenderer.invoke(IPC.agent.runTypescript, root, code)
  },
  web: {
    fetch: (url: string, maxChars?: number): Promise<WebFetchResult> =>
      ipcRenderer.invoke(IPC.web.fetch, url, maxChars),
    search: (query: string): Promise<WebSearchResult> => ipcRenderer.invoke(IPC.web.search, query)
  },
  network: {
    publicIp: (force = false): Promise<PublicIpStatus> =>
      ipcRenderer.invoke(IPC.network.publicIp, force),
    onStatusChanged: (cb: (status: PublicIpStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: PublicIpStatus): void => cb(status)
      ipcRenderer.on(IPC.network.statusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.network.statusChanged, listener)
    }
  },
  vpn: {
    status: (forceDependencies = false): Promise<VpnStatus> =>
      ipcRenderer.invoke(IPC.vpn.status, forceDependencies),
    servers: (force = false): Promise<VpnServersResult> =>
      ipcRenderer.invoke(IPC.vpn.servers, force),
    connect: (request: VpnConnectRequest): Promise<VpnStatus> =>
      ipcRenderer.invoke(IPC.vpn.connect, request),
    disconnect: (): Promise<VpnStatus> => ipcRenderer.invoke(IPC.vpn.disconnect),
    configure: (request: VpnConfigureRequest): Promise<VpnStatus> =>
      ipcRenderer.invoke(IPC.vpn.configure, request),
    login: (request: VpnAuthRequest): Promise<VpnAuthResult> =>
      ipcRenderer.invoke(IPC.vpn.login, request),
    register: (request: VpnAuthRequest): Promise<VpnAuthResult> =>
      ipcRenderer.invoke(IPC.vpn.register, request),
    logout: (): Promise<VpnAuthResult> => ipcRenderer.invoke(IPC.vpn.logout),
    traffic: (): Promise<VpnTrafficResult> => ipcRenderer.invoke(IPC.vpn.traffic),
    paymentCreate: (planCode: VpnPaymentPlanCode): Promise<VpnPaymentCreateResult> =>
      ipcRenderer.invoke(IPC.vpn.paymentCreate, planCode),
    paymentSync: (paymentId: string): Promise<VpnPaymentSyncResult> =>
      ipcRenderer.invoke(IPC.vpn.paymentSync, paymentId),
    onStatusChanged: (cb: (status: VpnStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: VpnStatus): void => cb(status)
      ipcRenderer.on(IPC.vpn.statusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.vpn.statusChanged, listener)
    }
  },
  update: {
    /** Probe release feeds for a newer build. */
    check: (): Promise<UpdateInfo> => ipcRenderer.invoke(IPC.update.check),
    /** Fetch the changelog of releases newer than this build for the update modal. */
    changelog: (): Promise<ChangelogInfo> => ipcRenderer.invoke(IPC.update.changelog),
    /** Open the download page (or a specific URL) in the system browser. */
    openDownload: (url?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.update.openDownload, url)
  },
  system: {
    platform: process.platform,
    filePath: safeFilePath,
    lastDroppedFilePaths: (): string[] => [...lastDroppedFilePaths]
  }
}

export type AscoraApi = typeof api

contextBridge.exposeInMainWorld('ascora', api)
