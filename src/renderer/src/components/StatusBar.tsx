import type { JSX } from 'react'
import { useApp } from '@/state/store'
import { Icon } from './Icon'
import { REASONING_LABEL, PERMISSION_SHORT, GLM_MODE_SHORT } from './Composer'

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
  const codexReasoning = useApp((s) => s.codexReasoning)
  const claudeModel = useApp((s) => s.claudeModel)
  const claudeCheck = useApp((s) => s.claudeCheck)
  const claudeChecking = useApp((s) => s.claudeChecking)
  const claudePermission = useApp((s) => s.claudePermission)
  const glmCheck = useApp((s) => s.glmCheck)
  const glmChecking = useApp((s) => s.glmChecking)
  const glmMode = useApp((s) => s.glmMode)
  const openFiles = useApp((s) => s.openFiles)
  const activeFile = useApp((s) => s.activeFile)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const liveUrl = useApp((s) => s.liveUrl)
  const livePort = useApp((s) => s.livePort)
  const goLive = useApp((s) => s.goLive)
  const stopLive = useApp((s) => s.stopLive)
  const activeSsh = useApp((s) => s.activeSsh)
  const sshConnections = useApp((s) => s.sshConnections)
  const openSshTerminal = useApp((s) => s.openSshTerminal)
  const sshConn = sshConnections.find((c) => c.id === activeSsh)
  const current = openFiles.find((f) => f.path === activeFile)
  const isHtml = !!current && /\.html?$/i.test(current.name)

  const isCodex = provider === 'codex'
  const isClaude = provider === 'claude'
  const isGlm = provider === 'glm'

  // Status dot color + label for the active backend.
  let dotColor: string
  let label: string
  if (isCodex || isClaude || isGlm) {
    const name = isClaude ? 'Claude' : isGlm ? 'GLM' : 'Codex'
    const check = isClaude ? claudeCheck : isGlm ? glmCheck : codexCheck
    const checking = isClaude ? claudeChecking : isGlm ? glmChecking : codexChecking
    if (checking) {
      dotColor = CONN_COLOR.connecting
      label = `${name}: checking…`
    } else if (!check) {
      dotColor = CONN_COLOR.unknown
      label = `${name}: —`
    } else if (!check.installed) {
      dotColor = CONN_COLOR.error
      label = `${name}: not found`
    } else if (isCodex && !check.loggedIn) {
      dotColor = CONN_COLOR.error
      label = 'Codex: sign in needed'
    } else {
      dotColor = CONN_COLOR.connected
      label = `${name}: ready`
    }
  } else {
    dotColor = CONN_COLOR[connection]
    label =
      connection === 'connected' && models.length > 0
        ? `LM Studio: connected · ${models.length} model${models.length === 1 ? '' : 's'}`
        : CONN_LABEL[connection]
  }

  const modelLabel = isGlm
    ? 'GLM (ZCode)'
    : isClaude
      ? claudeModel || 'claude (default)'
      : isCodex
        ? codexModel || 'codex (default)'
        : model || '(no model)'

  const accessLabel = isCodex
    ? `sandbox: ${codexSandbox}${codexReasoning ? ` · ${REASONING_LABEL[codexReasoning]}` : ''}`
    : isClaude
      ? `access: ${PERMISSION_SHORT[claudePermission]}`
      : isGlm
        ? `mode: ${GLM_MODE_SHORT[glmMode]}`
        : mode === 'ask'
          ? 'Ask before changes'
          : 'Auto-apply'

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
      <span className="seg">{accessLabel}</span>
      <span className="spacer" />
      {sshConn && (
        <button
          className="seg seg-btn ssh-on"
          onClick={() => openSshTerminal(sshConn.id)}
          title={`Agent run_command runs on ${sshConn.username}@${sshConn.host}`}
        >
          <Icon name="terminal" size={12} /> {sshConn.username}@{sshConn.host}
        </button>
      )}
      {isHtml &&
        (liveUrl ? (
          <>
            <button
              className="seg seg-btn live-on"
              onClick={() => void goLive()}
              title="Open the Live preview window"
            >
              <Icon name="globe" size={12} /> Live{livePort ? ` :${livePort}` : ''}
            </button>
            <button
              className="seg seg-btn"
              onClick={() => void stopLive()}
              title="Stop Live Server"
            >
              <Icon name="x" size={12} />
            </button>
          </>
        ) : (
          <button
            className="seg seg-btn"
            onClick={() => void goLive()}
            title="Start Live Server and preview this HTML file"
          >
            <Icon name="globe" size={12} /> Go Live
          </button>
        ))}
      {current && <span className="seg">{current.language}</span>}
      <span className="seg">{active ? active.path : 'No folder open'}</span>
    </div>
  )
}
