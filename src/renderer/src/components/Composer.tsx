import { useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { useApp, type AgentMode } from '@/state/store'
import {
  CODEX_REASONING_LEVELS,
  CLAUDE_MODEL_PRESETS,
  CLAUDE_PERMISSION_MODES,
  type LlmProvider,
  type CodexReasoning,
  type CodexSandbox,
  type ClaudePermissionMode
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

/**
 * Suggested Codex models (current gpt-5.x family, mirroring the Codex VS Code
 * extension's picker). An empty value lets Codex use the model from its own
 * config.toml. The list is just a convenience — any valid id can be typed in
 * connection settings.
 */
export const CODEX_MODEL_PRESETS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex']

export const REASONING_LABEL: Record<CodexReasoning, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high'
}

export function Composer({ showFolder = true }: { showFolder?: boolean }): JSX.Element {
  const active = useApp((s) => s.active)
  const provider = useApp((s) => s.provider)
  const setProvider = useApp((s) => s.setProvider)
  const model = useApp((s) => s.model)
  const models = useApp((s) => s.models)
  const setModel = useApp((s) => s.setModel)
  const codexModel = useApp((s) => s.codexModel)
  const setCodexModel = useApp((s) => s.setCodexModel)
  const codexReasoning = useApp((s) => s.codexReasoning)
  const setCodexReasoning = useApp((s) => s.setCodexReasoning)
  const codexSandbox = useApp((s) => s.codexSandbox)
  const setCodexSandbox = useApp((s) => s.setCodexSandbox)
  const claudeModel = useApp((s) => s.claudeModel)
  const setClaudeModel = useApp((s) => s.setClaudeModel)
  const claudePermission = useApp((s) => s.claudePermission)
  const setClaudePermission = useApp((s) => s.setClaudePermission)
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const submitTask = useApp((s) => s.submitTask)
  const stopStreaming = useApp((s) => s.stopStreaming)
  const streaming = useApp((s) => s.streaming)
  const openFolder = useApp((s) => s.openFolder)

  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const modelOptions = models.length > 0 ? models : [model || 'local-model']
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
          <option value="lmstudio">LM Studio</option>
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
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
          <button className="send-btn" onClick={stopStreaming} title="Stop">
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
