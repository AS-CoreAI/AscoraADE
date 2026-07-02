import { useEffect, useRef, useState, type DragEvent, type JSX, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { useApp, type AgentMode } from '@/state/store'
import { api } from '@/lib/api'
import {
  DEFAULT_LLM_CONFIG,
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
  type AttachmentFile
} from '@shared/ipc'

const MODE_LABEL: Record<AgentMode, string> = {
  ask: 'Ask before changes',
  auto: 'Auto-apply changes'
}

/** Short access labels for the Codex sandbox selector in the composer. */
export const SANDBOX_SHORT: Record<CodexSandbox, string> = {
  'read-only': 'Restricted',
  'workspace-write': 'Auto (sandboxed)',
  'danger-full-access': 'Full access'
}

/** Short access labels for the Claude permission-mode selector. */
export const PERMISSION_SHORT: Record<ClaudePermissionMode, string> = {
  plan: 'Plan only',
  default: 'Ask',
  acceptEdits: 'Auto-edit',
  bypassPermissions: 'Full access'
}

/** Short access labels for the GLM / ZCode permission-mode selector. */
export const GLM_MODE_SHORT: Record<GlmMode, string> = {
  plan: 'Plan only',
  build: 'Build',
  edit: 'Auto-edit',
  yolo: 'Full access'
}

/** Short access labels for the GitHub Copilot CLI permission selector. */
export const COPILOT_PERMISSION_SHORT: Record<CopilotPermissionMode, string> = {
  plan: 'Plan only',
  workspace: 'Workspace',
  full: 'Full access'
}

/** Short access labels for the Gemini CLI approval selector. */
export const GEMINI_PERMISSION_SHORT: Record<GeminiApprovalMode, string> = {
  plan: 'Plan only',
  default: 'Ask',
  auto_edit: 'Auto-edit',
  yolo: 'Full access'
}

/**
 * Suggested Codex models (current gpt-5.x family, mirroring the Codex VS Code
 * extension's picker). An empty value lets Codex use the model from its own
 * config.toml. The list is just a convenience — any valid id can be typed in
 * connection settings.
 */
export const CODEX_MODEL_PRESETS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex']

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

export const COPILOT_REASONING_LABEL: Record<CopilotReasoning, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high',
  max: 'Max'
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

function attachmentBlock(files: AttachmentFile[]): string {
  const title = files.length === 1 ? 'Attached file:' : 'Attached files:'
  return [title, ...files.map((file) => `- @${file.path}`)].join('\n')
}

export function Composer({ showFolder = true }: { showFolder?: boolean }): JSX.Element {
  const active = useApp((s) => s.active)
  const activeSsh = useApp((s) => s.activeSsh)
  const provider = useApp((s) => s.provider)
  const setProvider = useApp((s) => s.setProvider)
  const model = useApp((s) => s.model)
  const models = useApp((s) => s.models)
  const setModel = useApp((s) => s.setModel)
  const lmStudioReachable = useApp((s) => s.lmStudioReachable)
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
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const submitTask = useApp((s) => s.submitTask)
  const stopStreaming = useApp((s) => s.stopStreaming)
  const streaming = useApp((s) => s.streaming)
  const openFolder = useApp((s) => s.openFolder)
  const refreshDirectory = useApp((s) => s.refreshDirectory)

  const [text, setText] = useState('')
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [attachStatus, setAttachStatus] = useState<{
    kind: 'ok' | 'error'
    text: string
  } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const attachStatusTimer = useRef<number | null>(null)

  const openRouterReady = openRouterEnabled && openRouterApiKey.trim().length > 0
  const modelOptions =
    provider === 'openrouter'
      ? openRouterModelOptions(models, openRouterModel)
      : models.length > 0
        ? models
        : [model || 'local-model']
  const canSend = text.trim().length > 0 && !!active && !streaming
  const canAttach = !!active && !activeSsh && !attaching

  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }

  const growSoon = (): void => {
    window.requestAnimationFrame(grow)
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

  const insertAttachments = (files: AttachmentFile[]): void => {
    const block = attachmentBlock(files)
    setText((current) => {
      const base = current.trimEnd()
      return base ? `${base}\n\n${block}` : block
    })
    ref.current?.focus()
    growSoon()
  }

  const attachFiles = async (filePaths: string[]): Promise<void> => {
    const root = active?.path
    const paths = [...new Set(filePaths.map((path) => path.trim()).filter(Boolean))]
    if (paths.length === 0) {
      showAttachStatus('error', 'Could not read file paths.')
      return
    }
    if (!root) {
      showAttachStatus('error', 'Open a folder before attaching files.')
      return
    }
    if (activeSsh) {
      showAttachStatus('error', 'Attachments are available for local workspaces.')
      return
    }

    setAttaching(true)
    try {
      const result = await api.fs.importFiles(root, paths)
      if (!result.ok) {
        showAttachStatus('error', result.error ?? 'Failed to attach files.')
        return
      }
      const files = result.files ?? []
      if (files.length === 0) return
      insertAttachments(files)
      showAttachStatus('ok', `Attached ${files.length} file${files.length === 1 ? '' : 's'}.`)
      void refreshDirectory(root)
    } catch (err) {
      showAttachStatus('error', err instanceof Error ? err.message : 'Failed to attach files.')
    } finally {
      setAttaching(false)
    }
  }

  const openAttachmentPicker = async (): Promise<void> => {
    if (!canAttach) return
    const paths = await api.dialog.openFiles()
    if (paths?.length) await attachFiles(paths)
  }

  const send = (): void => {
    if (!canSend) return
    submitTask(text)
    setText('')
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
        <button className="composer-folder" onClick={openFolder} title="Change folder">
          <Icon name="folder" size={15} />
          {active ? active.name : 'Open a folder'}
          <Icon name="chevronDown" size={13} />
          <span className="chev" />
        </button>
      )}

      <textarea
        ref={ref}
        className="composer-input"
        placeholder="Ask Ascora anything, @ to add files, / for commands, $ for skills, # related conversation"
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
          title={activeSsh ? 'Attach is available for local workspaces' : 'Attach files'}
          disabled={!canAttach}
          onClick={() => void openAttachmentPicker()}
        >
          <Icon name="plus" size={16} />
        </button>
        {attachStatus && (
          <span className={`composer-attach-status ${attachStatus.kind}`}>{attachStatus.text}</span>
        )}
        {provider === 'codex' ? (
          <div className="composer-tool" title="Codex access level (sandbox)">
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={codexSandbox}
              onChange={(e) => setCodexSandbox(e.target.value as CodexSandbox)}
            >
              {(Object.keys(SANDBOX_SHORT) as CodexSandbox[]).map((s) => (
                <option key={s} value={s}>
                  {SANDBOX_SHORT[s]}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'copilot' ? (
          <div className="composer-tool" title="Copilot permission profile">
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={copilotPermission}
              onChange={(e) => setCopilotPermission(e.target.value as CopilotPermissionMode)}
            >
              {COPILOT_PERMISSION_MODES.map((p) => (
                <option key={p} value={p}>
                  {COPILOT_PERMISSION_SHORT[p]}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'claude' ? (
          <div className="composer-tool" title="Claude permission mode">
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={claudePermission}
              onChange={(e) => setClaudePermission(e.target.value as ClaudePermissionMode)}
            >
              {CLAUDE_PERMISSION_MODES.map((p) => (
                <option key={p} value={p}>
                  {PERMISSION_SHORT[p]}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'gemini' ? (
          <div className="composer-tool" title="Gemini approval mode">
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={geminiPermission}
              onChange={(e) => setGeminiPermission(e.target.value as GeminiApprovalMode)}
            >
              {GEMINI_APPROVAL_MODES.map((p) => (
                <option key={p} value={p}>
                  {GEMINI_PERMISSION_SHORT[p]}
                </option>
              ))}
            </select>
          </div>
        ) : provider === 'glm' ? (
          <div className="composer-tool" title="GLM (ZCode) permission mode">
            <Icon name="hand" size={15} />
            <select
              className="composer-tool-select"
              value={glmMode}
              onChange={(e) => setGlmMode(e.target.value as GlmMode)}
            >
              {GLM_MODES.map((m) => (
                <option key={m} value={m}>
                  {GLM_MODE_SHORT[m]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <button
            className="composer-tool"
            title="Toggle agent permission mode"
            onClick={() => setMode(mode === 'ask' ? 'auto' : 'ask')}
          >
            <Icon name="hand" size={15} />
            {MODE_LABEL[mode]}
            <Icon name="chevronDown" size={13} />
          </button>
        )}

        <span className="composer-spacer" />

        <select
          className="composer-select"
          value={provider}
          onChange={(e) => void setProvider(e.target.value as LlmProvider)}
          title="Agent backend"
        >
          {(lmStudioReachable || provider === 'lmstudio') && (
            <option value="lmstudio">LM Studio</option>
          )}
          {openRouterReady && <option value="openrouter">OpenRouter</option>}
          <option value="codex">Codex</option>
          <option value="copilot">GitHub Copilot</option>
          <option value="claude">Claude</option>
          <option value="gemini">Gemini CLI</option>
          <option value="glm">GLM (ZCode)</option>
        </select>

        {provider === 'codex' ? (
          <>
            <select
              className="composer-select"
              value={codexReasoning}
              onChange={(e) => setCodexReasoning(e.target.value as CodexReasoning | '')}
              title="Reasoning effort"
            >
              <option value="">Reasoning: auto</option>
              {CODEX_REASONING_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {REASONING_LABEL[r]}
                </option>
              ))}
            </select>
            <select
              className="composer-select"
              value={codexModel}
              onChange={(e) => setCodexModel(e.target.value)}
              title="Codex model"
            >
              <option value="">Codex default</option>
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
              title="Copilot reasoning effort"
            >
              <option value="">Reasoning: auto</option>
              {COPILOT_REASONING_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {COPILOT_REASONING_LABEL[r]}
                </option>
              ))}
            </select>
            <select
              className="composer-select"
              value={copilotModel}
              onChange={(e) => setCopilotModel(e.target.value)}
              title="GitHub Copilot model"
            >
              <option value="">Copilot default</option>
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
            title="Claude model"
          >
            {CLAUDE_MODEL_PRESETS.map((m) => (
              <option key={m} value={m}>
                {m === 'default' ? 'Claude default' : m}
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
            title="Gemini model"
          >
            <option value="">Gemini default</option>
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
            title="GLM model comes from standalone ZCode CLI config or a compatible desktop Coding Plan"
          >
            <option value="glm">GLM · ZCode</option>
          </select>
        ) : provider === 'openrouter' ? (
          <select
            className="composer-select"
            value={openRouterModel || modelOptions[0]}
            onChange={(e) => setOpenRouterModel(e.target.value)}
            title="Model (OpenRouter)"
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
            title="Model (LM Studio)"
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}

        {streaming ? (
          <button className="send-btn" onClick={() => stopStreaming()} title="Stop">
            <Icon name="maximize" size={12} />
          </button>
        ) : (
          <button className="send-btn" disabled={!canSend} onClick={send} title="Send (Enter)">
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
