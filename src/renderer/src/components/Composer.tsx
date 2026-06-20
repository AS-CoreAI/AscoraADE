import { useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { useApp, type AgentMode } from '@/state/store'
import type { LlmProvider } from '@shared/ipc'

const MODE_LABEL: Record<AgentMode, string> = {
  ask: 'Ask before changes',
  auto: 'Auto-apply changes'
}

/** Suggested Codex models; an empty value lets Codex use its configured default. */
const CODEX_MODEL_PRESETS = ['gpt-5-codex', 'gpt-5', 'o4-mini']

export function Composer({ showFolder = true }: { showFolder?: boolean }): JSX.Element {
  const active = useApp((s) => s.active)
  const provider = useApp((s) => s.provider)
  const setProvider = useApp((s) => s.setProvider)
  const model = useApp((s) => s.model)
  const models = useApp((s) => s.models)
  const setModel = useApp((s) => s.setModel)
  const codexModel = useApp((s) => s.codexModel)
  const setCodexModel = useApp((s) => s.setCodexModel)
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
        {provider !== 'codex' && (
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
        </select>

        {provider === 'codex' ? (
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
