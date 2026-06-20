import type { JSX } from 'react'
import { useApp } from '@/state/store'

const CONN_LABEL: Record<string, string> = {
  unknown: 'LM Studio: —',
  connecting: 'LM Studio: connecting…',
  connected: 'LM Studio: connected',
  error: 'LM Studio: not connected'
}

const CONN_COLOR: Record<string, string> = {
  unknown: 'var(--text-faint)',
  connecting: 'var(--blue)',
  connected: 'var(--accent)',
  error: 'var(--danger)'
}

export function StatusBar(): JSX.Element {
  const active = useApp((s) => s.active)
  const provider = useApp((s) => s.provider)
  const model = useApp((s) => s.model)
  const mode = useApp((s) => s.mode)
  const connection = useApp((s) => s.connection)
  const models = useApp((s) => s.models)
  const codexModel = useApp((s) => s.codexModel)
  const codexCheck = useApp((s) => s.codexCheck)
  const codexChecking = useApp((s) => s.codexChecking)
  const codexSandbox = useApp((s) => s.codexSandbox)
  const openFiles = useApp((s) => s.openFiles)
  const activeFile = useApp((s) => s.activeFile)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const current = openFiles.find((f) => f.path === activeFile)

  const isCodex = provider === 'codex'

  // Status dot color + label for the active backend.
  let dotColor: string
  let label: string
  if (isCodex) {
    if (codexChecking) {
      dotColor = CONN_COLOR.connecting
      label = 'Codex: checking…'
    } else if (!codexCheck) {
      dotColor = CONN_COLOR.unknown
      label = 'Codex: —'
    } else if (!codexCheck.installed) {
      dotColor = CONN_COLOR.error
      label = 'Codex: not found'
    } else if (!codexCheck.loggedIn) {
      dotColor = CONN_COLOR.error
      label = 'Codex: sign in needed'
    } else {
      dotColor = CONN_COLOR.connected
      label = 'Codex: ready'
    }
  } else {
    dotColor = CONN_COLOR[connection]
    label =
      connection === 'connected' && models.length > 0
        ? `LM Studio: connected · ${models.length} model${models.length === 1 ? '' : 's'}`
        : CONN_LABEL[connection]
  }

  const modelLabel = isCodex ? codexModel || 'codex (default)' : model || '(no model)'

  return (
    <div className="statusbar">
      <button
        className="seg seg-btn"
        onClick={() => setSettingsOpen(true)}
        title="Agent backend settings"
      >
        <span style={{ color: dotColor }}>●</span> {label}
      </button>
      <span className="seg">{modelLabel}</span>
      <span className="seg">
        {isCodex ? `sandbox: ${codexSandbox}` : mode === 'ask' ? 'Ask before changes' : 'Auto-apply'}
      </span>
      <span className="spacer" />
      {current && <span className="seg">{current.language}</span>}
      <span className="seg">{active ? active.path : 'No folder open'}</span>
    </div>
  )
}
