import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { useApp, type AppLanguage, type LiveOpenTarget } from '@/state/store'
import { tr, type TranslationKey } from '@/language'
import { api } from '@/lib/api'
import { Icon } from './Icon'
import {
  REASONING_LABEL_KEY,
  COPILOT_REASONING_LABEL_KEY,
  COPILOT_PERMISSION_SHORT_KEY,
  GEMINI_PERMISSION_SHORT_KEY,
  PERMISSION_SHORT_KEY,
  GLM_MODE_SHORT_KEY,
  MODE_LABEL_KEY
} from './Composer'
import { WPROVIDER_SERVICE_INFO, type PublicIpStatus } from '@shared/ipc'

/** Re-poll Claude usage every few minutes while it's the active backend. */
const USAGE_POLL_MS = 3 * 60 * 1000
const LIVE_TARGET_STORAGE_KEY = 'ascora.live-open-target'
const IP_POLL_MS = 5 * 60 * 1000

const CONN_COLOR: Record<string, string> = {
  unknown: 'var(--text-faint)',
  connecting: 'var(--blue)',
  connected: 'var(--accent)',
  error: 'var(--danger)'
}

function savedLiveTarget(): LiveOpenTarget {
  try {
    return localStorage.getItem(LIVE_TARGET_STORAGE_KEY) === 'browser' ? 'browser' : 'ascora'
  } catch {
    return 'ascora'
  }
}

/** Compact "resets in 4h" label from an ISO reset timestamp. */
export function resetLabel(iso?: string, language: AppLanguage = 'en'): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return tr(language, 'status.resetsSoon')
  const mins = Math.round(ms / 60000)
  if (mins < 60) return tr(language, 'status.resetsInMinutes', { count: mins })
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return tr(language, 'status.resetsInHours', { count: hrs })
  return tr(language, 'status.resetsInDays', { count: Math.round(hrs / 24) })
}

