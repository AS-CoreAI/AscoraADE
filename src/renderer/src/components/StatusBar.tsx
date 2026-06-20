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
  const model = useApp((s) => s.model)
  const mode = useApp((s) => s.mode)
  const connection = useApp((s) => s.connection)
  const models = useApp((s) => s.models)
  const openFiles = useApp((s) => s.openFiles)
  const activeFile = useApp((s) => s.activeFile)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const current = openFiles.find((f) => f.path === activeFile)

  const label =
    connection === 'connected' && models.length > 0
      ? `LM Studio: connected · ${models.length} model${models.length === 1 ? '' : 's'}`
      : CONN_LABEL[connection]

  return (
    <div className="statusbar">
      <button
        className="seg seg-btn"
        onClick={() => setSettingsOpen(true)}
        title="LM Studio connection settings"
      >
        <span style={{ color: CONN_COLOR[connection] }}>●</span> {label}
      </button>
      <span className="seg">{model || '(no model)'}</span>
      <span className="seg">{mode === 'ask' ? 'Ask before changes' : 'Auto-apply'}</span>
      <span className="spacer" />
      {current && <span className="seg">{current.language}</span>}
      <span className="seg">{active ? active.path : 'No folder open'}</span>
    </div>
  )
}
