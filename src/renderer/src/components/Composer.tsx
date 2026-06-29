import { useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { useApp, type AgentMode } from '@/state/store'
import {
  DEFAULT_LLM_CONFIG,
  CODEX_REASONING_LEVELS,
  COPILOT_PERMISSION_MODES,
  COPILOT_REASONING_LEVELS,
  CLAUDE_MODEL_PRESETS,
  CLAUDE_PERMISSION_MODES,
  GLM_MODES,
  type LlmProvider,
  type CodexReasoning,
  type CodexSandbox,
  type CopilotPermissionMode,
  type CopilotReasoning,
  type ClaudePermissionMode,
  type GlmMode
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

export function Composer({ showFolder = true }: { showFolder?: boolean }): JSX.Element {
  const active = useApp((s) => s.active)
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
  const glmMode = useApp((s) => s.glmMode)
  const setGlmMode = useApp((s) => s.setGlmMode)
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const submitTask = useApp((s) => s.submitTask)
  const stopStreaming = useApp((s) => s.stopStreaming)
  const streaming = useApp((s) => s.streaming)
  const openFolder = useApp((s) => s.openFolder)

  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const openRouterReady = openRouterEnabled && openRouterApiKey.trim().length > 0
  const modelOptions =
    provider === 'openrouter'
      ? openRouterModelOptions(models, openRouterModel)
      : models.length > 0
        ? models
        : [model || 'local-model']
  const canSend = text.trim().length > 0 && !!active && !streaming

  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
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

  return (
    <div className="composer">
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
        rows={1}
      />

      <div className="composer-toolbar">
        <button className="composer-tool icon-only" title="Attach">
          <Icon name="plus" size={16} />
        </button>
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
