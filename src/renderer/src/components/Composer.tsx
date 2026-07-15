import { useEffect, useRef, useState, type DragEvent, type JSX, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { FileIcon } from './FileIcon'
import { ProviderSelect, type ProviderSelectOption } from './ProviderSelect'
import { useApp, type AgentMode, type AppLanguage } from '@/state/store'
import { api } from '@/lib/api'
import { tr, type TranslationKey } from '@/language'
import {
  DEFAULT_LLM_CONFIG,
  WPROVIDER_SERVICE_INFO,
  WPROVIDER_SERVICES,
  isSshCapableProvider,
  CODEX_REASONING_LEVELS,
  COPILOT_PERMISSION_MODES,
  COPILOT_REASONING_LEVELS,
  CLAUDE_MODEL_PRESETS,
  CLAUDE_PERMISSION_MODES,
  GEMINI_APPROVAL_MODES,
  GLM_MODES,
  type LlmProvider,
  type CodexReasoning,
  type CodexSandbox,
  type CopilotPermissionMode,
  type CopilotReasoning,
  type ClaudePermissionMode,
  type GeminiApprovalMode,
  type GlmMode,
  type AttachmentFile,
  type WProviderService
} from '@shared/ipc'

export const MODE_LABEL_KEY: Record<AgentMode, TranslationKey> = {
  ask: 'composer.mode.ask',
  auto: 'composer.mode.auto'
}

/** Short access labels for the Codex sandbox selector in the composer. */
export const SANDBOX_SHORT: Record<CodexSandbox, string> = {
  'read-only': 'Restricted',
  'workspace-write': 'Auto (sandboxed)',
  'danger-full-access': 'Full access'
}
export const SANDBOX_SHORT_KEY: Record<CodexSandbox, TranslationKey> = {
  'read-only': 'composer.sandbox.restricted',
  'workspace-write': 'composer.sandbox.auto',
  'danger-full-access': 'composer.permission.fullAccess'
}

/** Short access labels for the Claude permission-mode selector. */
export const PERMISSION_SHORT: Record<ClaudePermissionMode, string> = {
  plan: 'Plan only',
  default: 'Ask',
  acceptEdits: 'Auto-edit',
  bypassPermissions: 'Full access'
}
export const PERMISSION_SHORT_KEY: Record<ClaudePermissionMode, TranslationKey> = {
  plan: 'composer.permission.claude.planMode',
  default: 'composer.permission.claude.manual',
  acceptEdits: 'composer.permission.claude.editAuto',
  bypassPermissions: 'composer.permission.claude.auto'
}

/** Short access labels for the GLM / ZCode permission-mode selector. */
export const GLM_MODE_SHORT: Record<GlmMode, string> = {
  plan: 'Plan only',
  build: 'Build',
  edit: 'Auto-edit',
  yolo: 'Full access'
}
export const GLM_MODE_SHORT_KEY: Record<GlmMode, TranslationKey> = {
  plan: 'composer.permission.planOnly',
  build: 'composer.permission.build',
  edit: 'composer.permission.autoEdit',
  yolo: 'composer.permission.fullAccess'
}

/** Short access labels for the GitHub Copilot CLI permission selector. */
export const COPILOT_PERMISSION_SHORT: Record<CopilotPermissionMode, string> = {
  plan: 'Plan only',
  workspace: 'Workspace',
  full: 'Full access'
}
export const COPILOT_PERMISSION_SHORT_KEY: Record<CopilotPermissionMode, TranslationKey> = {
  plan: 'composer.permission.planOnly',
  workspace: 'composer.permission.workspace',
  full: 'composer.permission.fullAccess'
}

/** Short access labels for the Gemini CLI approval selector. */
export const GEMINI_PERMISSION_SHORT: Record<GeminiApprovalMode, string> = {
  plan: 'Plan only',
  default: 'Ask',
  auto_edit: 'Auto-edit',
  yolo: 'Full access'
}
export const GEMINI_PERMISSION_SHORT_KEY: Record<GeminiApprovalMode, TranslationKey> = {
  plan: 'composer.permission.planOnly',
  default: 'composer.permission.ask',
  auto_edit: 'composer.permission.autoEdit',
  yolo: 'composer.permission.fullAccess'
}

/**
 * Suggested Codex models (current gpt-5.x family, mirroring the Codex VS Code
 * extension's picker). An empty value lets Codex use the model from its own
 * config.toml. The list is just a convenience — any valid id can be typed in
 * connection settings.
 */
export const CODEX_MODEL_PRESETS = [
  'gpt-5.6-terra',
  'gpt-5.6-lunna',
  'gpt-5.6-sol',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex'
]

export const COPILOT_MODEL_PRESETS = [
  'auto',
  'claude-sonnet-4.6',
  'gpt-5.4',
  'claude-haiku-4.5',
  'gpt-5.3-codex',
  'gemini-3.1-pro-preview'
]

export const GEMINI_MODEL_PRESETS = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
]

