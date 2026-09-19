import { useEffect, useRef, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import {
  CODEX_MODEL_PRESETS,
  COPILOT_MODEL_PRESETS,
  GEMINI_MODEL_PRESETS,
  GROK_MODEL_PRESETS,
  openRouterModelOptions,
  REASONING_LABEL_KEY,
  COPILOT_REASONING_LABEL_KEY,
  CLAUDE_EFFORT_LABEL_KEY,
  GROK_REASONING_LABEL_KEY,
  SANDBOX_SHORT_KEY,
  COPILOT_PERMISSION_SHORT_KEY,
  PERMISSION_SHORT_KEY,
  GEMINI_PERMISSION_SHORT_KEY,
  GROK_PERMISSION_SHORT_KEY,
  GLM_MODE_SHORT_KEY
} from './Composer'
import { useApp } from '@/state/store'
import { tr, type TranslationKey } from '@/language'
import {
  DEFAULT_LLM_CONFIG,
  WPROVIDER_SERVICES,
  WPROVIDER_SERVICE_INFO,
  CODEX_REASONING_LEVELS,
  COPILOT_PERMISSION_MODES,
  COPILOT_REASONING_LEVELS,
  CLAUDE_EFFORT_LEVELS,
  CLAUDE_MODEL_LABEL,
  CLAUDE_MODEL_PRESETS,
  CLAUDE_PERMISSION_MODES,
  GEMINI_APPROVAL_MODES,
  GROK_PERMISSION_MODES,
  GROK_REASONING_LEVELS,
  GLM_MODES,
  normalizeOpenRouterApiKey,
  type CodexReasoning,
  type CodexSandbox,
  type CopilotPermissionMode,
  type CopilotReasoning,
  type ClaudeEffort,
  type ClaudePermissionMode,
  type GeminiApprovalMode,
  type GrokPermissionMode,
  type GrokReasoning,
  type GlmMode,
  type AntigravityModel,
  type AntigravityReasoning,
  antigravityReasoningLevels,
  type LlmProvider,
  type WProviderAuthorization,
  type WProviderService
} from '@shared/ipc'

function useT(): (key: TranslationKey, values?: Record<string, string | number>) => string {
  const appLanguage = useApp((s) => s.appLanguage)
  return (key, values) => tr(appLanguage, key, values)
}

interface CliAuthState {
  busy: boolean
  status: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Sign-in/sign-out actions for a CLI backend. Login opens an external
 * terminal, so after launching it the hook re-checks the auth state on window
 * focus and every few seconds until the account shows up.
 */
function useCliAuth(
  login: () => Promise<{ ok: boolean; error?: string }>,
  logout: () => Promise<{ ok: boolean; error?: string }>,
  loggedIn: boolean | undefined,
  recheck: () => Promise<void>
): CliAuthState {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)

  useEffect(() => {
    if (!watching) return
    if (loggedIn) {
      setWatching(false)
      setStatus(t('settings.signedIn'))
      return
    }
    const onFocus = (): void => void recheck()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void recheck(), 5000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
    // `t` is recreated per render and would restart the watcher every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, loggedIn, recheck])

  const signIn = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await login()
      setStatus(result.ok ? t('settings.loginTerminalOpened') : result.error ?? t('settings.loginFailed'))
      if (result.ok) setWatching(true)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('settings.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    setWatching(false)
    try {
      const result = await logout()
      setStatus(result.ok ? t('settings.signedOut') : result.error ?? t('settings.logoutFailed'))
      await recheck()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('settings.logoutFailed'))
    } finally {
      setBusy(false)
    }
  }

  return { busy, status, signIn, signOut }
}

function useProviderModels(provider: LlmProvider) {
  const configKey = useApp((s) => provider === 'openrouter' ? `${s.openRouterEnabled}:${s.openRouterApiKey}`
    : provider === 'unsloth' ? `${s.unslothBaseUrl}:${s.unslothApiKey}`
    : provider === 'lmstudio' ? s.baseUrl : provider === 'ollama' ? s.ollamaBaseUrl : s.omnirouteStatus.state)
  const request = useRef(0)
  const [models, setModels] = useState<string[]>([])
  const [connection, setConnection] = useState('unknown')
  const [connectionError, setConnectionError] = useState<string>()
  const refreshModels = async (): Promise<void> => {
    const id = ++request.current
    if (provider === 'unsloth' && !useApp.getState().unslothApiKey) {
      setModels([])
      setConnection('unknown')
      setConnectionError(undefined)
      if (useApp.getState().provider === provider) void useApp.getState().refreshModels()
      return
    }
    setConnection('connecting')
    try {
      const result = await api.llm.listModels(provider)
      if (id !== request.current) return
      setModels(result.ok ? (result.models ?? []).map((model) => model.id) : [])
      setConnection(result.ok ? 'connected' : 'error')
      setConnectionError(result.error)
    } catch (error) {
      if (id !== request.current) return
      setConnection('error')
      setConnectionError(String(error))
    }
    if (useApp.getState().provider === provider) void useApp.getState().refreshModels()
  }
  useEffect(() => {
    if (provider !== 'omniroute') void refreshModels()
    return () => { request.current += 1 }
  }, [provider, configKey])
  return { models, connection, connectionError, refreshModels }
}

function LmStudioPanel(): JSX.Element {
  const { models, connection, connectionError, refreshModels } = useProviderModels('lmstudio')
  const t = useT()
  const baseUrl = useApp((s) => s.baseUrl)
  const setBaseUrl = useApp((s) => s.setBaseUrl)
  const model = useApp((s) => s.model)
  const setModel = useApp((s) => s.setModel)

  const [url, setUrl] = useState(baseUrl)
  const [testing, setTesting] = useState(false)

  const test = async (): Promise<void> => {
    setTesting(true)
    await setBaseUrl(url.trim() || DEFAULT_LLM_CONFIG.baseUrl)
    await refreshModels()
    setTesting(false)
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.baseUrl')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={url}
            spellCheck={false}
            placeholder={DEFAULT_LLM_CONFIG.baseUrl}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void test()}
          />
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? t('common.testing') : t('common.test')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.endpointOpenAi', { url: DEFAULT_LLM_CONFIG.baseUrl })}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <select
          className="text-input"
          value={model || (models[0] ?? '')}
          onChange={(e) => setModel(e.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">{model || t('settings.noModels')}</option>
          ) : (
            models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
      </label>

      <div className={`conn-line ${connection}`}>
        {connection === 'connected' && `✓ ${t('settings.connectedModels', { count: models.length })}`}
        {connection === 'connecting' && t('settings.connecting')}
        {connection === 'error' && `✗ ${connectionError ?? t('settings.connectionFailed')}`}
        {connection === 'unknown' && t('settings.notTestedYet')}
      </div>
    </>
  )
}

function OllamaPanel(): JSX.Element {
  const { models, connection, connectionError, refreshModels } = useProviderModels('ollama')
  const t = useT()
  const ollamaBaseUrl = useApp((s) => s.ollamaBaseUrl)
  const setOllamaBaseUrl = useApp((s) => s.setOllamaBaseUrl)
  const ollamaModel = useApp((s) => s.ollamaModel)
  const setOllamaModel = useApp((s) => s.setOllamaModel)

  const [url, setUrl] = useState(ollamaBaseUrl)
  const [testing, setTesting] = useState(false)

  const test = async (): Promise<void> => {
    setTesting(true)
    await setOllamaBaseUrl(url.trim() || DEFAULT_LLM_CONFIG.ollamaBaseUrl)
    await refreshModels()
    setTesting(false)
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.baseUrl')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={url}
            spellCheck={false}
            placeholder={DEFAULT_LLM_CONFIG.ollamaBaseUrl}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void test()}
          />
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? t('common.testing') : t('common.test')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.ollamaEndpoint', { url: DEFAULT_LLM_CONFIG.ollamaBaseUrl })}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <select
          className="text-input"
          value={ollamaModel || (models[0] ?? '')}
          onChange={(e) => setOllamaModel(e.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">{ollamaModel || t('settings.noModels')}</option>
          ) : (
            models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
      </label>

      <div className={`conn-line ${connection}`}>
        {connection === 'connected' && `Ollama ${t('settings.connectedModels', { count: models.length })}`}
        {connection === 'connecting' && `${t('settings.connecting')} Ollama`}
        {connection === 'error' && `Ollama: ${connectionError ?? t('settings.connectionFailed')}`}
        {connection === 'unknown' && t('settings.notTestedYet')}
      </div>
    </>
  )
}

function UnslothPanel(): JSX.Element {
  const t = useT()
  const baseUrl = useApp((s) => s.unslothBaseUrl)
  const apiKey = useApp((s) => s.unslothApiKey)
  const model = useApp((s) => s.unslothModel)
  const setModel = useApp((s) => s.setUnslothModel)
  const setConnection = useApp((s) => s.setUnslothConnection)
  const { models, connection, connectionError, refreshModels } = useProviderModels('unsloth')
  const [url, setUrl] = useState(baseUrl)
  const [key, setKey] = useState(apiKey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (connection === 'connected' && !models.includes(model)) setModel(models[0] ?? '')
  }, [models, connection, model, setModel])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const changed = url !== baseUrl || key !== apiKey
      await setConnection(url, key)
      setUrl(useApp.getState().unslothBaseUrl)
      setKey(useApp.getState().unslothApiKey)
      // Changed saved settings trigger the hook's refresh automatically.
      if (!changed || (useApp.getState().unslothBaseUrl === baseUrl && useApp.getState().unslothApiKey === apiKey)) await refreshModels()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setSaving(false) }
  }

  return <div className="unsloth-settings provider-settings-form">
    <p className="field-hint">{t('settings.unslothHint')}</p>
    <label className="field">
      <span className="field-label">{t('settings.baseUrl')}</span>
      <input className="text-input" type="url" value={url} spellCheck={false}
        placeholder={DEFAULT_LLM_CONFIG.unslothBaseUrl} onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !saving) void save() }} />
      <span className="field-hint">{t('settings.unslothUrlHint')}</span>
    </label>
    <label className="field">
      <span className="field-label">{t('settings.unslothApiKey')}</span>
      <input className="text-input" type="password" value={key} autoComplete="off" spellCheck={false}
        placeholder="sk-unsloth-…" onChange={(event) => setKey(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !saving) void save() }} />
      <span className="field-hint">{t('settings.unslothKeyHint')}</span>
    </label>
    <div className="field-row">
      <button className="btn" disabled={saving || connection === 'connecting'} onClick={() => void save()}>
        {saving || connection === 'connecting' ? t('common.testing') : t('settings.saveAndTest')}
      </button>
      <button className="btn" onClick={() => void api.live.openExternal('https://unsloth.ai/docs/basics/api')}>{t('settings.unslothGuide')}</button>
    </div>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <div className={`conn-line ${connection}`} role="status">
      {connection === 'connected' && `✓ Unsloth: ${t('settings.connectedModels', { count: models.length })}`}
      {connection === 'connecting' && t('settings.connecting')}
      {connection === 'error' && `Unsloth: ${connectionError ?? t('settings.connectionFailed')}`}
      {connection === 'unknown' && t('settings.unslothKeyRequired')}
    </div>
    <label className="field">
      <span className="field-label">{t('common.model')}</span>
      <select className="text-input" value={models.includes(model) ? model : models[0] ?? ''}
        disabled={!models.length || connection !== 'connected'} onChange={(event) => setModel(event.target.value)}>
        {models.length ? models.map((id) => <option key={id} value={id}>{id}</option>) : <option value="">{t('settings.noModels')}</option>}
      </select>
      <span className="field-hint">{t('settings.unslothModelsHint')}</span>
    </label>
    <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!apiKey || saving || connection === 'connecting'} onClick={() => void refreshModels()}>{t('settings.refreshModels')}</button>
  </div>
}

