import { useEffect, type JSX } from 'react'
import { useApp } from '@/state/store'
import { Icon } from './Icon'
import {
  REASONING_LABEL,
  COPILOT_REASONING_LABEL,
  COPILOT_PERMISSION_SHORT,
  GEMINI_PERMISSION_SHORT,
  PERMISSION_SHORT,
  GLM_MODE_SHORT
} from './Composer'

/** Re-poll Claude usage every few minutes while it's the active backend. */
const USAGE_POLL_MS = 3 * 60 * 1000

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

/** Compact "resets in 4h" label from an ISO reset timestamp. */
export function resetLabel(iso?: string): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'resets soon'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `resets in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `resets in ${hrs}h`
  return `resets in ${Math.round(hrs / 24)}d`
}

export function StatusBar(): JSX.Element {
  const active = useApp((s) => s.active)
  const provider = useApp((s) => s.provider)
  const model = useApp((s) => s.model)
  const ollamaModel = useApp((s) => s.ollamaModel)
  const openRouterModel = useApp((s) => s.openRouterModel)
  const mode = useApp((s) => s.mode)
  const connection = useApp((s) => s.connection)
  const models = useApp((s) => s.models)
  const codexModel = useApp((s) => s.codexModel)
  const codexCheck = useApp((s) => s.codexCheck)
  const codexChecking = useApp((s) => s.codexChecking)
  const codexSandbox = useApp((s) => s.codexSandbox)
  const codexReasoning = useApp((s) => s.codexReasoning)
  const codexUsage = useApp((s) => s.codexUsage)
  const refreshCodexUsage = useApp((s) => s.refreshCodexUsage)
  const copilotModel = useApp((s) => s.copilotModel)
  const copilotCheck = useApp((s) => s.copilotCheck)
  const copilotChecking = useApp((s) => s.copilotChecking)
  const copilotPermission = useApp((s) => s.copilotPermission)
  const copilotReasoning = useApp((s) => s.copilotReasoning)
  const claudeModel = useApp((s) => s.claudeModel)
  const claudeCheck = useApp((s) => s.claudeCheck)
  const claudeChecking = useApp((s) => s.claudeChecking)
  const claudePermission = useApp((s) => s.claudePermission)
  const claudeUsage = useApp((s) => s.claudeUsage)
  const refreshClaudeUsage = useApp((s) => s.refreshClaudeUsage)
  const geminiModel = useApp((s) => s.geminiModel)
  const geminiCheck = useApp((s) => s.geminiCheck)
  const geminiChecking = useApp((s) => s.geminiChecking)
  const geminiPermission = useApp((s) => s.geminiPermission)
  const glmCheck = useApp((s) => s.glmCheck)
  const glmChecking = useApp((s) => s.glmChecking)
  const glmMode = useApp((s) => s.glmMode)
  const openFiles = useApp((s) => s.openFiles)
  const activeFile = useApp((s) => s.activeFile)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const setUsageOpen = useApp((s) => s.setUsageOpen)
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
  const isCopilot = provider === 'copilot'
  const isClaude = provider === 'claude'
  const isGemini = provider === 'gemini'
  const isGlm = provider === 'glm'
  const isOpenRouter = provider === 'openrouter'
  const isOllama = provider === 'ollama'

  // Keep the usage indicator fresh while a metered CLI backend is active.
  useEffect(() => {
    if (!isCodex && !isClaude) return
    const refresh = isCodex ? refreshCodexUsage : refreshClaudeUsage
    void refresh()
    const timer = setInterval(() => void refresh(), USAGE_POLL_MS)
    return () => clearInterval(timer)
  }, [isCodex, isClaude, refreshCodexUsage, refreshClaudeUsage])

  // Headline usage window (most-consumed) for the status-bar indicator.
  const usageWin = isCodex ? codexUsage?.headline : isClaude ? claudeUsage?.headline : undefined

  // Status dot color + label for the active backend.
  let dotColor: string
  let label: string
  if (isCodex || isCopilot || isClaude || isGemini || isGlm) {
    const name = isCopilot ? 'Copilot' : isClaude ? 'Claude' : isGemini ? 'Gemini' : isGlm ? 'GLM' : 'Codex'
    const check = isCopilot
      ? copilotCheck
      : isClaude
        ? claudeCheck
        : isGemini
          ? geminiCheck
          : isGlm
            ? glmCheck
            : codexCheck
    const checking = isCopilot
      ? copilotChecking
      : isClaude
        ? claudeChecking
        : isGemini
          ? geminiChecking
          : isGlm
            ? glmChecking
            : codexChecking
    if (checking) {
      dotColor = CONN_COLOR.connecting
      label = `${name}: checking…`
    } else if (!check) {
      dotColor = CONN_COLOR.unknown
      label = `${name}: —`
    } else if (!check.installed) {
      dotColor = CONN_COLOR.error
      label = `${name}: not found`
    } else if ((isCodex || isGemini) && !check.loggedIn) {
      dotColor = CONN_COLOR.error
      label = `${name}: sign in needed`
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
    if (isOpenRouter) {
      label =
        connection === 'connected' && models.length > 0
          ? `OpenRouter: connected - ${models.length} model${models.length === 1 ? '' : 's'}`
          : `OpenRouter: ${
              connection === 'connecting'
                ? 'connecting...'
                : connection === 'error'
                  ? 'not connected'
                  : '-'
            }`
    } else if (isOllama) {
      label =
        connection === 'connected' && models.length > 0
          ? `Ollama: connected - ${models.length} model${models.length === 1 ? '' : 's'}`
          : `Ollama: ${
              connection === 'connecting'
                ? 'connecting...'
                : connection === 'error'
                  ? 'not connected'
                  : '-'
            }`
    }
  }

  const modelLabel = isGlm
    ? 'GLM (ZCode)'
    : isGemini
      ? geminiModel || 'gemini (default)'
    : isClaude
      ? claudeModel || 'claude (default)'
      : isCopilot
        ? copilotModel || 'copilot (default)'
      : isCodex
        ? codexModel || 'codex (default)'
        : isOpenRouter
          ? openRouterModel || 'openrouter/free'
        : isOllama
          ? ollamaModel || 'ollama'
        : model || '(no model)'

  const accessLabel = isCodex
    ? `sandbox: ${codexSandbox}${codexReasoning ? ` · ${REASONING_LABEL[codexReasoning]}` : ''}`
    : isCopilot
      ? `access: ${COPILOT_PERMISSION_SHORT[copilotPermission]}${copilotReasoning ? ` · ${COPILOT_REASONING_LABEL[copilotReasoning]}` : ''}`
    : isClaude
      ? `access: ${PERMISSION_SHORT[claudePermission]}`
      : isGemini
        ? `access: ${GEMINI_PERMISSION_SHORT[geminiPermission]}`
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
      {usageWin && (
        <button
          className={`seg seg-btn usage-seg${usageWin.severity !== 'normal' ? ' usage-warn' : ''}`}
          onClick={() => setUsageOpen(true)}
          title={`You've used ${usageWin.percent}% of your ${usageWin.label}${
            usageWin.resetsAt ? ` · ${resetLabel(usageWin.resetsAt)}` : ''
          } — click for the breakdown`}
        >
          <Icon name="barChart" size={12} /> {usageWin.percent}% {usageWin.label}
        </button>
      )}
      {sshConn && (
        <button
          className="seg seg-btn ssh-on"
          onClick={() => openSshTerminal(sshConn.id)}
          title={`Active SSH context: ${sshConn.username}@${sshConn.host}`}
        >
          <Icon name="terminal" size={12} /> {sshConn.username}@{sshConn.host}
        </button>
      )}
      {!activeSsh && isHtml &&
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