export const REASONING_LABEL: Record<CodexReasoning, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high'
}
export const REASONING_LABEL_KEY: Record<CodexReasoning, TranslationKey> = {
  minimal: 'composer.reasoning.minimal',
  low: 'composer.reasoning.low',
  medium: 'composer.reasoning.medium',
  high: 'composer.reasoning.high',
  xhigh: 'composer.reasoning.veryHigh'
}

export const COPILOT_REASONING_LABEL: Record<CopilotReasoning, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high',
  max: 'Max'
}
export const COPILOT_REASONING_LABEL_KEY: Record<CopilotReasoning, TranslationKey> = {
  low: 'composer.reasoning.low',
  medium: 'composer.reasoning.medium',
  high: 'composer.reasoning.high',
  xhigh: 'composer.reasoning.veryHigh',
  max: 'composer.reasoning.max'
}

export function openRouterModelOptions(models: string[], selectedModel: string): string[] {
  const seen = new Set<string>()
  return [selectedModel, DEFAULT_LLM_CONFIG.openRouterModel, ...models]
    .map((m) => m.trim())
    .filter((m) => {
      if (!m || seen.has(m)) return false
      seen.add(m)
      return true
    })
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes('Files') ||
    Array.from(dataTransfer.items).some((item) => item.kind === 'file')
  )
}

function droppedFilePath(file: File): string {
  try {
    const path = api.system.filePath(file)
    if (path) return path
  } catch {
    // Fall back to older Electron builds that exposed File.path directly.
  }
  return (file as File & { path?: string }).path ?? ''
}

function droppedFilePaths(files: FileList): string[] {
  const direct = Array.from(files).map(droppedFilePath).filter(Boolean)
  const fallback = api.system.lastDroppedFilePaths()
  return [...new Set([...direct, ...fallback])]
}