export function StatusBar(): JSX.Element {
  const [liveTarget, setLiveTarget] = useState<LiveOpenTarget>(savedLiveTarget)
  const [liveTargetOpen, setLiveTargetOpen] = useState(false)
  const [publicIp, setPublicIp] = useState<PublicIpStatus>({
    state: 'checking',
    ip: null,
    countryCode: null,
    vpnRecommended: false,
    checkedAt: null
  })
  const liveTargetRef = useRef<HTMLSpanElement>(null)
  const liveTargetMenuId = useId()
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
  const wproviderService = useApp((s) => s.wproviderService)
  const wproviderCheck = useApp((s) => s.wproviderCheck)
  const wproviderChecking = useApp((s) => s.wproviderChecking)
  const omnirouteModel = useApp((s) => s.omnirouteModel)
  const omnirouteStatus = useApp((s) => s.omnirouteStatus)
  const openFiles = useApp((s) => s.openFiles)
  const activeFile = useApp((s) => s.activeFile)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const setUsageOpen = useApp((s) => s.setUsageOpen)
  const openVpn = useApp((s) => s.openVpn)
  const liveUrl = useApp((s) => s.liveUrl)
  const livePort = useApp((s) => s.livePort)
  const goLive = useApp((s) => s.goLive)
  const stopLive = useApp((s) => s.stopLive)
  const activeSsh = useApp((s) => s.activeSsh)
  const sshConnections = useApp((s) => s.sshConnections)
  const openSshTerminal = useApp((s) => s.openSshTerminal)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const sshConn = sshConnections.find((c) => c.id === activeSsh)
  const current = openFiles.find((f) => f.path === activeFile)
  const isHtml = !!current && /\.html?$/i.test(current.name)

  const chooseLiveTarget = (target: LiveOpenTarget): void => {
    setLiveTarget(target)
    setLiveTargetOpen(false)
    try {
      localStorage.setItem(LIVE_TARGET_STORAGE_KEY, target)
    } catch {
      // The selection still works for this session when storage is unavailable.
    }
    void goLive(target)
  }

  const isCodex = provider === 'codex'
  const isCopilot = provider === 'copilot'
  const isClaude = provider === 'claude'
  const isGemini = provider === 'gemini'
  const isGlm = provider === 'glm'
  const isWProvider = provider === 'wprovider'
  const isOpenRouter = provider === 'openrouter'
  const isOllama = provider === 'ollama'
  const isOmniroute = provider === 'omniroute'
  const connectionStatusLabel = (state: string): string => {
    if (state === 'connecting') return t('status.connecting')
    if (state === 'connected') return t('status.connected')
    if (state === 'error') return t('status.notConnected')
    return '—'
  }
  const modelCount = (count: number): string =>
    `${count} ${count === 1 ? t('status.model') : t('status.models')}`

  // Keep the usage indicator fresh while a metered CLI backend is active.
  useEffect(() => {
    if (!isCodex && !isClaude) return
    const refresh = isCodex ? refreshCodexUsage : refreshClaudeUsage
    void refresh()
    const timer = setInterval(() => void refresh(), USAGE_POLL_MS)
    return () => clearInterval(timer)
  }, [isCodex, isClaude, refreshCodexUsage, refreshClaudeUsage])

  useEffect(() => {
    if (!liveTargetOpen) return
    const closeOnOutside = (event: PointerEvent): void => {
      if (!liveTargetRef.current?.contains(event.target as Node)) setLiveTargetOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLiveTargetOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [liveTargetOpen])

  useEffect(() => {
    let alive = true
    const unsubscribe = api.network.onStatusChanged((next) => {
      if (alive) setPublicIp(next)
    })
    const refresh = (): void => {
      void api.network.publicIp().then((next) => {
        if (alive) setPublicIp(next)
      })
    }
    refresh()
    const timer = setInterval(refresh, IP_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [])

  // Headline usage window (most-consumed) for the status-bar indicator.
  const usageWin = isCodex ? codexUsage?.headline : isClaude ? claudeUsage?.headline : undefined
  const wproviderLabel = WPROVIDER_SERVICE_INFO[wproviderService].label

  // Status dot color + label for the active backend.
  let dotColor: string
  let label: string
  if (isOmniroute) {
    dotColor =
      omnirouteStatus.state === 'ready'
        ? CONN_COLOR.connected
        : omnirouteStatus.state === 'starting'
          ? CONN_COLOR.connecting
          : omnirouteStatus.state === 'error'
            ? CONN_COLOR.error
            : CONN_COLOR.unknown
    label =
      omnirouteStatus.state === 'ready'
        ? `OmniRoute: ${t('status.ready')} · ${modelCount(models.length)}`
        : omnirouteStatus.state === 'starting'
          ? `OmniRoute: ${t('settings.omnirouteStarting')}`
          : omnirouteStatus.state === 'error'
            ? `OmniRoute: ${t('status.notConnected')}`
            : `OmniRoute: ${t('settings.omnirouteStopped')}`
  } else if (isWProvider) {
    if (wproviderChecking) {
      dotColor = CONN_COLOR.connecting
      label = `${wproviderLabel} Web: ${t('status.checking')}`
    } else if (!wproviderCheck) {
      dotColor = CONN_COLOR.unknown
      label = `${wproviderLabel} Web: —`
    } else if (!wproviderCheck.loggedIn) {
      dotColor = CONN_COLOR.error
      label = `${wproviderLabel} Web: ${t('status.signInNeeded')}`
    } else {
      dotColor = CONN_COLOR.connected
      label = `${wproviderLabel} Web: ${t('status.ready')}`
    }
  } else if (isCodex || isCopilot || isClaude || isGemini || isGlm) {
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
      label = `${name}: ${t('status.checking')}`
    } else if (!check) {
      dotColor = CONN_COLOR.unknown
      label = `${name}: —`
    } else if (!check.installed) {
      dotColor = CONN_COLOR.error
      label = `${name}: ${t('status.notFound')}`
    } else if ((isCodex || isGemini) && !check.loggedIn) {
      dotColor = CONN_COLOR.error
      label = `${name}: ${t('status.signInNeeded')}`
    } else {
      dotColor = CONN_COLOR.connected
      label = `${name}: ${t('status.ready')}`
    }
  } else {
    dotColor = CONN_COLOR[connection]
    label =
      connection === 'connected' && models.length > 0
        ? `LM Studio: ${t('status.connected')} · ${modelCount(models.length)}`
        : `LM Studio: ${connectionStatusLabel(connection)}`
    if (isOpenRouter) {
      label =
        connection === 'connected' && models.length > 0
          ? `OpenRouter: ${t('status.connected')} - ${modelCount(models.length)}`
          : `OpenRouter: ${connectionStatusLabel(connection)}`
    } else if (isOllama) {
      label =
        connection === 'connected' && models.length > 0
          ? `Ollama: ${t('status.connected')} - ${modelCount(models.length)}`
          : `Ollama: ${connectionStatusLabel(connection)}`
    }
  }

  const modelLabel = isOmniroute
    ? omnirouteModel || 'auto'
    : isWProvider
    ? `${wproviderLabel} · Web`
    : isGlm
    ? 'GLM (ZCode)'
    : isGemini
      ? geminiModel || t('status.defaultGemini')
    : isClaude
      ? claudeModel || t('status.defaultClaude')
      : isCopilot
        ? copilotModel || t('status.defaultCopilot')
      : isCodex
        ? codexModel || t('status.defaultCodex')
        : isOpenRouter
          ? openRouterModel || 'openrouter/free'
        : isOllama
          ? ollamaModel || 'ollama'
        : model || t('status.noModel')

  const accessLabel = isCodex
    ? `${t('status.sandbox')}: ${codexSandbox}${codexReasoning ? ` · ${t(REASONING_LABEL_KEY[codexReasoning])}` : ''}`
    : isCopilot
      ? `${t('status.access')}: ${t(COPILOT_PERMISSION_SHORT_KEY[copilotPermission])}${copilotReasoning ? ` · ${t(COPILOT_REASONING_LABEL_KEY[copilotReasoning])}` : ''}`
    : isClaude
      ? `${t('status.access')}: ${t(PERMISSION_SHORT_KEY[claudePermission])}`
      : isGemini
        ? `${t('status.access')}: ${t(GEMINI_PERMISSION_SHORT_KEY[geminiPermission])}`
      : isGlm
        ? `${t('status.mode')}: ${t(GLM_MODE_SHORT_KEY[glmMode])}`
        : mode === 'ask'
          ? t(MODE_LABEL_KEY[mode])
          : t('status.autoApply')

  const ipLabel = publicIp.state === 'checking'
    ? t('status.ipChecking')
    : publicIp.ip
      ? `${t('status.publicIp')}: ${publicIp.ip}${publicIp.countryCode ? ` · ${publicIp.countryCode}` : ''}${publicIp.vpnRecommended ? ` · ${t('status.vpnNeeded')}` : ''}`
      : t('status.ipUnavailable')

  return (
    <div className="statusbar">
      <button
        className="seg seg-btn"
        onClick={() => setSettingsOpen(true)}
        title={t('rail.agentBackendSettings')}
      >
        <span style={{ color: dotColor }}>●</span> {label}
      </button>
      <span className="seg">{modelLabel}</span>
      <span className="seg">{accessLabel}</span>
      <button
        type="button"
        className={`seg seg-btn ip-seg${publicIp.vpnRecommended ? ' restricted' : publicIp.state === 'ready' ? ' safe' : ''}`}
        onClick={openVpn}
        title={t('status.openVpn')}
      >
        <Icon name="shield" size={12} /> {ipLabel}
      </button>
      <span className="spacer" />
      {usageWin && (
        <button
          className={`seg seg-btn usage-seg${usageWin.severity !== 'normal' ? ' usage-warn' : ''}`}
          onClick={() => setUsageOpen(true)}
          title={t('status.usageTitle', {
            percent: usageWin.percent,
            label: usageWin.label,
            reset: usageWin.resetsAt ? ` · ${resetLabel(usageWin.resetsAt, appLanguage)}` : ''
          })}
        >
          <Icon name="barChart" size={12} /> {usageWin.percent}% {usageWin.label}
        </button>
      )}
      {sshConn && (
        <button
          className="seg seg-btn ssh-on"
          onClick={() => openSshTerminal(sshConn.id)}
          title={t('status.activeSshContext', { host: `${sshConn.username}@${sshConn.host}` })}
        >
          <Icon name="terminal" size={12} /> {sshConn.username}@{sshConn.host}
        </button>
      )}
      {!activeSsh && isHtml && (
        <span className="live-controls">
          <button
            type="button"
            className={`seg seg-btn${liveUrl ? ' live-on' : ''}`}
            onClick={() => void goLive(liveTarget)}
            title={
              liveTarget === 'browser'
                ? t('status.openLiveInBrowser')
                : t('status.openLiveInAscora')
            }
          >
            <Icon name="globe" size={12} />
            {liveUrl ? `Live${livePort ? ` :${livePort}` : ''}` : t('status.goLive')}
          </button>
          <span
            className={`live-target-picker${liveTargetOpen ? ' open' : ''}`}
            ref={liveTargetRef}
          >
            <button
              type="button"
              className="seg seg-btn live-target-toggle"
              title={t('status.chooseLiveTarget')}
              aria-label={t('status.chooseLiveTarget')}
              aria-haspopup="listbox"
              aria-expanded={liveTargetOpen}
              aria-controls={liveTargetMenuId}
              onClick={() => setLiveTargetOpen((open) => !open)}
            >
              <Icon name="chevronDown" size={10} />
            </button>
            {liveTargetOpen && (
              <div
                className="live-target-menu"
                id={liveTargetMenuId}
                role="listbox"
                aria-label={t('status.chooseLiveTarget')}
              >
                <button
                  type="button"
                  className="live-target-option"
                  role="option"
                  aria-selected={liveTarget === 'ascora'}
                  onClick={() => chooseLiveTarget('ascora')}
                >
                  <Icon name="maximize" size={13} />
                  <span>{t('status.openLiveInAscora')}</span>
                  {liveTarget === 'ascora' && <Icon name="check" size={13} />}
                </button>
                <button
                  type="button"
                  className="live-target-option"
                  role="option"
                  aria-selected={liveTarget === 'browser'}
                  onClick={() => chooseLiveTarget('browser')}
                >
                  <Icon name="external" size={13} />
                  <span>{t('status.openLiveInBrowser')}</span>
                  {liveTarget === 'browser' && <Icon name="check" size={13} />}
                </button>
              </div>
            )}
          </span>
          {liveUrl && (
            <button
              type="button"
              className="seg seg-btn live-stop"
              onClick={() => void stopLive()}
              title={t('status.stopLiveServer')}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </span>
      )}
      {current && <span className="seg">{current.language}</span>}
      <span className="seg">{active ? active.path : t('status.noFolderOpen')}</span>
    </div>
  )
}