interface OmniRouteProviderConnection {
  id: string
  provider?: string
  name?: string
  testStatus?: string
  isActive?: boolean
}

function omniAdminError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string' && error.trim()) return error
  }
  return fallback
}

function omniConnections(body: unknown): OmniRouteProviderConnection[] {
  if (Array.isArray(body)) return body as OmniRouteProviderConnection[]
  if (!body || typeof body !== 'object') return []
  const value = body as {
    connections?: unknown
    providers?: unknown
    data?: unknown
  }
  const list = value.connections ?? value.providers ?? value.data
  return Array.isArray(list) ? (list as OmniRouteProviderConnection[]) : []
}

function OmniRoutePanel(): JSX.Element {
  const { models, refreshModels } = useProviderModels('omniroute')
  const t = useT()
  const status = useApp((s) => s.omnirouteStatus)
  const model = useApp((s) => s.omnirouteModel)
  const setModel = useApp((s) => s.setOmnirouteModel)
  const start = useApp((s) => s.startOmniroute)
  const stop = useApp((s) => s.stopOmniroute)
  const openOmniroutePage = useApp((s) => s.openOmniroutePage)
  const [connections, setConnections] = useState<OmniRouteProviderConnection[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadConnections = async (): Promise<void> => {
    const result = await api.omniroute.admin({ method: 'GET', path: '/api/providers' })
    if (!result.ok) {
      setMessage(result.error ?? omniAdminError(result.body, t('settings.omnirouteProvidersLoadError')))
      return
    }
    setConnections(omniConnections(result.body))
  }

  useEffect(() => {
    if (status.state === 'ready') { void loadConnections(); void refreshModels() }
    else setConnections([])
    // The loader only depends on the sidecar transition; form state should not
    // cause admin requests while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state])

  const testProvider = async (id: string): Promise<void> => {
    setBusy(`test:${id}`)
    setMessage(null)
    const result = await api.omniroute.admin({
      method: 'POST',
      path: `/api/providers/${encodeURIComponent(id)}/test`
    })
    setMessage(
      result.ok
        ? t('settings.omnirouteTestSucceeded')
        : result.error ?? omniAdminError(result.body, t('settings.omnirouteTestFailed'))
    )
    await loadConnections()
    if (result.ok) await refreshModels()
    setBusy(null)
  }

  const deleteProvider = async (id: string): Promise<void> => {
    setBusy(`delete:${id}`)
    setMessage(null)
    const result = await api.omniroute.admin({
      method: 'DELETE',
      path: `/api/providers/${encodeURIComponent(id)}`
    })
    if (!result.ok) {
      setMessage(result.error ?? omniAdminError(result.body, t('settings.omnirouteDeleteError')))
    }
    await loadConnections()
    await refreshModels()
    setBusy(null)
  }

  const startingText =
    (status.startingForMs ?? 0) >= 10_000
      ? t('settings.omnirouteFirstStart')
      : t('settings.omnirouteStarting')

  return (
    <>
      <div className={`conn-line ${status.state === 'ready' ? 'connected' : status.state === 'starting' ? 'connecting' : status.state}`}>
        {status.state === 'stopped' && t('settings.omnirouteStopped')}
        {status.state === 'starting' && startingText}
        {status.state === 'ready' &&
          `✓ ${t('settings.omnirouteReady', { count: models.length })} · OmniRoute ${status.version ?? ''} · 127.0.0.1:${status.port ?? ''}`}
        {status.state === 'error' && `✗ ${status.error ?? t('settings.omnirouteError')}`}
      </div>

      <div className="field-row" style={{ alignSelf: 'flex-start' }}>
        {status.state === 'ready' || status.state === 'starting' ? (
          <button className="btn" onClick={() => void stop()}>{t('settings.omnirouteStop')}</button>
        ) : (
          <button className="btn" onClick={() => void start()}>{status.state === 'error' ? t('settings.omnirouteRetry') : t('settings.omnirouteStart')}</button>
        )}
        {status.state === 'error' && status.logsPath && (
          <button className="btn" onClick={() => void api.fs.openPath(status.logsPath)}>
            {t('settings.omnirouteOpenLogs')}
          </button>
        )}
      </div>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <select
          className="text-input"
          value={model || (models[0] ?? '')}
          onChange={(event) => setModel(event.target.value)}
          disabled={status.state !== 'ready' || models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">{model || t('settings.noModels')}</option>
          ) : (
            models.map((item) => <option key={item} value={item}>{item}</option>)
          )}
        </select>
      </label>

      {status.state === 'ready' && (
        <section className="omniroute-providers" aria-label={t('settings.omnirouteProviders')}>
          <div className="omniroute-section-title">{t('settings.omnirouteProviders')}</div>
          {connections.length === 0 ? (
            <div className="field-hint">{t('settings.omnirouteNoProviders')}</div>
          ) : (
            <div className="omniroute-provider-list">
              {connections.map((connection) => (
                <div className="omniroute-provider-row" key={connection.id}>
                  <div className="omniroute-provider-meta">
                    <strong>{connection.name || connection.provider || connection.id}</strong>
                    <span>{connection.provider || 'provider'} · {connection.testStatus || t('settings.omnirouteNotTested')}</span>
                  </div>
                  <button className="btn" disabled={busy !== null} onClick={() => void testProvider(connection.id)}>
                    {busy === `test:${connection.id}` ? t('common.testing') : t('settings.omnirouteTestProvider')}
                  </button>
                  <button className="btn omniroute-delete" disabled={busy !== null} onClick={() => void deleteProvider(connection.id)}>
                    {t('settings.omnirouteDeleteProvider')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="btn" onClick={() => openOmniroutePage('/dashboard/providers')}>
            <Icon name="plug" size={14} />
            {t('settings.omnirouteOpenCatalog')}
          </button>
          {message && <div className="field-hint omniroute-message">{message}</div>}
        </section>
      )}
    </>
  )
}

function CodexPanel(): JSX.Element {
  const t = useT()
  const codexPath = useApp((s) => s.codexPath)
  const setCodexPath = useApp((s) => s.setCodexPath)
  const codexModel = useApp((s) => s.codexModel)
  const setCodexModel = useApp((s) => s.setCodexModel)
  const codexSandbox = useApp((s) => s.codexSandbox)
  const setCodexSandbox = useApp((s) => s.setCodexSandbox)
  const codexReasoning = useApp((s) => s.codexReasoning)
  const setCodexReasoning = useApp((s) => s.setCodexReasoning)
  const check = useApp((s) => s.codexCheck)
  const checking = useApp((s) => s.codexChecking)
  const checkCodex = useApp((s) => s.checkCodex)
  const auth = useCliAuth(api.codex.login, api.codex.logout, check?.loggedIn, checkCodex)

  const [path, setPath] = useState(codexPath)

  const apply = async (): Promise<void> => {
    await setCodexPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.codexBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectCodex')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.codexHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="codex-model-presets"
          value={codexModel}
          spellCheck={false}
          placeholder={t('composer.codexDefault')}
          onChange={(e) => setCodexModel(e.target.value)}
        />
        <datalist id="codex-model-presets">
          {CODEX_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.sandbox')}</span>
        <select
          className="text-input"
          value={codexSandbox}
          onChange={(e) => setCodexSandbox(e.target.value as CodexSandbox)}
        >
          {(Object.keys(SANDBOX_SHORT_KEY) as CodexSandbox[]).map((s) => (
            <option key={s} value={s}>
              {t(SANDBOX_SHORT_KEY[s])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.codexPolicyHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('composer.reasoningEffort')}</span>
        <select
          className="text-input"
          value={codexReasoning}
          onChange={(e) => setCodexReasoning(e.target.value as CodexReasoning | '')}
        >
          <option value="">{t('settings.autoCodexDefault')}</option>
          {CODEX_REASONING_LEVELS.map((r) => (
            <option key={r} value={r}>
              {t(REASONING_LABEL_KEY[r])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.reasoningHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Codex' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? t('settings.cliNotFound', { name: 'Codex CLI' })}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'codex'} ·{' '}
            {check.loggedIn
              ? [check.authNote ?? t('settings.signedIn'), check.account].filter(Boolean).join(' · ')
              : t('settings.notSignedInCodex')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.codexSigninHint')}
        </div>
      )}

      <div className="field-row" style={{ alignSelf: 'flex-start' }}>
        {check?.installed && !check.loggedIn && (
          <button className="btn btn-icon" onClick={() => void auth.signIn()} disabled={auth.busy || checking}>
            <Icon name="terminal" size={14} />
            {t('settings.signIn')}
          </button>
        )}
        {check?.installed && check.loggedIn && (
          <button className="btn" onClick={() => void auth.signOut()} disabled={auth.busy || checking}>
            {t('settings.signOut')}
          </button>
        )}
        <button className="btn" onClick={() => void checkCodex()} disabled={checking}>
          {t('settings.recheck')}
        </button>
      </div>
      {auth.status && <div className="field-hint">{auth.status}</div>}
    </>
  )
}

function CopilotPanel(): JSX.Element {
  const t = useT()
  const copilotPath = useApp((s) => s.copilotPath)
  const setCopilotPath = useApp((s) => s.setCopilotPath)
  const copilotModel = useApp((s) => s.copilotModel)
  const setCopilotModel = useApp((s) => s.setCopilotModel)
  const copilotPermission = useApp((s) => s.copilotPermission)
  const setCopilotPermission = useApp((s) => s.setCopilotPermission)
  const copilotReasoning = useApp((s) => s.copilotReasoning)
  const setCopilotReasoning = useApp((s) => s.setCopilotReasoning)
  const check = useApp((s) => s.copilotCheck)
  const checking = useApp((s) => s.copilotChecking)
  const checkCopilot = useApp((s) => s.checkCopilot)
  const setCopilotAuthOpen = useApp((s) => s.setCopilotAuthOpen)

  const [path, setPath] = useState(copilotPath)

  const apply = async (): Promise<void> => {
    await setCopilotPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.copilotBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectPath')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.copilotHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="copilot-model-presets"
          value={copilotModel}
          spellCheck={false}
          placeholder={t('composer.copilotDefault')}
          onChange={(e) => setCopilotModel(e.target.value)}
        />
        <datalist id="copilot-model-presets">
          {COPILOT_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.permissionProfile')}</span>
        <select
          className="text-input"
          value={copilotPermission}
          onChange={(e) => setCopilotPermission(e.target.value as CopilotPermissionMode)}
        >
          {COPILOT_PERMISSION_MODES.map((p) => (
            <option key={p} value={p}>
              {t(COPILOT_PERMISSION_SHORT_KEY[p])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.copilotPolicyHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('composer.reasoningEffort')}</span>
        <select
          className="text-input"
          value={copilotReasoning}
          onChange={(e) => setCopilotReasoning(e.target.value as CopilotReasoning | '')}
        >
          <option value="">{t('settings.autoCopilotDefault')}</option>
          {COPILOT_REASONING_LEVELS.map((r) => (
            <option key={r} value={r}>
              {t(COPILOT_REASONING_LABEL_KEY[r])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.copilotReasoningHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Copilot' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `x ${check.error ?? t('settings.cliNotFound', { name: 'GitHub Copilot CLI' })}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'copilot'} · {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.copilotLoginHint')}
        </div>
      )}

      <div className="field-row" style={{ alignSelf: 'flex-start' }}>
        <button className="btn btn-icon" onClick={() => setCopilotAuthOpen(true)}>
          <Icon name="terminal" size={14} />
          {t('settings.authorize')}
        </button>
        <button className="btn" onClick={() => void checkCopilot()} disabled={checking}>
          {t('settings.recheck')}
        </button>
      </div>
    </>
  )
}

function ClaudePanel(): JSX.Element {
  const t = useT()
  const claudePath = useApp((s) => s.claudePath)
  const setClaudePath = useApp((s) => s.setClaudePath)
  const claudeModel = useApp((s) => s.claudeModel)
  const setClaudeModel = useApp((s) => s.setClaudeModel)
  const claudePermission = useApp((s) => s.claudePermission)
  const setClaudePermission = useApp((s) => s.setClaudePermission)
  const claudeEffort = useApp((s) => s.claudeEffort)
  const setClaudeEffort = useApp((s) => s.setClaudeEffort)
  const claudeThinking = useApp((s) => s.claudeThinking)
  const setClaudeThinking = useApp((s) => s.setClaudeThinking)
  const check = useApp((s) => s.claudeCheck)
  const checking = useApp((s) => s.claudeChecking)
  const checkClaude = useApp((s) => s.checkClaude)
  const auth = useCliAuth(api.claude.login, api.claude.logout, check?.loggedIn, checkClaude)

  const [path, setPath] = useState(claudePath)
  const apply = async (): Promise<void> => {
    await setClaudePath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.claudeBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectClaude')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.claudeHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="claude-model-presets"
          value={claudeModel}
          spellCheck={false}
          placeholder={t('settings.claudeModelPlaceholder')}
          onChange={(e) => setClaudeModel(e.target.value)}
        />
        <datalist id="claude-model-presets">
          {CLAUDE_MODEL_PRESETS.map((m) => (
            <option key={m} value={m}>
              {CLAUDE_MODEL_LABEL[m] ?? m}
            </option>
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.permissionMode')}</span>
        <select
          className="text-input"
          value={claudePermission}
          onChange={(e) => setClaudePermission(e.target.value as ClaudePermissionMode)}
        >
          {CLAUDE_PERMISSION_MODES.map((p) => (
            <option key={p} value={p}>
              {t(PERMISSION_SHORT_KEY[p])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.claudePolicyHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('composer.claudeEffort')}</span>
        <select
          className="text-input"
          value={claudeEffort}
          onChange={(e) => setClaudeEffort(e.target.value as ClaudeEffort | '')}
        >
          <option value="">{t('settings.autoClaudeDefault')}</option>
          {CLAUDE_EFFORT_LEVELS.map((r) => (
            <option key={r} value={r}>
              {t(CLAUDE_EFFORT_LABEL_KEY[r])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.claudeEffortHint')}
        </span>
      </label>

      <div className="field">
        <span className="field-label">{t('composer.thinking')}</span>
        <div className="field-row" style={{ alignItems: 'center' }}>
          <label className="skill-toggle" title={t('composer.thinkingHint')}>
            <input
              type="checkbox"
              checked={claudeThinking}
              onChange={(e) => setClaudeThinking(e.target.checked)}
            />
          </label>
          <span className="field-hint">{t('settings.claudeThinkingHint')}</span>
        </div>
      </div>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Claude' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? t('settings.cliNotFound', { name: 'Claude Code CLI' })}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'claude'} ·{' '}
            {[check.authNote ?? t('settings.ready'), check.account].filter(Boolean).join(' · ')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      <div className="field-row" style={{ alignSelf: 'flex-start' }}>
        {check?.installed && !check.loggedIn && (
          <button className="btn btn-icon" onClick={() => void auth.signIn()} disabled={auth.busy || checking}>
            <Icon name="terminal" size={14} />
            {t('settings.signIn')}
          </button>
        )}
        {check?.installed && check.loggedIn && (
          <button className="btn" onClick={() => void auth.signOut()} disabled={auth.busy || checking}>
            {t('settings.signOut')}
          </button>
        )}
        <button className="btn" onClick={() => void checkClaude()} disabled={checking}>
          {t('settings.recheck')}
        </button>
      </div>
      {auth.status && <div className="field-hint">{auth.status}</div>}
    </>
  )
}

function GeminiPanel(): JSX.Element {
  const t = useT()
  const geminiPath = useApp((s) => s.geminiPath)
  const setGeminiPath = useApp((s) => s.setGeminiPath)
  const geminiModel = useApp((s) => s.geminiModel)
  const setGeminiModel = useApp((s) => s.setGeminiModel)
  const geminiPermission = useApp((s) => s.geminiPermission)
  const setGeminiPermission = useApp((s) => s.setGeminiPermission)
  const check = useApp((s) => s.geminiCheck)
  const checking = useApp((s) => s.geminiChecking)
  const checkGemini = useApp((s) => s.checkGemini)

  const [path, setPath] = useState(geminiPath)
  const apply = async (): Promise<void> => {
    await setGeminiPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.geminiBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectPath')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.geminiHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="gemini-model-presets"
          value={geminiModel}
          spellCheck={false}
          placeholder={t('settings.geminiModelPlaceholder')}
          onChange={(e) => setGeminiModel(e.target.value)}
        />
        <datalist id="gemini-model-presets">
          {GEMINI_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.approvalMode')}</span>
        <select
          className="text-input"
          value={geminiPermission}
          onChange={(e) => setGeminiPermission(e.target.value as GeminiApprovalMode)}
        >
          {GEMINI_APPROVAL_MODES.map((p) => (
            <option key={p} value={p}>
              {t(GEMINI_PERMISSION_SHORT_KEY[p])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.geminiPolicyHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Gemini' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? t('settings.cliNotFound', { name: 'Gemini CLI' })}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'gemini'} · {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.geminiLoginHint')}
        </div>
      )}

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void checkGemini()}
        disabled={checking}
      >
        {t('settings.recheck')}
      </button>
    </>
  )
}

function GrokPanel(): JSX.Element {
  const t = useT()
  const grokPath = useApp((s) => s.grokPath)
  const setGrokPath = useApp((s) => s.setGrokPath)
  const grokModel = useApp((s) => s.grokModel)
  const setGrokModel = useApp((s) => s.setGrokModel)
  const grokPermission = useApp((s) => s.grokPermission)
  const setGrokPermission = useApp((s) => s.setGrokPermission)
  const grokReasoning = useApp((s) => s.grokReasoning)
  const setGrokReasoning = useApp((s) => s.setGrokReasoning)
  const check = useApp((s) => s.grokCheck)
  const checking = useApp((s) => s.grokChecking)
  const checkGrok = useApp((s) => s.checkGrok)
  const auth = useCliAuth(api.grok.login, api.grok.logout, check?.loggedIn, checkGrok)

  const [path, setPath] = useState(grokPath)
  const apply = async (): Promise<void> => {
    await setGrokPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.grokBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectPath')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">{t('settings.grokHint')}</span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="grok-model-presets"
          value={grokModel}
          spellCheck={false}
          placeholder={t('settings.grokModelPlaceholder')}
          onChange={(e) => setGrokModel(e.target.value)}
        />
        <datalist id="grok-model-presets">
          {GROK_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.permissionMode')}</span>
        <select
          className="text-input"
          value={grokPermission}
          onChange={(e) => setGrokPermission(e.target.value as GrokPermissionMode)}
        >
          {GROK_PERMISSION_MODES.map((p) => (
            <option key={p} value={p}>
              {t(GROK_PERMISSION_SHORT_KEY[p])}
            </option>
          ))}
        </select>
        <span className="field-hint">{t('settings.grokPolicyHint')}</span>
      </label>

      <label className="field">
        <span className="field-label">{t('composer.grokReasoning')}</span>
        <select
          className="text-input"
          value={grokReasoning}
          onChange={(e) => setGrokReasoning(e.target.value as GrokReasoning | '')}
        >
          <option value="">{t('composer.reasoningAuto')}</option>
          {GROK_REASONING_LEVELS.map((r) => (
            <option key={r} value={r}>
              {t(GROK_REASONING_LABEL_KEY[r])}
            </option>
          ))}
        </select>
      </label>

      <div
        className={`conn-line ${
          checking
            ? 'connecting'
            : !check
              ? 'unknown'
              : check.installed && check.loggedIn
                ? 'connected'
                : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Grok' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? t('settings.cliNotFound', { name: 'Grok CLI' })}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'grok'} ·{' '}
            {check.account
              ? check.account
              : check.loggedIn
                ? (check.authNote ?? t('settings.ready'))
                : t('status.signInNeeded')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">{t('settings.grokLoginHint')}</div>
      )}

      <div className="field-row" style={{ alignSelf: 'flex-start' }}>
        {check?.installed && !check.loggedIn && (
          <button className="btn btn-icon" onClick={() => void auth.signIn()} disabled={auth.busy || checking}>
            <Icon name="terminal" size={14} />
            {t('settings.signIn')}
          </button>
        )}
        {check?.installed && check.loggedIn && (
          <button className="btn" onClick={() => void auth.signOut()} disabled={auth.busy || checking}>
            {t('settings.signOut')}
          </button>
        )}
        <button className="btn" onClick={() => void checkGrok()} disabled={checking}>
          {t('settings.recheck')}
        </button>
      </div>
      {auth.status && <div className="field-hint">{auth.status}</div>}
    </>
  )
}

function GlmPanel(): JSX.Element {
  const t = useT()
  const glmPath = useApp((s) => s.glmPath)
  const setGlmPath = useApp((s) => s.setGlmPath)
  const glmMode = useApp((s) => s.glmMode)
  const setGlmMode = useApp((s) => s.setGlmMode)
  const check = useApp((s) => s.glmCheck)
  const checking = useApp((s) => s.glmChecking)
  const checkGlm = useApp((s) => s.checkGlm)

  const [path, setPath] = useState(glmPath)
  const apply = async (): Promise<void> => {
    await setGlmPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.zcodePath')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectZcode')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.zcodeHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.permissionMode')}</span>
        <select
          className="text-input"
          value={glmMode}
          onChange={(e) => setGlmMode(e.target.value as GlmMode)}
        >
          {GLM_MODES.map((m) => (
            <option key={m} value={m}>
              {t(GLM_MODE_SHORT_KEY[m])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.zcodePolicyHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking
            ? 'connecting'
            : !check
              ? 'unknown'
              : check.installed && check.loggedIn
                ? 'connected'
                : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'ZCode' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? t('settings.cliNotFound', { name: 'ZCode' })}`}
        {!checking && check && check.installed && (
          <>
            {check.loggedIn ? '✓' : '⚠'} {check.version ? `zcode ${check.version}` : 'zcode'} ·{' '}
            {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.zcodeSigninHint')}
        </div>
      )}

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void checkGlm()}
        disabled={checking}
      >
        {t('settings.recheck')}
      </button>
    </>
  )
}

function AntigravityPanel(): JSX.Element {
  const t = useT()
  const antigravityPath = useApp((s) => s.antigravityPath)
  const setAntigravityPath = useApp((s) => s.setAntigravityPath)
  const antigravityModel = useApp((s) => s.antigravityModel)
  const setAntigravityModel = useApp((s) => s.setAntigravityModel)
  const antigravityReasoning = useApp((s) => s.antigravityReasoning)
  const setAntigravityReasoning = useApp((s) => s.setAntigravityReasoning)
  const check = useApp((s) => s.antigravityCheck)
  const checking = useApp((s) => s.antigravityChecking)
  const checkAntigravity = useApp((s) => s.checkAntigravity)

  const [path, setPath] = useState(antigravityPath)
  const apply = async (): Promise<void> => {
    await setAntigravityPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.antigravityPath')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.antigravityAutoDetect')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.antigravityPathHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.antigravityModel')}</span>
        <select
          className="text-input"
          value={antigravityModel || 'flash'}
          onChange={(e) => setAntigravityModel(e.target.value as AntigravityModel)}
        >
          <optgroup label="Gemini">
            <option value="flash_lite">Gemini 3.8 Flash</option>
            <option value="flash">Gemini 3.7 Flash</option>
            <option value="flash_36">Gemini 3.6 Flash</option>
            <option value="pro">Gemini 3.1 Pro</option>
          </optgroup>
          <optgroup label="Claude">
            <option value="claude_sonnet">Claude Sonnet 4.6</option>
            <option value="claude_opus">Claude Opus 4.6</option>
          </optgroup>
          <optgroup label="GPT">
            <option value="gpt_oss">GPT-OSS-120B</option>
          </optgroup>
        </select>
        <span className="field-hint">
          {t('settings.antigravityModelHint')}
        </span>
      </label>

      {antigravityReasoningLevels(antigravityModel).length > 0 && <label className="field">
        <span className="field-label">{t('settings.reasoningLevel')}</span>
        <select className="text-input antigravity-reasoning-select" value={antigravityReasoning}
          onChange={(e) => setAntigravityReasoning(e.target.value as AntigravityReasoning)}>
          {antigravityReasoningLevels(antigravityModel).map((level) => <option key={level} value={level}>{t(REASONING_LABEL_KEY[level])}</option>)}
        </select>
      </label>}

      <div
        className={`conn-line ${
          checking
            ? 'connecting'
            : !check
              ? 'unknown'
              : check.installed && check.loggedIn
                ? 'connected'
                : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Antigravity' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? t('settings.cliNotFound', { name: 'Antigravity' })}`}
        {!checking && check && check.installed && (
          <>
            {check.loggedIn ? '✓' : '⚠'} {check.version ?? 'Antigravity'} ·{' '}
            {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void checkAntigravity()}
        disabled={checking}
      >
        {t('settings.recheck')}
      </button>
    </>
  )
}

function WProviderPanel(): JSX.Element {
  const t = useT()
  const check = useApp((s) => s.wproviderCheck)
  const checks = useApp((s) => s.wproviderChecks)
  const checking = useApp((s) => s.wproviderChecking)
  const checkingAll = useApp((s) => s.wproviderCheckingAll)
  const checkProgress = useApp((s) => s.wproviderCheckProgress)
  const checkSummary = useApp((s) => s.wproviderCheckSummary)
  const loggingIn = useApp((s) => s.wproviderLoggingIn)
  const wproviderService = useApp((s) => s.wproviderService)
  const setWProviderService = useApp((s) => s.setWProviderService)
  const checkWProvider = useApp((s) => s.checkWProvider)
  const checkAllWProviders = useApp((s) => s.checkAllWProviders)
  const startWProviderAutoCheck = useApp((s) => s.startWProviderAutoCheck)
  const stopWProviderAutoCheck = useApp((s) => s.stopWProviderAutoCheck)
  const wproviderLogin = useApp((s) => s.wproviderLogin)
  const wproviderLogout = useApp((s) => s.wproviderLogout)
  const [authorizations, setAuthorizations] = useState<WProviderAuthorization[] | null>(null)
  const [authorizationLoadFailed, setAuthorizationLoadFailed] = useState(false)
  const selectedInfo = WPROVIDER_SERVICE_INFO[wproviderService]
  const checkedInfo = check ? WPROVIDER_SERVICE_INFO[check.service] : selectedInfo
  const selectedHost = selectedInfo.origin.replace(/^https?:\/\//, '')
  const confirmed = new Map(
    (authorizations ?? []).map((authorization) => [authorization.service, authorization])
  )
  const authorizedServices = WPROVIDER_SERVICES.filter((service) => {
    const liveCheck = checks[service]
    const authorization = confirmed.get(service)
    if (!liveCheck) return Boolean(authorization)
    if (liveCheck.loggedIn) return true
    // Transport/probe failures are unknown, not proof of logout. For a real
    // negative result, a later successful chat/login confirmation wins over
    // the older cached check.
    if (!liveCheck.ok) return Boolean(authorization)
    return Boolean(
      authorization && authorization.verifiedAt > (liveCheck.checkedAt ?? 0)
    )
  })

  useEffect(() => {
    let cancelled = false
    let changedSinceRequest = false
    const unsubscribe = api.wprovider.onAuthorizationsChanged((next) => {
      if (cancelled) return
      changedSinceRequest = true
      setAuthorizationLoadFailed(false)
      setAuthorizations(next)
    })
    void api.wprovider
      .authorizations()
      .then((next) => {
        if (!cancelled && !changedSinceRequest) setAuthorizations(next)
      })
      .catch(() => {
        if (!cancelled) setAuthorizationLoadFailed(true)
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    startWProviderAutoCheck()
    return stopWProviderAutoCheck
  }, [startWProviderAutoCheck, stopWProviderAutoCheck])

  return (
    <>
      <section className="wprovider-auth-card" aria-label={t('settings.wproviderAuthorizedModels')}>
        <div className="wprovider-auth-heading">
          <span>{t('settings.wproviderAuthorizedModels')}</span>
          <span className="wprovider-auth-count">
            {authorizations === null && !authorizationLoadFailed ? '…' : authorizedServices.length}
          </span>
        </div>
        {checkingAll && checkProgress ? (
          <div className="wprovider-auth-scan" role="status" aria-live="polite">
            {t(
              checkProgress.external
                ? 'settings.wproviderCheckingAllExternal'
                : 'settings.wproviderCheckingAll',
              {
                completed: checkProgress.completed,
                total: checkProgress.total,
                name: WPROVIDER_SERVICE_INFO[checkProgress.service].label
              }
            )}
            {checkProgress.failed > 0
              ? ` · ${t('settings.wproviderCheckingAllFailed', {
                  count: checkProgress.failed
                })}`
              : ''}
          </div>
        ) : null}
        {!checkingAll && checkSummary && checkSummary.failed > 0 ? (
          <div className="wprovider-auth-scan error" role="alert">
            <span>
              {t('settings.wproviderCheckAllFinishedWithErrors', {
                count: checkSummary.failed,
                total: checkSummary.total
              })}
            </span>
            <button
              type="button"
              className="wprovider-auth-retry"
              onClick={() => void checkAllWProviders({ force: true })}
            >
              {t('settings.wproviderRetryAll')}
            </button>
          </div>
        ) : null}
        {authorizationLoadFailed && authorizedServices.length === 0 ? (
          <div className="wprovider-auth-empty">
            {t('settings.wproviderAuthorizationsUnavailable')}
          </div>
        ) : authorizations === null && authorizedServices.length === 0 ? (
          <div className="wprovider-auth-empty">
            {t('settings.wproviderAuthorizationsLoading')}
          </div>
        ) : (
          <table className="wprovider-auth-table">
            <thead>
              <tr>
                <th scope="col">{t('common.model')}</th>
                <th scope="col">{t('settings.wproviderStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {WPROVIDER_SERVICES.map((service) => {
                const info = WPROVIDER_SERVICE_INFO[service]
                const selected = service === wproviderService
                const authorized = authorizedServices.includes(service)
                return (
                  <tr key={service} className={selected ? 'selected' : undefined}>
                    <th scope="row">
                      <button
                        type="button"
                        className="wprovider-auth-model"
                        aria-current={selected ? 'true' : undefined}
                        disabled={checking || loggingIn}
                        onClick={() => void setWProviderService(service)}
                      >
                        <span>{info.label}</span>
                        <small>{info.origin.replace(/^https?:\/\//, '')}</small>
                      </button>
                    </th>
                    <td>
                      {authorized ? (
                        <span className="wprovider-auth-status">
                          <span aria-hidden="true">✓</span> {t('settings.wproviderAuthorized')}
                        </span>
                      ) : (
                        <span className="wprovider-auth-status unauthorized">
                          <span aria-hidden="true">✗</span> {t('settings.wproviderUnauthorized')}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <label className="field">
        <span className="field-label">{t('settings.wproviderService')}</span>
        <select
          className="text-input"
          value={wproviderService}
          disabled={checking || loggingIn}
          onChange={(e) => void setWProviderService(e.target.value as WProviderService)}
        >
          {WPROVIDER_SERVICES.map((service) => {
            const info = WPROVIDER_SERVICE_INFO[service]
            return (
              <option key={service} value={service}>
                {info.label} ({info.origin.replace(/^https?:\/\//, '')})
              </option>
            )
          })}
        </select>
        <span className="field-hint">{t('settings.wproviderHint')}</span>
      </label>

      <div
        className={`conn-line ${
          checking || loggingIn
            ? 'connecting'
            : !check
              ? 'unknown'
              : check.loggedIn
                ? 'connected'
                : 'error'
        }`}
      >
        {(checking || loggingIn) && t('settings.checkingName', { name: selectedInfo.label })}
        {!checking && !loggingIn && !check && t('settings.notCheckedYet')}
        {!checking && !loggingIn && check && (
          <>
            {check.loggedIn
              ? `✓ ${t('settings.wproviderSignedIn', { name: checkedInfo.label })}`
              : `✗ ${t('settings.wproviderNotSignedIn')}`}
            {check.error ? <div className="field-hint">{check.error}</div> : null}
          </>
        )}
      </div>

      {!checking && !loggingIn && check && !check.loggedIn && (
        <div className="field-hint">
          {t(
            wproviderService === 'deepseek'
              ? 'settings.wproviderSigninHintManual'
              : 'settings.wproviderSigninHint',
            { origin: selectedHost }
          )}
        </div>
      )}

      <div className="field-row" style={{ alignSelf: 'flex-start' }}>
        <button
          className="btn btn-icon"
          onClick={() => void wproviderLogin()}
          disabled={loggingIn || checking}
        >
          <Icon name="globe" size={14} />
          {loggingIn ? t('settings.wproviderSigningIn') : t('settings.wproviderSignIn')}
        </button>
        {check?.loggedIn && (
          <button className="btn" onClick={() => void wproviderLogout()} disabled={checking}>
            {t('settings.wproviderSignOut')}
          </button>
        )}
        <button
          className="btn"
          onClick={() => void checkWProvider(undefined, { force: true })}
          disabled={checking}
        >
          {t('settings.recheck')}
        </button>
      </div>
    </>
  )
}

function OpenRouterSetup(): JSX.Element {
  const t = useT()
  const openRouterEnabled = useApp((s) => s.openRouterEnabled)
  const openRouterApiKey = useApp((s) => s.openRouterApiKey)
  const setOpenRouterEnabled = useApp((s) => s.setOpenRouterEnabled)
  const setOpenRouterApiKey = useApp((s) => s.setOpenRouterApiKey)

  const [apiKey, setApiKey] = useState(openRouterApiKey)
  const [saving, setSaving] = useState(false)
  const ready = openRouterEnabled && openRouterApiKey.trim().length > 0

  const save = async (): Promise<void> => {
    const normalized = normalizeOpenRouterApiKey(apiKey)
    setSaving(true)
    try {
      await setOpenRouterApiKey(normalized)
      setApiKey(normalized)
    } finally { setSaving(false) }
  }

  return (
    <div className="field">
      <span className="field-label">OpenRouter</span>
      <div className="field-row" style={{ alignItems: 'center' }}>
        <label
          className="skill-toggle"
          title={openRouterEnabled ? t('settings.disableOpenRouter') : t('settings.enableOpenRouter')}
        >
          <input
            type="checkbox"
            checked={openRouterEnabled}
            onChange={(e) => void setOpenRouterEnabled(e.target.checked)}
          />
        </label>
        <span className="field-hint">{t('settings.openRouterHint')}</span>
      </div>
      <div className="field-row">
        <input
          className="text-input"
          type="password"
          value={apiKey}
          spellCheck={false}
          placeholder="sk-or-v1-..."
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? t('settings.saving') : t('common.save')}
        </button>
      </div>
      <span className="field-hint">
        {ready
          ? t('settings.openRouterReady')
          : t('settings.openRouterSetup')}
      </span>
    </div>
  )
}

function OpenRouterPanel(): JSX.Element {
  const { models, connection, connectionError, refreshModels } = useProviderModels('openrouter')
  const t = useT()
  const openRouterModel = useApp((s) => s.openRouterModel)
  const setOpenRouterModel = useApp((s) => s.setOpenRouterModel)

  const modelOptions = openRouterModelOptions(models, openRouterModel)

  return (
    <>
      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <select
          className="text-input"
          value={openRouterModel || modelOptions[0]}
          onChange={(e) => setOpenRouterModel(e.target.value)}
        >
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.defaultModel', { model: DEFAULT_LLM_CONFIG.openRouterModel })}
        </span>
      </label>

      <div className={`conn-line ${connection}`}>
        {connection === 'connected' && `OpenRouter ${t('settings.connectedModels', { count: models.length })}`}
        {connection === 'connecting' && `${t('settings.connecting')} OpenRouter`}
        {connection === 'error' && `OpenRouter: ${connectionError ?? t('settings.connectionFailed')}`}
        {connection === 'unknown' && t('settings.notTestedYet')}
      </div>

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void refreshModels()}>
        {t('settings.refreshModels')}
      </button>
    </>
  )
}

/** Provider forms are independent of the backend selected in the chat. */
export function ConnectionSettings({ provider }: { provider: LlmProvider }): JSX.Element {
  return (
    <div className="provider-settings-form">
      {provider === 'openrouter' && <OpenRouterSetup />}
      {provider === 'codex' ? <CodexPanel />
        : provider === 'ollama' ? <OllamaPanel />
        : provider === 'unsloth' ? <UnslothPanel />
        : provider === 'copilot' ? <CopilotPanel />
        : provider === 'claude' ? <ClaudePanel />
        : provider === 'gemini' ? <GeminiPanel />
        : provider === 'grok' ? <GrokPanel />
        : provider === 'glm' ? <GlmPanel />
        : provider === 'antigravity' ? <AntigravityPanel />
        : provider === 'wprovider' ? <WProviderPanel />
        : provider === 'omniroute' ? <OmniRoutePanel />
        : provider === 'openrouter' ? <OpenRouterPanel /> : <LmStudioPanel />}
    </div>
  )
}