function attachmentSourceKey(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return api.system.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function attachmentBlock(files: AttachmentFile[], language: AppLanguage): string {
  const title = files.length === 1
    ? tr(language, 'composer.attachedFile')
    : tr(language, 'composer.attachedFiles')
  return [title, ...files.map((file) => `- @${file.path}`)].join('\n')
}

function promptWithAttachments(text: string, files: AttachmentFile[], language: AppLanguage): string {
  const blocks = [text.trim(), files.length > 0 ? attachmentBlock(files, language) : '']
  return blocks.filter(Boolean).join('\n\n')
}

export function Composer({ showFolder = true }: { showFolder?: boolean }): JSX.Element {
  const active = useApp((s) => s.active)
  const archivedTaskId = useApp((s) => s.archivedTaskId)
  const activeTaskId = useApp((s) => s.activeTaskId)
  const activeSsh = useApp((s) => s.activeSsh)
  const provider = useApp((s) => s.provider)
  const setProvider = useApp((s) => s.setProvider)
  const model = useApp((s) => s.model)
  const models = useApp((s) => s.models)
  const setModel = useApp((s) => s.setModel)
  const ollamaModel = useApp((s) => s.ollamaModel)
  const setOllamaModel = useApp((s) => s.setOllamaModel)
  const lmStudioReachable = useApp((s) => s.lmStudioReachable)
  const ollamaReachable = useApp((s) => s.ollamaReachable)
  const openRouterEnabled = useApp((s) => s.openRouterEnabled)
  const openRouterApiKey = useApp((s) => s.openRouterApiKey)
  const openRouterModel = useApp((s) => s.openRouterModel)
  const setOpenRouterModel = useApp((s) => s.setOpenRouterModel)
  const codexModel = useApp((s) => s.codexModel)
  const setCodexModel = useApp((s) => s.setCodexModel)
  const codexReasoning = useApp((s) => s.codexReasoning)
  const setCodexReasoning = useApp((s) => s.setCodexReasoning)
  const codexSandbox = useApp((s) => s.codexSandbox)
  const setCodexSandbox = useApp((s) => s.setCodexSandbox)
  const copilotModel = useApp((s) => s.copilotModel)
  const setCopilotModel = useApp((s) => s.setCopilotModel)
  const copilotPermission = useApp((s) => s.copilotPermission)
  const setCopilotPermission = useApp((s) => s.setCopilotPermission)
  const copilotReasoning = useApp((s) => s.copilotReasoning)
  const setCopilotReasoning = useApp((s) => s.setCopilotReasoning)
  const claudeModel = useApp((s) => s.claudeModel)
  const setClaudeModel = useApp((s) => s.setClaudeModel)
  const claudePermission = useApp((s) => s.claudePermission)
  const setClaudePermission = useApp((s) => s.setClaudePermission)
  const geminiModel = useApp((s) => s.geminiModel)
  const setGeminiModel = useApp((s) => s.setGeminiModel)
  const geminiPermission = useApp((s) => s.geminiPermission)
  const setGeminiPermission = useApp((s) => s.setGeminiPermission)
  const glmMode = useApp((s) => s.glmMode)
  const setGlmMode = useApp((s) => s.setGlmMode)
  const wproviderService = useApp((s) => s.wproviderService)
  const setWProviderService = useApp((s) => s.setWProviderService)
  const wproviderChecks = useApp((s) => s.wproviderChecks)
  const wproviderChecking = useApp((s) => s.wproviderChecking)
  const wproviderLoggingIn = useApp((s) => s.wproviderLoggingIn)
  const omnirouteModel = useApp((s) => s.omnirouteModel)
  const setOmnirouteModel = useApp((s) => s.setOmnirouteModel)
  const omnirouteStatus = useApp((s) => s.omnirouteStatus)
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const submitTask = useApp((s) => s.submitTask)
  const stopStreaming = useApp((s) => s.stopStreaming)
  const streaming = useApp((s) => s.streaming)
  const openFolder = useApp((s) => s.openFolder)
  const refreshDirectory = useApp((s) => s.refreshDirectory)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)

  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [attachStatus, setAttachStatus] = useState<{
    kind: 'ok' | 'error'
    text: string
  } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const attachStatusTimer = useRef<number | null>(null)
  const attachmentImportRef = useRef<symbol | null>(null)
  const attachmentPathsRef = useRef(new Set<string>())
  const attachmentSourcesRef = useRef(new Set<string>())

  const openRouterReady = openRouterEnabled && openRouterApiKey.trim().length > 0
  const lmStudioUnavailable = !lmStudioReachable
  const ollamaUnavailable = !ollamaReachable
  const cantWorkFromSsh = t('composer.cantWorkFromSsh')
  const blockedBySsh = (next: LlmProvider): boolean =>
    !!activeSsh && !isSshCapableProvider(next)
  const sshBlockedTitle = (next: LlmProvider): string | undefined =>
    blockedBySsh(next) ? cantWorkFromSsh : undefined
  const providerOptions: ProviderSelectOption[] = [
    {
      value: 'lmstudio',
      label: 'LM Studio',
      disabled: lmStudioUnavailable,
      tooltip: lmStudioUnavailable ? t('composer.lmStudioNotRunning') : undefined
    },
    {
      value: 'ollama',
      label: 'Ollama',
      disabled: ollamaUnavailable || blockedBySsh('ollama'),
      tooltip: sshBlockedTitle('ollama') ?? (ollamaUnavailable ? t('composer.ollamaNotRunning') : undefined)
    },
    ...(openRouterReady
      ? [
          {
            value: 'openrouter' as const,
            label: 'OpenRouter',
            disabled: blockedBySsh('openrouter'),
            tooltip: sshBlockedTitle('openrouter')
          }
        ]
      : []),
    { value: 'omniroute', label: 'OmniRoute' },
    {
      value: 'codex',
      label: 'Codex',
      disabled: blockedBySsh('codex'),
      tooltip: sshBlockedTitle('codex')
    },
    {
      value: 'copilot',
      label: 'GitHub Copilot',
      disabled: blockedBySsh('copilot'),
      tooltip: sshBlockedTitle('copilot')
    },
    {
      value: 'claude',
      label: 'Claude',
      disabled: blockedBySsh('claude'),
      tooltip: sshBlockedTitle('claude')
    },
    {
      value: 'gemini',
      label: 'Gemini CLI',
      disabled: blockedBySsh('gemini'),
      tooltip: sshBlockedTitle('gemini')
    },
    {
      value: 'glm',
      label: 'GLM (ZCode)',
      disabled: blockedBySsh('glm'),
      tooltip: sshBlockedTitle('glm')
    },
    { value: 'wprovider', label: 'Ascora WProvider' }
  ]
  const selectedLocalModel =
    provider === 'ollama' ? ollamaModel : provider === 'omniroute' ? omnirouteModel : model
  const modelOptions =
    provider === 'openrouter'
      ? openRouterModelOptions(models, openRouterModel)
      : models.length > 0
        ? models
        : [selectedLocalModel || (provider === 'ollama' ? 'ollama' : 'local-model')]
  const readOnly = !!activeTaskId && archivedTaskId === activeTaskId
  const canSend =
    (text.trim().length > 0 || attachments.length > 0) &&
    !!active &&
    !streaming &&
    !attaching &&
    !(provider === 'omniroute' && omnirouteStatus.state !== 'ready') &&
    !readOnly
  const canAttach = !!active && !activeSsh && !attaching && !readOnly

  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  const showAttachStatus = (kind: 'ok' | 'error', statusText: string): void => {
    if (attachStatusTimer.current !== null) window.clearTimeout(attachStatusTimer.current)
    setAttachStatus({ kind, text: statusText })
    attachStatusTimer.current = window.setTimeout(() => setAttachStatus(null), 2600)
  }

  useEffect(
    () => () => {
      if (attachStatusTimer.current !== null) window.clearTimeout(attachStatusTimer.current)
    },
    []
  )

  useEffect(() => {
    attachmentImportRef.current = null
    attachmentPathsRef.current.clear()
    attachmentSourcesRef.current.clear()
    setAttaching(false)
    setAttachments([])
    setDraggingFiles(false)
  }, [active?.id, activeSsh, activeTaskId])

  const insertAttachments = (files: AttachmentFile[]): void => {
    const added = files.filter((file) => {
      const sourceKey = attachmentSourceKey(file.sourcePath ?? file.absolutePath)
      if (attachmentPathsRef.current.has(file.path) || attachmentSourcesRef.current.has(sourceKey)) return false
      attachmentPathsRef.current.add(file.path)
      attachmentSourcesRef.current.add(sourceKey)
      return true
    })
    if (added.length > 0) setAttachments((current) => [...current, ...added])
    ref.current?.focus()
  }

  const attachFiles = async (filePaths: string[]): Promise<void> => {
    const root = active?.path
    const taskId = activeTaskId
    const selectedPaths = [...new Set(filePaths.map((path) => path.trim()).filter(Boolean))]
    const paths = selectedPaths.filter((path) => !attachmentSourcesRef.current.has(attachmentSourceKey(path)))
    if (attachmentImportRef.current) return
    if (selectedPaths.length === 0) {
      showAttachStatus('error', t('composer.readFilePathsError'))
      return
    }
    if (paths.length === 0) return
    if (!root) {
      showAttachStatus('error', t('composer.openFolderBeforeAttach'))
      return
    }
    if (activeSsh) {
      showAttachStatus('error', t('composer.attachLocalOnly'))
      return
    }
    const currentContext = useApp.getState()
    if (
      currentContext.active?.path !== root ||
      currentContext.activeTaskId !== taskId ||
      currentContext.activeSsh
    ) {
      return
    }

    const importToken = Symbol('attachment-import')
    attachmentImportRef.current = importToken
    setAttaching(true)
    const isCurrentImport = (): boolean => {
      const context = useApp.getState()
      return (
        attachmentImportRef.current === importToken &&
        context.active?.path === root &&
        context.activeTaskId === taskId &&
        !context.activeSsh
      )
    }
    try {
      const result = await api.fs.importFiles(root, paths)
      if (!isCurrentImport()) return
      if (!result.ok) {
        showAttachStatus('error', result.error ?? t('composer.attachFailed'))
        return
      }
      const files = result.files ?? []
      if (files.length === 0) return
      insertAttachments(files)
      showAttachStatus('ok', t('composer.attachedCount', { count: files.length }))
      void refreshDirectory(root)
    } catch (err) {
      if (isCurrentImport()) {
        showAttachStatus('error', err instanceof Error ? err.message : t('composer.attachFailed'))
      }
    } finally {
      if (attachmentImportRef.current === importToken) {
        attachmentImportRef.current = null
        setAttaching(false)
      }
    }
  }

  const openAttachmentPicker = async (): Promise<void> => {
    if (!canAttach) return
    const paths = await api.dialog.openFiles()
    if (paths?.length) await attachFiles(paths)
  }

  const send = (): void => {
    if (!canSend || attachmentImportRef.current) return
    const prompt = promptWithAttachments(text, attachments, appLanguage)
    void submitTask(prompt, {
      text,
      attachments: attachments.map(({ name, previewDataUrl }) => ({
        name,
        ...(previewDataUrl ? { previewDataUrl } : {})
      }))
    })
    attachmentPathsRef.current.clear()
    attachmentSourcesRef.current.clear()
    setText('')
    setAttachments([])
    if (ref.current) ref.current.style.height = 'auto'
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const onDragEnter = (e: DragEvent<HTMLTextAreaElement>): void => {
    if (!hasDraggedFiles(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDraggingFiles(true)
  }

  const onDragOver = (e: DragEvent<HTMLTextAreaElement>): void => {
    if (!hasDraggedFiles(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!draggingFiles) setDraggingFiles(true)
  }

  const onDragLeave = (e: DragEvent<HTMLTextAreaElement>): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDraggingFiles(false)
  }

  const onDrop = (e: DragEvent<HTMLTextAreaElement>): void => {
    if (!hasDraggedFiles(e.dataTransfer)) return
    e.preventDefault()
    setDraggingFiles(false)
    void attachFiles(droppedFilePaths(e.dataTransfer.files))
  }

  return (
    <div className={`composer${draggingFiles ? ' dragging-files' : ''}`}>
      {showFolder && (
        <button className="composer-folder" onClick={openFolder} title={t('composer.changeFolder')}>
          <Icon name="folder" size={15} />
          {active ? active.name : t('composer.openFolder')}
          <Icon name="chevronDown" size={13} />
          <span className="chev" />
        </button>
      )}

      {attachments.length > 0 && (
        <div className="composer-attachments" role="list">
          {attachments.map((file) => (
            <div
              key={file.path}
              className={`composer-attachment ${file.previewDataUrl ? 'image' : 'file'}`}
              role="listitem"
              title={file.name}
            >
              {file.previewDataUrl ? (
                <img src={file.previewDataUrl} alt={file.name} draggable={false} />
              ) : (
                <>
                  <FileIcon name={file.name} size={17} />
                  <span className="composer-attachment-name">{file.name}</span>
                </>
              )}
              <button
                type="button"
                className="composer-attachment-remove"
                title={`${t('common.delete')}: ${file.name}`}
                aria-label={`${t('common.delete')}: ${file.name}`}
                onClick={() => {
                  attachmentPathsRef.current.delete(file.path)
                  attachmentSourcesRef.current.delete(attachmentSourceKey(file.sourcePath ?? file.absolutePath))
                  setAttachments((current) => current.filter((item) => item.path !== file.path))
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        className="composer-input"
        placeholder={t('composer.placeholder')}
        disabled={readOnly}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          grow()
        }}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        rows={1}
      />

      <div className="composer-toolbar">
        <button
          type="button"
          className="composer-tool icon-only"
          title={activeSsh ? t('composer.attachLocalWorkspaces') : t('composer.attachFiles')}
          disabled={!canAttach}
          onClick={() => void openAttachmentPicker()}
        >
          <Icon name="plus" size={16} />
        </button>
        {attachStatus && (
          <span className={`composer-attach-status ${attachStatus.kind}`}>{attachStatus.text}</span>
        )}
        {provider === 'codex' ? (
          <div className="composer-tool" title={t('composer.codexAccess')}>
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={codexSandbox}
              onChange={(e) => setCodexSandbox(e.target.value as CodexSandbox)}
            >
              {(Object.keys(SANDBOX_SHORT) as CodexSandbox[]).map((s) => (
                <option key={s} value={s}>
                  {t(SANDBOX_SHORT_KEY[s])}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'copilot' ? (
          <div className="composer-tool" title={t('composer.copilotPermission')}>
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={copilotPermission}
              onChange={(e) => setCopilotPermission(e.target.value as CopilotPermissionMode)}
            >
              {COPILOT_PERMISSION_MODES.map((p) => (
                <option key={p} value={p}>
                  {t(COPILOT_PERMISSION_SHORT_KEY[p])}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'claude' ? (
          <div className="composer-tool" title={t('composer.claudePermission')}>
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={claudePermission}
              onChange={(e) => setClaudePermission(e.target.value as ClaudePermissionMode)}
            >
              {CLAUDE_PERMISSION_MODES.map((p) => (
                <option key={p} value={p}>
                  {t(PERMISSION_SHORT_KEY[p])}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'gemini' ? (
          <div className="composer-tool" title={t('composer.geminiApproval')}>
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={geminiPermission}
              onChange={(e) => setGeminiPermission(e.target.value as GeminiApprovalMode)}
            >
              {GEMINI_APPROVAL_MODES.map((p) => (
                <option key={p} value={p}>
                  {t(GEMINI_PERMISSION_SHORT_KEY[p])}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'glm' ? (
          <div className="composer-tool" title={t('composer.glmPermission')}>
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={glmMode}
              onChange={(e) => setGlmMode(e.target.value as GlmMode)}
            >
              {GLM_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(GLM_MODE_SHORT_KEY[m])}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <button
            className="composer-tool"
            title={t('composer.togglePermissionMode')}
            onClick={() => setMode(mode === 'ask' ? 'auto' : 'ask')}
          >
            <Icon name="hand" size={15} />
            {t(MODE_LABEL_KEY[mode])}
            <Icon name="chevronDown" size={13} />
          </button>
        )}

        <span className="composer-spacer" />

        <ProviderSelect
          value={provider}
          options={providerOptions}
          onChange={(next) => {
            if (blockedBySsh(next)) return
            if (next === 'lmstudio' && lmStudioUnavailable) return
            if (next === 'ollama' && ollamaUnavailable) return
            void setProvider(next)
          }}
          className="composer-select"
          ariaLabel={t('composer.agentBackend')}
          placement="top"
        />

        {provider === 'codex' ? (
          <>
            <select
              className="composer-select"
              value={codexReasoning}
              onChange={(e) => setCodexReasoning(e.target.value as CodexReasoning | '')}
              title={t('composer.reasoningEffort')}
            >
              <option value="">{t('composer.reasoningAuto')}</option>
              {CODEX_REASONING_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {t(REASONING_LABEL_KEY[r])}
                </option>
              ))}
            </select>
            <select
              className="composer-select"
              value={codexModel}
              onChange={(e) => setCodexModel(e.target.value)}
              title={t('composer.codexModel')}
            >
              <option value="">{t('composer.codexDefault')}</option>
              {CODEX_MODEL_PRESETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {codexModel && !CODEX_MODEL_PRESETS.includes(codexModel) && (
                <option value={codexModel}>{codexModel}</option>
              )}
            </select>
          </>
        ) : provider === 'copilot' ? (
          <>
            <select
              className="composer-select"
              value={copilotReasoning}
              onChange={(e) => setCopilotReasoning(e.target.value as CopilotReasoning | '')}
              title={t('composer.copilotReasoning')}
            >
              <option value="">{t('composer.reasoningAuto')}</option>
              {COPILOT_REASONING_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {t(COPILOT_REASONING_LABEL_KEY[r])}
                </option>
              ))}
            </select>
            <select
              className="composer-select"
              value={copilotModel}
              onChange={(e) => setCopilotModel(e.target.value)}
              title={t('composer.copilotModel')}
            >
              <option value="">{t('composer.copilotDefault')}</option>
              {COPILOT_MODEL_PRESETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {copilotModel && !COPILOT_MODEL_PRESETS.includes(copilotModel) && (
                <option value={copilotModel}>{copilotModel}</option>
              )}
            </select>
          </>
        ) : provider === 'claude' ? (
          <select
            className="composer-select"
            value={claudeModel || 'default'}
            onChange={(e) => setClaudeModel(e.target.value === 'default' ? '' : e.target.value)}
            title={t('composer.claudeModel')}
          >
            {CLAUDE_MODEL_PRESETS.map((m) => (
              <option key={m} value={m}>
                {m === 'default' ? t('composer.claudeDefault') : m}
              </option>
            ))}
            {claudeModel && !CLAUDE_MODEL_PRESETS.includes(claudeModel) && (
              <option value={claudeModel}>{claudeModel}</option>
            )}
          </select>
        ) : provider === 'gemini' ? (
          <select
            className="composer-select"
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value)}
            title={t('composer.geminiModel')}
          >
            <option value="">{t('composer.geminiDefault')}</option>
            {GEMINI_MODEL_PRESETS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {geminiModel && !GEMINI_MODEL_PRESETS.includes(geminiModel) && (
              <option value={geminiModel}>{geminiModel}</option>
            )}
          </select>
        ) : provider === 'glm' ? (
          <select
            className="composer-select"
            value="glm"
            disabled
            title={t('composer.glmModelHint')}
          >
            <option value="glm">GLM · ZCode</option>
          </select>
        ) : provider === 'wprovider' ? (
          <select
            className="composer-select"
            value={wproviderService}
            disabled={wproviderChecking || wproviderLoggingIn}
            onChange={(e) => void setWProviderService(e.target.value as WProviderService)}
            title={t('composer.wproviderModelHint')}
          >
            {WPROVIDER_SERVICES.map((service) => {
              const result = wproviderChecks[service]
              // Only grey out services we've actually probed and found signed-out;
              // leave un-probed ones selectable so picking one runs its own check.
              const knownSignedOut = result?.ok === true && !result.loggedIn
              return (
                <option
                  key={service}
                  value={service}
                  disabled={knownSignedOut}
                  title={knownSignedOut ? t('composer.wproviderNotSignedIn', { name: WPROVIDER_SERVICE_INFO[service].label }) : undefined}
                >
                  {WPROVIDER_SERVICE_INFO[service].label} · Web{knownSignedOut ? ` — ${t('status.signInNeeded')}` : ''}
                </option>
              )
            })}
          </select>
        ) : provider === 'omniroute' ? (
          <select
            className="composer-select"
            value={omnirouteModel || modelOptions[0]}
            disabled={omnirouteStatus.state !== 'ready' || models.length === 0}
            onChange={(e) => setOmnirouteModel(e.target.value)}
            title={t('composer.modelOmniroute')}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : provider === 'openrouter' ? (
          <select
            className="composer-select"
            value={openRouterModel || modelOptions[0]}
            onChange={(e) => setOpenRouterModel(e.target.value)}
            title={t('composer.modelOpenRouter')}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : provider === 'ollama' ? (
          <select
            className="composer-select"
            value={ollamaModel || modelOptions[0]}
            onChange={(e) => setOllamaModel(e.target.value)}
            title={t('composer.modelOllama')}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="composer-select"
            value={model || modelOptions[0]}
            onChange={(e) => setModel(e.target.value)}
            title={t('composer.modelLmStudio')}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}

        {streaming ? (
          <button className="send-btn" onClick={() => stopStreaming()} title={t('common.stop')}>
            <Icon name="maximize" size={12} />
          </button>
        ) : (
          <button className="send-btn" disabled={!canSend} onClick={send} title={t('composer.send')}>
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
