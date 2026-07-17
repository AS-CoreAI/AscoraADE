import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type FormEvent,
  type JSX,
  type ReactNode
} from 'react'
import { Icon, type IconName } from '@/components/Icon'
import { OMNI_PAGE_GROUPS, OMNI_PAGES } from '@/lib/omniroutePages'
import {
  downloadOmniJson,
  formatOmniDate,
  formatOmniJson,
  isRecord,
  omniBool,
  omniId,
  omniLabel,
  omniList,
  omniNumber,
  omniOptionalNumber,
  omniRequest,
  omniStringList,
  omniText,
  type OmniRecord
} from '@/lib/omnirouteApi'
import { useApp, type AppLanguage } from '@/state/store'
import { api } from '@/lib/api'
import { tr, type TranslationKey } from '@/language'
import { ProvidersPage as FullProvidersPage } from './omniroute/ProvidersPage'

const FIRST_BOOT_HINT_MS = 10_000

function l(language: AppLanguage, ru: string, en: string): string {
  return language === 'ru' || language === 'uk' ? ru : en
}

interface Resource<T> {
  data: T | null
  error: string
  loading: boolean
}

function useOmniResource<T>(load: () => Promise<T>, dependencies: DependencyList): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>({ data: null, error: '', loading: true })
  useEffect(() => {
    let alive = true
    setResource((current) => ({ ...current, error: '', loading: current.data === null }))
    void load().then(
      (data) => alive && setResource({ data, error: '', loading: false }),
      (error: unknown) =>
        alive &&
        setResource((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
          loading: false
        }))
    )
    return () => {
      alive = false
    }
    // Callers pass the exact primitive values that should reload the resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)
  return resource
}

function PageHeader({
  icon,
  title,
  subtitle,
  actions
}: {
  icon: IconName
  title: string
  subtitle: string
  actions?: ReactNode
}): JSX.Element {
  return (
    <header className="omni-page-head">
      <div className="omni-page-heading">
        <span className="omni-page-icon"><Icon name={icon} size={19} /></span>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      {actions && <div className="omni-page-actions">{actions}</div>}
    </header>
  )
}

function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }): JSX.Element {
  return <div className={`omni-notice ${kind}`}>{children}</div>
}

function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="omni-empty"><Icon name="info" size={20} /><span>{children}</span></div>
}

function Loading(): JSX.Element {
  return <div className="omni-inline-loading"><span className="omni-spinner" aria-hidden="true" /></div>
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'blue' }): JSX.Element {
  return <span className={`omni-badge ${tone}`}>{children}</span>
}

function CopyButton({ value, label }: { value: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="omni-icon-button"
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <label className="omni-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

function getNestedRecord(value: unknown, key: string): OmniRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {}
}

function splitOmniList(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function optionalNumberInput(value: string): number | null {
  if (!value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function HomePage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const open = useApp((s) => s.openOmniroutePage)
  const status = useApp((s) => s.omnirouteStatus)
  const resource = useOmniResource(
    () =>
      Promise.all([
        omniRequest<unknown>('GET', '/api/monitoring/health'),
        omniRequest<unknown>('GET', '/api/providers'),
        omniRequest<unknown>('GET', '/api/combos'),
        omniRequest<unknown>('GET', '/api/v1/models')
      ]),
    [refreshKey]
  )
  const [health, providersBody, combosBody, modelsBody] = resource.data ?? []
  const healthRecord = isRecord(health) ? health : {}
  const providerSummary = getNestedRecord(healthRecord, 'providerSummary')
  const providers = omniList(providersBody, 'connections', 'providers', 'data')
  const combos = omniList(combosBody, 'combos', 'data')
  const models = omniList(modelsBody, 'data', 'models')
  const memory = getNestedRecord(getNestedRecord(healthRecord, 'system'), 'memoryUsage')
  const uptime = omniNumber(healthRecord.uptime ?? getNestedRecord(healthRecord, 'system').uptime)

  return (
    <div className="omni-page">
      <PageHeader
        icon="home"
        title={l(language, 'OmniRoute — главная', 'OmniRoute dashboard')}
        subtitle={l(language, 'Состояние локального шлюза, маршрутов и моделей.', 'Local gateway, routes and model health.')}
      />
      {resource.error && <Notice kind="error">{resource.error}</Notice>}
      {resource.loading ? <Loading /> : (
        <>
          <section className="omni-stat-grid">
            <div className="omni-stat-card"><span>{l(language, 'Состояние', 'Status')}</span><strong className="good">{omniText(healthRecord.status, 'ready')}</strong><small>v{status.version ?? '—'} · {Math.floor(uptime / 60)} min</small></div>
            <div className="omni-stat-card"><span>{l(language, 'Провайдеры', 'Providers')}</span><strong>{providers.length}</strong><small>{omniNumber(providerSummary.catalogCount)} {l(language, 'в каталоге', 'in catalog')}</small></div>
            <div className="omni-stat-card"><span>{l(language, 'Модели', 'Models')}</span><strong>{models.length}</strong><small>{l(language, 'доступны через единый API', 'available through one API')}</small></div>
            <div className="omni-stat-card"><span>{l(language, 'Комбо', 'Combos')}</span><strong>{combos.length}</strong><small>{l(language, 'каскадов маршрутизации', 'routing cascades')}</small></div>
            <div className="omni-stat-card"><span>{l(language, 'Память', 'Memory')}</span><strong>{Math.round(omniNumber(memory.rss) / 1024 / 1024)} MB</strong><small>sidecar RSS</small></div>
          </section>
          <section className="omni-panel">
            <div className="omni-panel-title"><span>{l(language, 'Быстрый доступ', 'Quick access')}</span></div>
            <div className="omni-quick-grid">
              {OMNI_PAGES.slice(1).map((page) => (
                <button key={page.path} className="omni-quick-card" onClick={() => open(page.path)}>
                  <Icon name={page.icon} size={18} />
                  <span>{tr(language, page.labelKey)}</span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function EndpointsPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const status = useApp((s) => s.omnirouteStatus)
  const resource = useOmniResource(
    () => Promise.all([omniRequest<unknown>('GET', '/api/v1/models'), omniRequest<unknown>('GET', '/api/keys')]),
    [refreshKey]
  )
  const models = omniList(resource.data?.[0], 'data', 'models')
  const keys = omniList(resource.data?.[1], 'keys', 'data')
  const origin = status.port ? `http://127.0.0.1:${status.port}` : 'http://127.0.0.1:20128'
  const endpoints = [
    ['OpenAI base URL', `${origin}/v1`, l(language, 'Базовый адрес для SDK', 'Base URL for SDKs')],
    ['Chat Completions', `${origin}/v1/chat/completions`, l(language, 'Чат и инструменты', 'Chat and tool calls')],
    ['Responses', `${origin}/v1/responses`, l(language, 'OpenAI Responses API', 'OpenAI Responses API')],
    ['Models', `${origin}/v1/models`, l(language, 'Каталог доступных моделей', 'Available model catalog')],
    ['Anthropic Messages', `${origin}/v1/messages`, l(language, 'Совместимый Messages API', 'Compatible Messages API')]
  ]
  return (
    <div className="omni-page">
      <PageHeader icon="plug" title={tr(language, 'omni.endpoints')} subtitle={l(language, 'Адреса для подключения клиентов и агентов.', 'Connection URLs for clients and agents.')} />
      {resource.error && <Notice kind="error">{resource.error}</Notice>}
      <section className="omni-stat-grid compact">
        <div className="omni-stat-card"><span>{l(language, 'Порт', 'Port')}</span><strong>{status.port ?? '—'}</strong><small>loopback only</small></div>
        <div className="omni-stat-card"><span>{l(language, 'Модели', 'Models')}</span><strong>{models.length}</strong><small>{l(language, 'в каталоге', 'in catalog')}</small></div>
        <div className="omni-stat-card"><span>{l(language, 'Ключи API', 'API keys')}</span><strong>{keys.length}</strong><small>{l(language, 'зарегистрировано', 'registered')}</small></div>
      </section>
      <section className="omni-panel">
        <div className="omni-panel-title"><span>{l(language, 'Локальные конечные точки', 'Local endpoints')}</span></div>
        <div className="omni-endpoint-list">
          {endpoints.map(([name, url, description]) => (
            <div className="omni-endpoint-row" key={name}>
              <Icon name="globe" size={16} />
              <div><strong>{name}</strong><small>{description}</small></div>
              <code>{url}</code>
              <CopyButton value={url} label={l(language, 'Копировать', 'Copy')} />
            </div>
          ))}
        </div>
      </section>
      <Notice>{l(language, 'Для внешних приложений укажите OpenAI base URL и один из ключей из Менеджера API.', 'For external apps, use the OpenAI base URL and a key from API manager.')}</Notice>
    </div>
  )
}

interface ApiKeyDraft {
  name: string
  isActive: boolean
  allowedModels: string
  allowedCombos: string[]
  allowedConnections: string[]
  maxRequestsPerMinute: string
  maxRequestsPerDay: string
  maxSessions: string
  usageLimitEnabled: boolean
  dailyUsageLimitUsd: string
  weeklyUsageLimitUsd: string
  noLog: boolean
  allowUsageCommand: boolean
  autoResolve: boolean
  streamDefaultMode: string
}

function apiKeyDraft(key: OmniRecord): ApiKeyDraft {
  return {
    name: omniLabel(key, ''),
    isActive: key.isActive !== false,
    allowedModels: omniStringList(key.allowedModels).join('\n'),
    allowedCombos: omniStringList(key.allowedCombos),
    allowedConnections: omniStringList(key.allowedConnections),
    maxRequestsPerMinute: omniOptionalNumber(key.maxRequestsPerMinute)?.toString() ?? '',
    maxRequestsPerDay: omniOptionalNumber(key.maxRequestsPerDay)?.toString() ?? '',
    maxSessions: omniOptionalNumber(key.maxSessions)?.toString() ?? '',
    usageLimitEnabled: omniBool(key.usageLimitEnabled),
    dailyUsageLimitUsd: omniOptionalNumber(key.dailyUsageLimitUsd)?.toString() ?? '',
    weeklyUsageLimitUsd: omniOptionalNumber(key.weeklyUsageLimitUsd)?.toString() ?? '',
    noLog: omniBool(key.noLog),
    allowUsageCommand: omniBool(key.allowUsageCommand),
    autoResolve: omniBool(key.autoResolve),
    streamDefaultMode: omniText(key.streamDefaultMode, 'legacy')
  }
}

function ApiManagerPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [label, setLabel] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<ApiKeyDraft | null>(null)
  const [busy, setBusy] = useState('')
  const [createdKey, setCreatedKey] = useState('')
  const [actionError, setActionError] = useState('')
  const resource = useOmniResource(
    () => Promise.all([
      omniRequest<unknown>('GET', '/api/keys'),
      omniRequest<unknown>('GET', '/api/usage/analytics?range=all'),
      omniRequest<unknown>('GET', '/api/sessions'),
      omniRequest<unknown>('GET', '/api/quota/groups'),
      omniRequest<unknown>('GET', '/api/quota/pools'),
      omniRequest<unknown>('GET', '/api/combos'),
      omniRequest<unknown>('GET', '/api/providers')
    ]),
    [refreshKey, revision]
  )
  const keys = omniList(resource.data?.[0], 'keys', 'data').filter((key) => omniLabel(key, '') !== '__ascora_live_bridge__')
  const summary = getNestedRecord(isRecord(resource.data?.[1]) ? resource.data[1] : {}, 'summary')
  const sessionsBody = isRecord(resource.data?.[2]) ? resource.data[2] : {}
  const sessions = omniList(sessionsBody, 'sessions', 'data')
  const groups = omniList(resource.data?.[3], 'groups', 'data')
  const pools = omniList(resource.data?.[4], 'pools', 'data')
  const combos = omniList(resource.data?.[5], 'combos', 'data')
  const providers = omniList(resource.data?.[6], 'connections', 'providers', 'data')
  const selectedKey = keys.find((key) => omniId(key) === selectedId) ?? null
  const visibleKeys = keys.filter((key) => {
    const needle = query.trim().toLowerCase()
    return !needle || `${omniLabel(key)} ${omniText(key.key ?? key.keyPreview)} ${omniText(key.machineId)}`.toLowerCase().includes(needle)
  })

  useEffect(() => {
    if (!selectedKey) {
      if (selectedId) { setSelectedId(''); setDraft(null) }
      return
    }
    setDraft(apiKeyDraft(selectedKey))
  }, [selectedId, selectedKey?.id, selectedKey?.updatedAt])

  const mutate = async (id: string, patch: unknown, busyKey: string): Promise<void> => {
    setBusy(busyKey); setActionError('')
    try { await omniRequest('PATCH', `/api/keys/${encodeURIComponent(id)}`, patch); setRevision((value) => value + 1) }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!label.trim()) return
    setBusy('create'); setActionError(''); setCreatedKey('')
    try {
      const result = await omniRequest<unknown>('POST', '/api/keys', { name: label.trim(), label: label.trim() })
      if (isRecord(result)) setCreatedKey(omniText(result.key ?? result.apiKey ?? getNestedRecord(result, 'data').key))
      setLabel(''); setRevision((value) => value + 1)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }

  const save = async (): Promise<void> => {
    if (!selectedKey || !draft) return
    await mutate(omniId(selectedKey), {
      name: draft.name.trim(),
      isActive: draft.isActive,
      allowedModels: splitOmniList(draft.allowedModels),
      allowedCombos: draft.allowedCombos,
      allowedConnections: draft.allowedConnections,
      maxRequestsPerMinute: optionalNumberInput(draft.maxRequestsPerMinute),
      maxRequestsPerDay: optionalNumberInput(draft.maxRequestsPerDay),
      maxSessions: optionalNumberInput(draft.maxSessions) ?? 0,
      usageLimitEnabled: draft.usageLimitEnabled,
      dailyUsageLimitUsd: optionalNumberInput(draft.dailyUsageLimitUsd),
      weeklyUsageLimitUsd: optionalNumberInput(draft.weeklyUsageLimitUsd),
      noLog: draft.noLog,
      allowUsageCommand: draft.allowUsageCommand,
      autoResolve: draft.autoResolve,
      streamDefaultMode: draft.streamDefaultMode
    }, 'save-key')
  }

  const remove = async (id: string): Promise<void> => {
    if (!id || !window.confirm(l(language, 'Удалить этот ключ API?', 'Delete this API key?'))) return
    setBusy(id); setActionError('')
    try { await omniRequest('DELETE', `/api/keys/${encodeURIComponent(id)}`); if (selectedId === id) setSelectedId(''); setRevision((value) => value + 1) }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }

  const toggleArray = (field: 'allowedCombos' | 'allowedConnections', id: string): void => {
    setDraft((current) => current ? { ...current, [field]: current[field].includes(id) ? current[field].filter((value) => value !== id) : [...current[field], id] } : current)
  }

  return <div className="omni-page">
    <PageHeader icon="key" title={tr(language, 'omni.apiManager')} subtitle={l(language, 'Ключи, ограничения доступа и статистика использования.', 'Keys, access policies and usage analytics.')} />
    {(resource.error || actionError) && <Notice kind="error">{resource.error || actionError}</Notice>}
    {createdKey && <Notice kind="success"><strong>{l(language, 'Новый ключ — сохраните его сейчас:', 'New key — save it now:')}</strong><code>{createdKey}</code><CopyButton value={createdKey} label={l(language, 'Копировать', 'Copy')} /></Notice>}
    <section className="omni-stat-grid omni-stat-grid-four">
      <div className="omni-stat-card"><span>{l(language, 'Запросы', 'Requests')}</span><strong>{omniNumber(summary.totalRequests).toLocaleString(language)}</strong><small>{omniNumber(summary.successRatePct)}% success</small></div>
      <div className="omni-stat-card"><span>{l(language, 'Токены', 'Tokens')}</span><strong>{omniNumber(summary.totalTokens).toLocaleString(language)}</strong><small>{omniNumber(summary.uniqueModels)} {l(language, 'моделей', 'models')}</small></div>
      <div className="omni-stat-card"><span>{l(language, 'Стоимость', 'Cost')}</span><strong>${omniNumber(summary.totalCost).toFixed(2)}</strong><small>{omniNumber(summary.avgLatencyMs)} ms avg</small></div>
      <div className="omni-stat-card"><span>{l(language, 'Политики', 'Policies')}</span><strong>{groups.length + pools.length}</strong><small>{sessions.length || omniNumber(sessionsBody.count)} {l(language, 'сессий', 'sessions')}</small></div>
    </section>
    <section className="omni-panel">
      <div className="omni-panel-title"><span>{l(language, 'Создать ключ', 'Create key')}</span></div>
      <form className="omni-inline-form" onSubmit={(event) => void create(event)}><input className="text-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={l(language, 'Название ключа', 'Key name')} /><button className="btn primary" disabled={busy === 'create' || !label.trim()}><Icon name="plus" size={14} />{l(language, 'Создать', 'Create')}</button></form>
    </section>
    <div className="omni-master-detail">
      <section className="omni-panel">
        <div className="omni-panel-title"><span>{l(language, 'Ключи API', 'API keys')}</span><Badge>{keys.length}</Badge><input className="text-input small" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l(language, 'Поиск', 'Search')} /></div>
        {resource.loading ? <Loading /> : visibleKeys.length === 0 ? <Empty>{l(language, 'Ключей не найдено.', 'No keys found.')}</Empty> : <div className="omni-table-wrap"><table className="omni-table interactive"><thead><tr><th>{l(language, 'Название', 'Name')}</th><th>{l(language, 'Ключ', 'Key')}</th><th>{l(language, 'Состояние', 'Status')}</th><th>{l(language, 'Последнее использование', 'Last used')}</th><th /></tr></thead><tbody>{visibleKeys.map((key) => { const id = omniId(key); const active = key.isActive !== false; return <tr key={id} className={selectedId === id ? 'selected' : ''} onClick={() => setSelectedId(id)}><td><strong>{omniLabel(key)}</strong><small className="omni-cell-note">{omniText(key.machineId)}</small></td><td><code>{omniText(key.key ?? key.keyPreview, '••••')}</code></td><td><button type="button" onClick={(event) => { event.stopPropagation(); void mutate(id, { isActive: !active }, `toggle:${id}`) }}><Badge tone={active ? 'good' : 'bad'}>{active ? l(language, 'Активен', 'Active') : l(language, 'Отключён', 'Disabled')}</Badge></button></td><td>{formatOmniDate(key.lastUsedAt, language)}</td><td className="actions"><button type="button" className="omni-icon-button danger" disabled={busy === id} onClick={(event) => { event.stopPropagation(); void remove(id) }}><Icon name="trash" size={14} /></button></td></tr> })}</tbody></table></div>}
      </section>
      <section className="omni-panel omni-detail-panel">
        <div className="omni-panel-title"><span>{l(language, 'Настройки ключа', 'Key settings')}</span>{selectedKey && <Badge tone={selectedKey.isActive === false ? 'bad' : 'good'}>{omniLabel(selectedKey)}</Badge>}</div>
        {!draft || !selectedKey ? <Empty>{l(language, 'Выберите ключ слева.', 'Select a key on the left.')}</Empty> : <div className="omni-detail-form">
          <Field label={l(language, 'Название', 'Name')}><input className="text-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <div className="omni-switch-grid"><label className="omni-switch"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /><span />{l(language, 'Активен', 'Active')}</label><label className="omni-switch"><input type="checkbox" checked={draft.noLog} onChange={(event) => setDraft({ ...draft, noLog: event.target.checked })} /><span />No log</label><label className="omni-switch"><input type="checkbox" checked={draft.allowUsageCommand} onChange={(event) => setDraft({ ...draft, allowUsageCommand: event.target.checked })} /><span />Usage command</label><label className="omni-switch"><input type="checkbox" checked={draft.autoResolve} onChange={(event) => setDraft({ ...draft, autoResolve: event.target.checked })} /><span />Auto resolve</label></div>
          <div className="omni-form-grid embedded"><Field label="RPM"><input className="text-input" type="number" min="0" value={draft.maxRequestsPerMinute} onChange={(event) => setDraft({ ...draft, maxRequestsPerMinute: event.target.value })} /></Field><Field label={l(language, 'Запросов в день', 'Requests/day')}><input className="text-input" type="number" min="0" value={draft.maxRequestsPerDay} onChange={(event) => setDraft({ ...draft, maxRequestsPerDay: event.target.value })} /></Field><Field label={l(language, 'Макс. сессий', 'Max sessions')}><input className="text-input" type="number" min="0" value={draft.maxSessions} onChange={(event) => setDraft({ ...draft, maxSessions: event.target.value })} /></Field><Field label="Stream mode"><select className="text-input" value={draft.streamDefaultMode} onChange={(event) => setDraft({ ...draft, streamDefaultMode: event.target.value })}><option value="legacy">legacy</option><option value="responses">responses</option><option value="auto">auto</option></select></Field></div>
          <Field label={l(language, 'Разрешённые модели', 'Allowed models')} hint={l(language, 'По одной модели в строке; пусто — без ограничения.', 'One per line; empty means unrestricted.')}><textarea className="omni-textarea compact" value={draft.allowedModels} onChange={(event) => setDraft({ ...draft, allowedModels: event.target.value })} /></Field>
          <fieldset className="omni-node-picker"><legend>{l(language, 'Разрешённые комбо', 'Allowed combos')}</legend>{combos.length === 0 ? <small>—</small> : combos.map((combo) => { const id = omniId(combo); return <label key={id}><input type="checkbox" checked={draft.allowedCombos.includes(id)} onChange={() => toggleArray('allowedCombos', id)} />{omniLabel(combo)}</label> })}</fieldset>
          <fieldset className="omni-node-picker"><legend>{l(language, 'Разрешённые подключения', 'Allowed connections')}</legend>{providers.length === 0 ? <small>—</small> : providers.map((provider) => { const id = omniId(provider); return <label key={id}><input type="checkbox" checked={draft.allowedConnections.includes(id)} onChange={() => toggleArray('allowedConnections', id)} />{omniLabel(provider)}</label> })}</fieldset>
          <div className="omni-budget-row"><label className="omni-switch"><input type="checkbox" checked={draft.usageLimitEnabled} onChange={(event) => setDraft({ ...draft, usageLimitEnabled: event.target.checked })} /><span />{l(language, 'Лимит расходов', 'Usage budget')}</label><Field label="USD/day"><input className="text-input" type="number" min="0" step="0.01" disabled={!draft.usageLimitEnabled} value={draft.dailyUsageLimitUsd} onChange={(event) => setDraft({ ...draft, dailyUsageLimitUsd: event.target.value })} /></Field><Field label="USD/week"><input className="text-input" type="number" min="0" step="0.01" disabled={!draft.usageLimitEnabled} value={draft.weeklyUsageLimitUsd} onChange={(event) => setDraft({ ...draft, weeklyUsageLimitUsd: event.target.value })} /></Field></div>
          <div className="omni-card-actions"><button type="button" className="btn primary" disabled={busy === 'save-key' || !draft.name.trim()} onClick={() => void save()}><Icon name="save" size={14} />{l(language, 'Сохранить', 'Save')}</button></div>
        </div>}
      </section>
    </div>
  </div>
}

interface ComboStepDraft {
  key: string
  connectionId: string
  model: string
  weight: number
}

interface ComboDraft {
  id: string
  name: string
  description: string
  strategy: string
  isActive: boolean
  systemMessage: string
  contextLength: string
  compressionMode: string
  steps: ComboStepDraft[]
}

interface OmniLiveEvent {
  event: string
  channel: string
  data: OmniRecord
  timestamp: number
}

function useOmniLiveChannel(channel: string, enabled: boolean): { connected: boolean; error: string; events: OmniLiveEvent[]; clear: () => void } {
  const status = useApp((s) => s.omnirouteStatus)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [events, setEvents] = useState<OmniLiveEvent[]>([])
  const retry = useRef<number | null>(null)
  const subscriptionId = useRef(`combo-${crypto.randomUUID()}`)

  useEffect(() => {
    if (!enabled || status.state !== 'ready' || !status.port) return
    let alive = true
    let attempt = 0
    const append = (item: unknown): void => {
      if (!isRecord(item)) return
      const event = omniText(item.event)
      const itemChannel = omniText(item.channel, channel)
      if (!event || itemChannel !== channel) return
      const entry: OmniLiveEvent = { event, channel: itemChannel, data: isRecord(item.data) ? item.data : {}, timestamp: omniNumber(item.timestamp, Date.now()) }
      setEvents((current) => [entry, ...current].slice(0, 200))
    }
    const unsubscribe = api.omniroute.onLiveEvent((payload) => {
      if (!alive || payload.id !== subscriptionId.current) return
      if (payload.state === 'open') { attempt = 0; setConnected(true); setError(''); return }
      if (payload.state === 'error') { setError(payload.error || 'Live WebSocket connection failed'); return }
      if (payload.state === 'closed') {
        setConnected(false)
        if (payload.error) setError(payload.error)
        const delay = Math.min(30_000, 1000 * (2 ** attempt++))
        retry.current = window.setTimeout(() => void connect(), delay)
        return
      }
      const message = payload.data
      if (!isRecord(message)) return
      if (message.type === 'event') append(message)
      else if (message.type === 'welcome' && Array.isArray(message.data)) message.data.forEach(append)
    })
    const connect = async (): Promise<void> => {
      try {
        await api.omniroute.liveConnect({ id: subscriptionId.current, channel: 'combo' })
      } catch (caught) {
        if (!alive) return
        setError(caught instanceof Error ? caught.message : String(caught))
        retry.current = window.setTimeout(() => void connect(), 3000)
      }
    }
    void connect()
    return () => {
      alive = false
      unsubscribe()
      if (retry.current !== null) window.clearTimeout(retry.current)
      void api.omniroute.liveDisconnect(subscriptionId.current)
    }
  }, [channel, enabled, status.port, status.state])

  return { connected, error, events, clear: useCallback(() => setEvents([]), []) }
}

function comboModels(combo: OmniRecord): OmniRecord[] {
  return Array.isArray(combo.models) ? combo.models.filter(isRecord) : []
}

function CombosPage({ language, refreshKey, studio = false }: { language: AppLanguage; refreshKey: number; studio?: boolean }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [selectedCombo, setSelectedCombo] = useState('')
  const [draft, setDraft] = useState<ComboDraft | null>(null)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState('')
  const live = useOmniLiveChannel('combo', studio)
  const resource = useOmniResource(async () => {
    const [comboBody, providerBody, metricsBody] = await Promise.all([
      omniRequest<unknown>('GET', '/api/combos'), omniRequest<unknown>('GET', '/api/providers'), omniRequest<unknown>('GET', '/api/combos/metrics')
    ])
    const connections = omniList(providerBody, 'connections', 'providers', 'data')
    const modelPairs = await Promise.all(connections.map(async (connection) => {
      const id = omniId(connection)
      try { return [id, omniList(await omniRequest<unknown>('GET', `/api/providers/${encodeURIComponent(id)}/models`), 'models', 'data')] as const }
      catch { return [id, []] as const }
    }))
    return { comboBody, providerBody, metricsBody, modelsByConnection: Object.fromEntries(modelPairs) as Record<string, OmniRecord[]> }
  }, [refreshKey, revision])
  const combos = omniList(resource.data?.comboBody, 'combos', 'data')
  const providers = omniList(resource.data?.providerBody, 'connections', 'providers', 'data')
  const metricsRoot = isRecord(resource.data?.metricsBody) ? resource.data.metricsBody : {}
  const metrics = getNestedRecord(metricsRoot, 'metrics')
  const modelsByConnection = resource.data?.modelsByConnection ?? {}
  const activeCombo = combos.find((combo) => omniId(combo) === selectedCombo) ?? combos[0] ?? null
  const liveEvents = live.events.filter((event) => !activeCombo || omniText(event.data.comboName) === omniLabel(activeCombo))

  useEffect(() => { if ((!selectedCombo || !combos.some((combo) => omniId(combo) === selectedCombo)) && combos[0]) setSelectedCombo(omniId(combos[0])) }, [combos, selectedCombo])

  const providerFor = (connectionId: string): OmniRecord | undefined => providers.find((provider) => omniId(provider) === connectionId)
  const qualifyModel = (connectionId: string, model: string): string => {
    if (model.includes('/')) return model
    const providerId = omniText(providerFor(connectionId)?.provider)
    return providerId ? `${providerId}/${model}` : model
  }
  const initialStep = (): ComboStepDraft => {
    const connection = providers[0]
    const connectionId = connection ? omniId(connection) : ''
    const firstModel = modelsByConnection[connectionId]?.[0]
    return { key: crypto.randomUUID(), connectionId, model: omniText(firstModel?.qualifiedModel ?? firstModel?.id), weight: 100 }
  }
  const openEditor = (combo?: OmniRecord): void => {
    const steps = combo ? comboModels(combo).map((model) => ({ key: omniText(model.id, crypto.randomUUID()), connectionId: omniText(model.connectionId), model: omniText(model.model), weight: omniNumber(model.weight, 0) })) : [initialStep()]
    const config = combo ? getNestedRecord(combo, 'config') : {}
    setDraft({ id: combo ? omniId(combo) : '', name: combo ? omniLabel(combo, '') : '', description: omniText(combo?.description), strategy: omniText(combo?.strategy, 'priority'), isActive: combo?.isActive !== false, systemMessage: omniText(combo?.system_message), contextLength: omniOptionalNumber(combo?.context_length)?.toString() ?? '', compressionMode: omniText(config.compressionMode), steps })
    setError(''); setResult(null)
  }
  const updateStep = (key: string, patch: Partial<ComboStepDraft>): void => setDraft((current) => current ? { ...current, steps: current.steps.map((step) => step.key === key ? { ...step, ...patch } : step) } : current)
  const moveStep = (index: number, delta: number): void => setDraft((current) => {
    if (!current) return current
    const target = index + delta
    if (target < 0 || target >= current.steps.length) return current
    const steps = [...current.steps]; const [step] = steps.splice(index, 1); steps.splice(target, 0, step)
    return { ...current, steps }
  })
  const payloadFor = (value: ComboDraft): OmniRecord => {
    const config: OmniRecord = {}
    if (value.compressionMode) config.compressionMode = value.compressionMode
    const contextLength = optionalNumberInput(value.contextLength)
    return {
      name: value.name.trim(), description: value.description.trim(), strategy: value.strategy, isActive: value.isActive,
      models: value.steps.map((step) => { const connection = providerFor(step.connectionId); return { model: qualifyModel(step.connectionId, step.model.trim()), providerId: omniText(connection?.provider), connectionId: step.connectionId, weight: step.weight } }),
      ...(Object.keys(config).length ? { config } : {}), system_message: value.systemMessage.trim(),
      ...(contextLength === null ? {} : { context_length: contextLength })
    }
  }
  const save = async (): Promise<void> => {
    if (!draft) return
    if (!draft.name.trim() || draft.steps.length === 0 || draft.steps.some((step) => !step.connectionId || !step.model.trim())) { setError(l(language, 'Заполните название и все шаги маршрута.', 'Complete the name and every route step.')); return }
    if (draft.strategy === 'weighted' && draft.steps.reduce((sum, step) => sum + step.weight, 0) !== 100) { setError(l(language, 'Для weighted сумма весов должна быть 100%.', 'Weighted routes must total 100%.')); return }
    setBusy('save-combo'); setError('')
    try { await omniRequest(draft.id ? 'PUT' : 'POST', draft.id ? `/api/combos/${encodeURIComponent(draft.id)}` : '/api/combos', payloadFor(draft)); setDraft(null); setRevision((value) => value + 1) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(l(language, 'Удалить комбо?', 'Delete combo?'))) return
    setBusy(`delete:${id}`); setError('')
    try { await omniRequest('DELETE', `/api/combos/${encodeURIComponent(id)}`); setRevision((value) => value + 1) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const test = async (combo = activeCombo): Promise<void> => {
    if (!combo) return
    setBusy('test'); setError(''); setResult(null)
    try { setResult(await omniRequest('POST', '/api/combos/test', { comboName: omniLabel(combo) })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const updateCombo = async (combo: OmniRecord, patch: unknown): Promise<void> => {
    const id = omniId(combo); setBusy(`update:${id}`); setError('')
    try { await omniRequest('PUT', `/api/combos/${encodeURIComponent(id)}`, patch); setRevision((value) => value + 1) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const duplicate = async (combo: OmniRecord): Promise<void> => {
    setBusy(`duplicate:${omniId(combo)}`); setError('')
    try { await omniRequest('POST', '/api/combos', { ...combo, id: undefined, name: `${omniLabel(combo)}-copy`, models: comboModels(combo) }); setRevision((value) => value + 1) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const reorder = async (index: number, delta: number): Promise<void> => {
    const target = index + delta
    if (target < 0 || target >= combos.length) return
    const ordered = [...combos]; const [item] = ordered.splice(index, 1); ordered.splice(target, 0, item)
    setBusy('reorder'); setError('')
    try { await omniRequest('POST', '/api/combos/reorder', { comboIds: ordered.map(omniId) }); setRevision((value) => value + 1) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }

  if (studio) {
    const steps = activeCombo ? comboModels(activeCombo) : []
    const latestByIndex = new Map<number, OmniLiveEvent>()
    for (const event of liveEvents) { const index = omniNumber(event.data.targetIndex, -1); if (index >= 0 && !latestByIndex.has(index)) latestByIndex.set(index, event) }
    return <div className="omni-page"><PageHeader icon="gitBranch" title={tr(language, 'omni.comboStudio')} subtitle={l(language, 'Live-маршрутизация, тесты и состояние каждого шага.', 'Live routing, tests and per-step health.')} actions={<><Badge tone={live.connected ? 'good' : 'bad'}>{live.connected ? 'LIVE' : 'OFFLINE'}</Badge><button type="button" className="btn primary" disabled={!activeCombo || busy === 'test'} onClick={() => void test()}><Icon name="play" size={14} />{l(language, 'Тестировать', 'Run test')}</button></>} />
      {(resource.error || error || live.error) && <Notice kind="error">{resource.error || error || live.error}</Notice>}{result !== null && <Notice><pre>{formatOmniJson(result)}</pre></Notice>}
      <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Маршрут', 'Route')}</span><select className="text-input small" value={selectedCombo} onChange={(event) => setSelectedCombo(event.target.value)}>{combos.map((combo) => <option key={omniId(combo)} value={omniId(combo)}>{omniLabel(combo)}</option>)}</select><Badge tone="blue">{activeCombo ? omniText(activeCombo.strategy, 'priority') : '—'}</Badge></div>
        {!activeCombo ? <Empty>{l(language, 'Сначала создайте комбо.', 'Create a combo first.')}</Empty> : <div className="omni-flow"><div className="omni-flow-node source"><Icon name="message" size={18} /><strong>{omniLabel(activeCombo)}</strong><small>{omniText(activeCombo.strategy)}</small></div><Icon name="arrowRight" size={20} /><div className="omni-flow-stack">{steps.map((step, index) => { const liveStep = latestByIndex.get(index); const tone = liveStep?.event.endsWith('succeeded') ? 'good' : liveStep?.event.endsWith('failed') ? 'bad' : 'blue'; return <div className={`omni-flow-node${liveStep ? ` live-${tone}` : ''}`} key={omniText(step.id, `${index}`)}><Badge tone={tone}>{index + 1}</Badge><div><strong>{omniText(step.model)}</strong><small>{providerFor(omniText(step.connectionId)) ? omniLabel(providerFor(omniText(step.connectionId))!) : omniText(step.providerId)}</small></div><span className="omni-flow-status">{liveStep ? liveStep.event.split('.').pop() : `${omniNumber(step.weight)}%`}</span></div> })}</div><Icon name="arrowRight" size={20} /><div className="omni-flow-node target"><Icon name="check" size={18} /><strong>{l(language, 'Ответ', 'Response')}</strong><small>{liveEvents.length} events</small></div></div>}
      </section>
      <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'События маршрута', 'Route events')}</span><Badge>{liveEvents.length}</Badge><button type="button" className="btn" onClick={live.clear}>{l(language, 'Очистить', 'Clear')}</button></div>{liveEvents.length === 0 ? <Empty>{l(language, 'Запустите запрос через это комбо — события появятся здесь.', 'Send a request through this combo to see live events.')}</Empty> : <div className="omni-event-list">{liveEvents.slice(0, 60).map((event, index) => <div className="omni-event-row" key={`${event.timestamp}:${index}`}><Badge tone={event.event.endsWith('succeeded') ? 'good' : event.event.endsWith('failed') ? 'bad' : 'blue'}>{event.event.split('.').pop()}</Badge><strong>{omniText(event.data.model, omniText(event.data.provider))}</strong><span>{omniOptionalNumber(event.data.latencyMs) !== null ? `${omniNumber(event.data.latencyMs)} ms` : omniText(event.data.error)}</span><time>{new Date(event.timestamp).toLocaleTimeString(language)}</time></div>)}</div>}</section>
    </div>
  }

  return <div className="omni-page"><PageHeader icon="layers" title={tr(language, 'omni.combos')} subtitle={l(language, 'Редактор fallback-маршрутов, весов и стратегий.', 'Edit fallback routes, weights and strategies.')} actions={<button type="button" className="btn primary" disabled={providers.length === 0} onClick={() => openEditor()}><Icon name="plus" size={14} />{l(language, 'Новое комбо', 'New combo')}</button>} />
    {(resource.error || error) && <Notice kind="error">{resource.error || error}</Notice>}{result !== null && <Notice><pre>{formatOmniJson(result)}</pre></Notice>}
    {providers.length === 0 && <Notice>{l(language, 'Для создания комбо сначала добавьте хотя бы одного провайдера.', 'Add at least one provider before creating a combo.')}</Notice>}
    {draft && <section className="omni-panel omni-editor-panel"><div className="omni-panel-title"><span>{draft.id ? l(language, 'Редактировать комбо', 'Edit combo') : l(language, 'Новое комбо', 'New combo')}</span><button type="button" className="omni-icon-button" onClick={() => setDraft(null)}><Icon name="close" size={14} /></button></div><div className="omni-detail-form">
      <div className="omni-form-grid embedded"><Field label={l(language, 'Название', 'Name')}><input className="text-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label={l(language, 'Стратегия', 'Strategy')}><select className="text-input" value={draft.strategy} onChange={(event) => setDraft({ ...draft, strategy: event.target.value })}>{['priority','weighted','round-robin','random','least-used','cost-optimized','reset-aware','headroom','auto','lkgp','fusion'].map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}</select></Field><Field label={l(language, 'Описание', 'Description')}><input className="text-input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field><Field label={l(language, 'Сжатие', 'Compression')}><select className="text-input" value={draft.compressionMode} onChange={(event) => setDraft({ ...draft, compressionMode: event.target.value })}><option value="">default</option>{['off','lite','standard','aggressive','ultra','rtk','stacked'].map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></Field></div>
      <section className="omni-subpanel"><div className="omni-panel-title"><span>{l(language, 'Шаги маршрута', 'Route steps')}</span><Badge>{draft.steps.length}</Badge><button type="button" className="btn" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { ...initialStep(), weight: draft.strategy === 'weighted' ? 0 : 100 }] })}><Icon name="plus" size={13} />{l(language, 'Шаг', 'Step')}</button></div><div className="omni-step-list">{draft.steps.map((step, index) => { const connection = providerFor(step.connectionId); const options = modelsByConnection[step.connectionId] ?? []; return <div className="omni-step-row" key={step.key}><Badge tone="blue">{index + 1}</Badge><select className="text-input" value={step.connectionId} onChange={(event) => { const connectionId = event.target.value; const first = modelsByConnection[connectionId]?.[0]; updateStep(step.key, { connectionId, model: omniText(first?.qualifiedModel ?? first?.id) }) }}>{providers.map((item) => <option key={omniId(item)} value={omniId(item)}>{omniLabel(item)} · {omniText(item.provider)}</option>)}</select><input className="text-input" list={`omni-models-${step.key}`} value={step.model} onChange={(event) => updateStep(step.key, { model: event.target.value })} placeholder={`${omniText(connection?.provider, 'provider')}/model`} /><datalist id={`omni-models-${step.key}`}>{options.map((model) => <option key={omniText(model.id)} value={omniText(model.qualifiedModel ?? (connection ? `${omniText(connection.provider)}/${omniText(model.id)}` : model.id))} />)}</datalist><input className="text-input omni-weight-input" type="number" min="0" max="100" value={step.weight} onChange={(event) => updateStep(step.key, { weight: Number(event.target.value) })} title={l(language, 'Вес', 'Weight')} /><div className="omni-row-actions"><button type="button" className="omni-icon-button" disabled={index === 0} onClick={() => moveStep(index, -1)}><Icon name="arrowUp" size={13} /></button><button type="button" className="omni-icon-button" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}><Icon name="arrowDown" size={13} /></button><button type="button" className="omni-icon-button danger" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((item) => item.key !== step.key) })}><Icon name="trash" size={13} /></button></div></div> })}</div>{draft.strategy === 'weighted' && <div className="omni-weight-total"><span>{l(language, 'Сумма весов', 'Weight total')}</span><Badge tone={draft.steps.reduce((sum, step) => sum + step.weight, 0) === 100 ? 'good' : 'bad'}>{draft.steps.reduce((sum, step) => sum + step.weight, 0)}%</Badge><button type="button" className="btn" onClick={() => { const base = Math.floor(100 / Math.max(1, draft.steps.length)); setDraft({ ...draft, steps: draft.steps.map((step, index) => ({ ...step, weight: base + (index === 0 ? 100 - base * draft.steps.length : 0) })) }) }}>{l(language, 'Распределить', 'Balance')}</button></div>}</section>
      <div className="omni-form-grid embedded"><Field label={l(language, 'Системное сообщение', 'System message')}><textarea className="omni-textarea compact" value={draft.systemMessage} onChange={(event) => setDraft({ ...draft, systemMessage: event.target.value })} /></Field><Field label={l(language, 'Длина контекста', 'Context length')}><input className="text-input" type="number" min="1000" value={draft.contextLength} onChange={(event) => setDraft({ ...draft, contextLength: event.target.value })} /></Field></div>
      <div className="omni-card-actions"><label className="omni-switch"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /><span />{l(language, 'Активно', 'Active')}</label><button type="button" className="btn" onClick={() => setDraft(null)}>{l(language, 'Отмена', 'Cancel')}</button><button type="button" className="btn primary" disabled={busy === 'save-combo'} onClick={() => void save()}><Icon name="save" size={14} />{l(language, 'Сохранить', 'Save')}</button></div>
    </div></section>}
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Комбо маршрутизации', 'Routing combos')}</span><Badge>{combos.length}</Badge></div>{resource.loading ? <Loading /> : combos.length === 0 ? <Empty>{l(language, 'Комбо пока нет.', 'No combos yet.')}</Empty> : <div className="omni-card-grid">{combos.map((combo, index) => { const id = omniId(combo); const steps = comboModels(combo); const metric = isRecord(metrics[id]) ? metrics[id] as OmniRecord : isRecord(metrics[omniLabel(combo)]) ? metrics[omniLabel(combo)] as OmniRecord : {}; const active = combo.isActive !== false; return <article className="omni-combo-card" key={id}><div className="omni-card-head"><Icon name="layers" size={18} /><div><strong>{omniLabel(combo)}</strong><small>{steps.map((step) => omniText(step.model)).join(' → ') || '—'}</small></div><button type="button" onClick={() => void updateCombo(combo, { isActive: !active })}><Badge tone={active ? 'good' : 'bad'}>{active ? 'ON' : 'OFF'}</Badge></button></div><div className="omni-combo-meta"><span>{steps.length} {l(language, 'шагов', 'steps')}</span><span>{omniText(combo.strategy, 'priority')}</span><span>{omniNumber(metric.successRate ?? metric.successRatePct)}% success</span></div><div className="omni-card-actions omni-card-actions-wrap"><button type="button" className="omni-icon-button" disabled={index === 0 || busy === 'reorder'} onClick={() => void reorder(index, -1)}><Icon name="arrowUp" size={14} /></button><button type="button" className="omni-icon-button" disabled={index === combos.length - 1 || busy === 'reorder'} onClick={() => void reorder(index, 1)}><Icon name="arrowDown" size={14} /></button><button type="button" className="btn" onClick={() => void test(combo)}><Icon name="play" size={14} />{l(language, 'Тест', 'Test')}</button><button type="button" className="btn" onClick={() => openEditor(combo)}><Icon name="settings" size={14} />{l(language, 'Изменить', 'Edit')}</button><button type="button" className="omni-icon-button" onClick={() => void duplicate(combo)}><Icon name="copy" size={14} /></button><button type="button" className="omni-icon-button danger" disabled={busy === `delete:${id}`} onClick={() => void remove(id)}><Icon name="trash" size={14} /></button></div></article> })}</div>}</section>
  </div>
}

function QuotaPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [error, setError] = useState('')
  const resource = useOmniResource(() => Promise.all([omniRequest<unknown>('GET', '/api/quota/pools'), omniRequest<unknown>('GET', '/api/quota/plans'), omniRequest<unknown>('GET', '/api/providers')]), [refreshKey, revision])
  const pools = omniList(resource.data?.[0], 'pools', 'data')
  const plans = omniList(resource.data?.[1], 'plans', 'data')
  const providers = omniList(resource.data?.[2], 'connections', 'providers', 'data')
  useEffect(() => { if (!connectionId && providers[0]) setConnectionId(omniId(providers[0])) }, [connectionId, providers])
  const create = async (event: FormEvent): Promise<void> => { event.preventDefault(); setError(''); try { await omniRequest('POST', '/api/quota/pools', { connectionId, name: name.trim(), allocations: [] }); setName(''); setRevision((value) => value + 1) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } }
  const remove = async (id: string): Promise<void> => { if (!window.confirm(l(language, 'Удалить пул квоты?', 'Delete quota pool?'))) return; try { await omniRequest('DELETE', `/api/quota/pools/${encodeURIComponent(id)}`); setRevision((value) => value + 1) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } }
  return <div className="omni-page"><PageHeader icon="sliders" title={tr(language, 'omni.quota')} subtitle={l(language, 'Лимиты, планы и распределение квот между ключами.', 'Limits, plans and fair quota allocation.')} />{(resource.error || error) && <Notice kind="error">{resource.error || error}</Notice>}
    <section className="omni-stat-grid compact"><div className="omni-stat-card"><span>{l(language, 'Планы', 'Plans')}</span><strong>{plans.length}</strong><small>{l(language, 'авто и вручную', 'auto and manual')}</small></div><div className="omni-stat-card"><span>{l(language, 'Пулы', 'Pools')}</span><strong>{pools.length}</strong><small>{l(language, 'совместного доступа', 'shared access')}</small></div><div className="omni-stat-card"><span>{l(language, 'Подключения', 'Connections')}</span><strong>{providers.length}</strong><small>{l(language, 'с квотами', 'with quotas')}</small></div></section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Создать пул', 'Create pool')}</span></div><form className="omni-inline-form" onSubmit={(event) => void create(event)}><select className="text-input" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}><option value="">{l(language, 'Выберите провайдера', 'Select provider')}</option>{providers.map((item) => <option key={omniId(item)} value={omniId(item)}>{omniLabel(item)}</option>)}</select><input className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder={l(language, 'Название пула', 'Pool name')} /><button className="btn primary" disabled={!connectionId || !name.trim()}><Icon name="plus" size={14} />{l(language, 'Создать', 'Create')}</button></form></section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Пулы квот', 'Quota pools')}</span></div>{pools.length === 0 ? <Empty>{l(language, 'Нет созданных пулов.', 'No quota pools.')}</Empty> : <div className="omni-card-grid">{pools.map((pool) => <article className="omni-combo-card" key={omniId(pool)}><div className="omni-card-head"><Icon name="users" size={18} /><div><strong>{omniLabel(pool)}</strong><small>{omniText(pool.connectionId)}</small></div></div><div className="omni-combo-meta"><span>{Array.isArray(pool.allocations) ? pool.allocations.length : 0} {l(language, 'распределений', 'allocations')}</span></div><div className="omni-card-actions"><button className="btn danger" onClick={() => void remove(omniId(pool))}><Icon name="trash" size={14} /></button></div></article>)}</div>}</section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Планы провайдеров', 'Provider plans')}</span><Badge>{plans.length}</Badge></div><div className="omni-table-wrap"><table className="omni-table"><thead><tr><th>{l(language, 'Провайдер', 'Provider')}</th><th>{l(language, 'Источник', 'Source')}</th><th>{l(language, 'Окна лимитов', 'Limit windows')}</th></tr></thead><tbody>{plans.map((plan, index) => <tr key={`${omniText(plan.connectionId ?? plan.provider)}:${index}`}><td><strong>{omniText(plan.provider, '—')}</strong></td><td><Badge tone={omniText(plan.source) === 'manual' ? 'blue' : 'neutral'}>{omniText(plan.source, 'auto')}</Badge></td><td><div className="omni-chip-row">{(Array.isArray(plan.dimensions) ? plan.dimensions.filter(isRecord) : []).map((dimension, dimensionIndex) => <Badge key={dimensionIndex}>{omniNumber(dimension.limit).toLocaleString(language)} {omniText(dimension.unit)} / {omniText(dimension.window)}</Badge>)}</div></td></tr>)}</tbody></table></div></section>
  </div>
}

function CompressionPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState('off')
  const [autoMode, setAutoMode] = useState('lite')
  const [triggerTokens, setTriggerTokens] = useState(0)
  const [input, setInput] = useState(l(language, 'Вставьте сюда длинный контекст, чтобы сравнить результат сжатия.', 'Paste a long context here to preview compression.'))
  const [preview, setPreview] = useState<unknown>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const resource = useOmniResource(() => omniRequest<unknown>('GET', '/api/settings/compression'), [refreshKey, revision])
  useEffect(() => { if (!isRecord(resource.data)) return; setEnabled(omniBool(resource.data.enabled)); setMode(omniText(resource.data.defaultMode, 'off')); setAutoMode(omniText(resource.data.autoTriggerMode, 'lite')); setTriggerTokens(omniNumber(resource.data.autoTriggerTokens)) }, [resource.data])
  const save = async (): Promise<void> => { setBusy('save'); setError(''); try { await omniRequest('PUT', '/api/settings/compression', { enabled, defaultMode: mode, autoTriggerMode: autoMode, autoTriggerTokens: triggerTokens }); setRevision((value) => value + 1) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy('') } }
  const runPreview = async (): Promise<void> => { setBusy('preview'); setError(''); try { setPreview(await omniRequest('POST', '/api/compression/preview', { mode, messages: [{ role: 'user', content: input }] })) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy('') } }
  const previewRecord = isRecord(preview) ? preview : {}
  const output = omniText(previewRecord.compressed ?? previewRecord.output ?? previewRecord.text ?? getNestedRecord(previewRecord, 'result').content, preview ? formatOmniJson(preview) : '')
  return <div className="omni-page"><PageHeader icon="barChart" title={tr(language, 'omni.compressionStudio')} subtitle={l(language, 'Настройка и сравнение режимов сжатия контекста.', 'Configure and compare context compression modes.')} actions={<button className="btn primary" disabled={busy === 'save'} onClick={() => void save()}><Icon name="save" size={14} />{l(language, 'Сохранить', 'Save')}</button>} />{(resource.error || error) && <Notice kind="error">{resource.error || error}</Notice>}
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Глобальные настройки', 'Global settings')}</span><label className="omni-switch"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span />{l(language, 'Сжатие включено', 'Compression enabled')}</label></div><div className="omni-form-grid"><Field label={l(language, 'Режим по умолчанию', 'Default mode')}><select className="text-input" value={mode} onChange={(event) => setMode(event.target.value)}>{['off','lite','standard','aggressive','ultra','rtk','stacked'].map((value) => <option key={value} value={value}>{value}</option>)}</select></Field><Field label={l(language, 'Автоматический режим', 'Auto-trigger mode')}><select className="text-input" value={autoMode} onChange={(event) => setAutoMode(event.target.value)}>{['off','lite','standard','aggressive','ultra','rtk','stacked'].map((value) => <option key={value} value={value}>{value}</option>)}</select></Field><Field label={l(language, 'Порог токенов', 'Token threshold')}><input className="text-input" type="number" min="0" value={triggerTokens} onChange={(event) => setTriggerTokens(Number(event.target.value))} /></Field></div></section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Предпросмотр', 'Preview')}</span><button className="btn" disabled={!input.trim() || busy === 'preview'} onClick={() => void runPreview()}><Icon name="play" size={14} />{l(language, 'Сжать', 'Compress')}</button></div><div className="omni-compare"><Field label={l(language, 'Исходный текст', 'Original')}><textarea className="omni-textarea" value={input} onChange={(event) => setInput(event.target.value)} /></Field><Field label={l(language, 'Результат', 'Compressed result')}><textarea className="omni-textarea" readOnly value={output} placeholder={l(language, 'Результат появится здесь.', 'Result appears here.')} /></Field></div>{preview !== null && <div className="omni-preview-stats"><Badge>{input.length} chars in</Badge><Badge tone="good">{output.length} chars out</Badge><Badge tone="blue">{input.length ? Math.max(0, Math.round((1 - output.length / input.length) * 100)) : 0}% saved</Badge></div>}</section>
  </div>
}

const CLI_TOOLS = ['codex', 'claude', 'cline', 'droid', 'kilo', 'openclaw', 'antigravity']

function CliPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const resource = useOmniResource<OmniRecord[]>(() => Promise.all(CLI_TOOLS.map(async (toolId): Promise<OmniRecord> => { try { const result = await omniRequest<unknown>('GET', `/api/cli-tools/runtime/${toolId}`); return { ...(isRecord(result) ? result : {}), toolId } } catch (error) { return { toolId, error: error instanceof Error ? error.message : String(error) } } })), [refreshKey])
  return <div className="omni-page"><PageHeader icon="terminal" title={tr(language, 'omni.cliCode')} subtitle={l(language, 'Состояние CLI-агентов и их конфигураций.', 'CLI agent runtime and configuration status.')} />{resource.error && <Notice kind="error">{resource.error}</Notice>}{resource.loading ? <Loading /> : <div className="omni-card-grid">{(resource.data ?? []).map((tool) => { const installed = omniBool(tool.installed); const runnable = omniBool(tool.runnable); return <article className="omni-cli-card" key={omniText(tool.toolId)}><div className="omni-card-head"><span className="omni-cli-icon"><Icon name="terminal" size={17} /></span><div><strong>{omniText(tool.toolId).toUpperCase()}</strong><small>{omniText(tool.command)}</small></div><Badge tone={runnable ? 'good' : installed ? 'blue' : 'neutral'}>{runnable ? l(language, 'готов', 'ready') : installed ? l(language, 'обнаружен', 'detected') : l(language, 'не найден', 'not found')}</Badge></div><dl className="omni-detail-list"><div><dt>{l(language, 'Режим', 'Mode')}</dt><dd>{omniText(tool.runtimeMode, 'auto')}</dd></div><div><dt>{l(language, 'Конфигурация', 'Config')}</dt><dd title={omniText(tool.configPath)}>{omniText(tool.configPath, '—')}</dd></div></dl><small className="omni-card-message">{omniText(tool.message ?? tool.error)}</small></article> })}</div>}</div>
}

function useTrafficPolling(enabled: boolean, path: string, onPayload: (payload: OmniRecord) => void): { connected: boolean; error: string } {
  const status = useApp((s) => s.omnirouteStatus)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const callback = useRef(onPayload)
  callback.current = onPayload
  useEffect(() => {
    if (!enabled || status.state !== 'ready' || !status.port) return
    let alive = true
    let timer: number | null = null
    const poll = async (): Promise<void> => {
      try {
        const body = await omniRequest<unknown>('GET', path)
        if (!alive) return
        setConnected(true); setError('')
        callback.current({ type: 'snapshot', data: omniList(body, 'requests', 'data') })
      } catch (caught) {
        if (!alive) return
        setConnected(false)
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        if (alive) timer = window.setTimeout(() => void poll(), 1500)
      }
    }
    void poll()
    return () => { alive = false; if (timer !== null) window.clearTimeout(timer) }
  }, [enabled, path, status.port, status.state])
  return { connected, error }
}

function TrafficPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState('')
  const [requestDetail, setRequestDetail] = useState<OmniRecord | null>(null)
  const [requests, setRequests] = useState<OmniRecord[]>([])
  const [sessionName, setSessionName] = useState('')
  const [hostName, setHostName] = useState('')
  const [hostLabel, setHostLabel] = useState('')
  const [hostKind, setHostKind] = useState('llm')
  const [profile, setProfile] = useState('all')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [sessionFilter, setSessionFilter] = useState('')
  const [query, setQuery] = useState('')
  const [annotation, setAnnotation] = useState('')
  const [replayResult, setReplayResult] = useState<unknown>(null)
  const queryPath = useMemo(() => {
    const params = new URLSearchParams()
    if (profile !== 'all') params.set('profile', profile)
    if (statusFilter) params.set('status', statusFilter)
    if (sourceFilter) params.set('source', sourceFilter)
    if (sessionFilter) params.set('sessionId', sessionFilter)
    const search = params.toString()
    return `/api/tools/traffic-inspector/requests${search ? `?${search}` : ''}`
  }, [profile, sessionFilter, sourceFilter, statusFilter])
  const resource = useOmniResource(() => Promise.all([
    omniRequest<unknown>('GET', queryPath), omniRequest<unknown>('GET', '/api/tools/traffic-inspector/capture-modes'),
    omniRequest<unknown>('GET', '/api/tools/traffic-inspector/sessions'), omniRequest<unknown>('GET', '/api/tools/traffic-inspector/hosts')
  ]), [refreshKey, revision, queryPath])
  const modes = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const sessions = omniList(resource.data?.[2], 'sessions', 'data')
  const hosts = omniList(resource.data?.[3], 'hosts', 'data')
  const httpProxy = getNestedRecord(modes, 'httpProxy')
  const systemProxy = getNestedRecord(modes, 'systemProxy')
  const tls = getNestedRecord(modes, 'tlsIntercept')
  const httpActive = omniBool(httpProxy.active ?? httpProxy.running)
  const systemActive = omniBool(systemProxy.active ?? systemProxy.applied)
  const tlsActive = omniBool(tls.active ?? tls.enabled)

  useEffect(() => { if (resource.data) setRequests(omniList(resource.data[0], 'requests', 'data')) }, [resource.data?.[0]])
  useEffect(() => {
    if (!selected) { setRequestDetail(null); setAnnotation(''); return }
    let alive = true
    void omniRequest<unknown>('GET', `/api/tools/traffic-inspector/requests/${encodeURIComponent(selected)}`).then((body) => {
      if (!alive) return
      const detail = isRecord(body) ? body : null
      setRequestDetail(detail); setAnnotation(detail ? omniText(detail.annotation) : '')
    }, (caught: unknown) => alive && setError(caught instanceof Error ? caught.message : String(caught)))
    return () => { alive = false }
  }, [selected, revision])

  const socket = useTrafficPolling(true, queryPath, useCallback((payload: OmniRecord) => {
    const type = omniText(payload.type)
    const data = payload.data
    if (type === 'snapshot' && Array.isArray(data)) setRequests(data.filter(isRecord))
    else if (type === 'new' && isRecord(data)) setRequests((current) => [data, ...current.filter((item) => omniId(item) !== omniId(data))])
    else if (type === 'update' && isRecord(data)) setRequests((current) => current.map((item) => omniId(item) === omniId(data) ? { ...item, ...data } : item))
    else if (type === 'clear') { setRequests([]); setSelected('') }
  }, []))
  const visibleRequests = requests.filter((request) => {
    const needle = query.trim().toLowerCase()
    if (profile !== 'all' && omniText(request.detectedKind) !== profile) return false
    if (sourceFilter && omniText(request.source) !== sourceFilter) return false
    if (sessionFilter && omniText(request.sessionId) !== sessionFilter) return false
    const status = request.status
    const numeric = typeof status === 'number' ? status : 0
    if (statusFilter && statusFilter !== 'error' && `${Math.floor(numeric / 100)}xx` !== statusFilter) return false
    if (statusFilter === 'error' && status !== 'error') return false
    return !needle || `${omniText(request.method)} ${omniText(request.host)} ${omniText(request.path)} ${omniText(request.sourceModel)} ${omniText(request.mappedModel)}`.toLowerCase().includes(needle)
  })

  const invoke = async (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, key = path): Promise<unknown> => {
    setBusy(key); setError('')
    try { const response = await omniRequest(method, path, body); setRevision((value) => value + 1); return response }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return null }
    finally { setBusy('') }
  }
  const toggleSystemProxy = (): void => {
    if (!systemActive && !window.confirm(l(language, 'OmniRoute изменит системные настройки прокси. Продолжить?', 'OmniRoute will change the system proxy settings. Continue?'))) return
    void invoke('POST', '/api/tools/traffic-inspector/capture-modes/system-proxy', { action: systemActive ? 'revert' : 'apply', port: omniNumber(httpProxy.port, 8080), guardMinutes: 30 })
  }
  const replay = async (): Promise<void> => {
    if (!selected) return
    setBusy('replay'); setError(''); setReplayResult(null)
    try { setReplayResult(await omniRequest('POST', `/api/tools/traffic-inspector/requests/${encodeURIComponent(selected)}/replay`)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const saveAnnotation = async (): Promise<void> => { if (selected) await invoke('PUT', `/api/tools/traffic-inspector/requests/${encodeURIComponent(selected)}/annotation`, { annotation }, 'annotation') }
  const exportHar = async (sessionId?: string): Promise<void> => {
    setBusy('export'); setError('')
    try {
      const body = await omniRequest('GET', sessionId ? `/api/tools/traffic-inspector/sessions/${encodeURIComponent(sessionId)}/export.har` : '/api/tools/traffic-inspector/export.har')
      downloadOmniJson(body, `omniroute-traffic-${sessionId || new Date().toISOString().replace(/[:.]/g, '-')}.har`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const sessionAction = async (session: OmniRecord, action: 'stop' | 'rename' | 'delete' | 'export'): Promise<void> => {
    const id = omniId(session)
    if (action === 'export') { await exportHar(id); return }
    if (action === 'delete') { if (!window.confirm(l(language, 'Удалить сессию записи?', 'Delete this recording session?'))) return; await invoke('DELETE', `/api/tools/traffic-inspector/sessions/${encodeURIComponent(id)}`, undefined, `session:${id}`); return }
    const name = action === 'rename' ? window.prompt(l(language, 'Новое название сессии', 'New session name'), omniLabel(session, '')) : undefined
    if (action === 'rename' && name === null) return
    await invoke('PATCH', `/api/tools/traffic-inspector/sessions/${encodeURIComponent(id)}`, { action, ...(name !== undefined ? { name } : {}) }, `session:${id}`)
  }

  return <div className="omni-page"><PageHeader icon="activity" title={tr(language, 'omni.trafficInspector')} subtitle={l(language, 'Live-захват, фильтрация, replay и HAR.', 'Live capture, filters, replay and HAR export.')} actions={<><Badge tone={socket.connected ? 'good' : 'bad'}>{socket.connected ? 'LIVE' : 'OFFLINE'}</Badge><button type="button" className="btn" disabled={busy === 'export'} onClick={() => void exportHar()}><Icon name="save" size={14} />HAR</button><button type="button" className="btn danger" disabled={requests.length === 0} onClick={() => void invoke('DELETE', '/api/tools/traffic-inspector/requests')}><Icon name="trash" size={14} />{l(language, 'Очистить', 'Clear')}</button></>} />
    {(resource.error || error || socket.error) && <Notice kind="error">{resource.error || error || socket.error}</Notice>}{replayResult !== null && <Notice><strong>Replay</strong><pre>{typeof replayResult === 'string' ? replayResult : formatOmniJson(replayResult)}</pre></Notice>}
    <section className="omni-mode-grid"><button type="button" className={`omni-mode-card${httpActive ? ' active' : ''}`} onClick={() => void invoke('POST', '/api/tools/traffic-inspector/capture-modes/http-proxy', { action: httpActive ? 'stop' : 'start' })}><Icon name="globe" size={18} /><div><strong>HTTP_PROXY</strong><small>{httpActive ? `${l(language, 'порт', 'port')} ${omniNumber(httpProxy.port, 8080)}` : l(language, 'выключен', 'stopped')}</small></div><Badge tone={httpActive ? 'good' : 'neutral'}>{httpActive ? 'ON' : 'OFF'}</Badge></button><button type="button" className={`omni-mode-card${tlsActive ? ' active' : ''}`} onClick={() => void invoke('POST', '/api/tools/traffic-inspector/capture-modes/tls-intercept', { enabled: !tlsActive })}><Icon name="key" size={18} /><div><strong>TLS intercept</strong><small>{l(language, 'Расшифровка тела', 'Body decryption')}</small></div><Badge tone={tlsActive ? 'good' : 'neutral'}>{tlsActive ? 'ON' : 'OFF'}</Badge></button><button type="button" className={`omni-mode-card${systemActive ? ' active' : ''}`} onClick={toggleSystemProxy}><Icon name="server" size={18} /><div><strong>{l(language, 'Системный прокси', 'System proxy')}</strong><small>{l(language, 'Настройки ОС', 'OS settings')}</small></div><Badge tone={systemActive ? 'good' : 'neutral'}>{systemActive ? 'ON' : 'OFF'}</Badge></button></section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Сессии записи', 'Recording sessions')}</span><Badge>{sessions.length}</Badge></div><form className="omni-inline-form" onSubmit={(event) => { event.preventDefault(); void invoke('POST', '/api/tools/traffic-inspector/sessions', { name: sessionName.trim() || undefined }, 'new-session').then(() => setSessionName('')) }}><input className="text-input" value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder={l(language, 'Название сессии', 'Session name')} /><button className="btn"><Icon name="play" size={14} />{l(language, 'Начать запись', 'Start recording')}</button></form>{sessions.length > 0 && <div className="omni-session-list">{sessions.map((session) => { const id = omniId(session); const active = !session.ended_at && !session.endedAt; return <div className="omni-session-row" key={id}><Badge tone={active ? 'good' : 'neutral'}>{active ? 'REC' : 'STOP'}</Badge><div><strong>{omniLabel(session, l(language, 'Без названия', 'Untitled'))}</strong><small>{formatOmniDate(session.started_at ?? session.startedAt, language)} · {omniNumber(session.request_count ?? session.requestCount)} req</small></div><div className="omni-row-actions">{active && <button type="button" className="btn" onClick={() => void sessionAction(session, 'stop')}><Icon name="stop" size={13} /></button>}<button type="button" className="omni-icon-button" onClick={() => void sessionAction(session, 'rename')}><Icon name="settings" size={13} /></button><button type="button" className="omni-icon-button" onClick={() => void sessionAction(session, 'export')}><Icon name="save" size={13} /></button><button type="button" className="omni-icon-button danger" onClick={() => void sessionAction(session, 'delete')}><Icon name="trash" size={13} /></button></div></div> })}</div>}</section>
    <section className="omni-panel"><div className="omni-panel-title"><span>Host rules</span><Badge>{hosts.length}</Badge></div><form className="omni-inline-form omni-host-form" onSubmit={(event) => { event.preventDefault(); if (!hostName.trim()) return; void invoke('POST', '/api/tools/traffic-inspector/hosts', { host: hostName.trim(), label: hostLabel.trim() || null, kind: hostKind, enabled: true }, 'add-host').then(() => { setHostName(''); setHostLabel('') }) }}><input className="text-input" value={hostName} onChange={(event) => setHostName(event.target.value)} placeholder="api.example.com" /><input className="text-input" value={hostLabel} onChange={(event) => setHostLabel(event.target.value)} placeholder={l(language, 'Метка', 'Label')} /><select className="text-input small" value={hostKind} onChange={(event) => setHostKind(event.target.value)}><option value="llm">LLM</option><option value="app">App</option><option value="custom">Custom</option></select><button className="btn" disabled={!hostName.trim()}><Icon name="plus" size={13} />{l(language, 'Добавить', 'Add')}</button></form>{hosts.length > 0 && <div className="omni-chip-cloud">{hosts.map((host) => { const name = omniText(host.host); const active = host.enabled !== false; return <span className="omni-host-chip" key={name}><button type="button" onClick={() => void invoke('PATCH', `/api/tools/traffic-inspector/hosts/${encodeURIComponent(name)}`, { enabled: !active })}><Badge tone={active ? 'good' : 'neutral'}>{name}</Badge></button><small>{omniText(host.kind)}</small><button type="button" className="omni-icon-button danger" onClick={() => void invoke('DELETE', `/api/tools/traffic-inspector/hosts/${encodeURIComponent(name)}`)}><Icon name="close" size={12} /></button></span> })}</div>}</section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Запросы', 'Requests')}</span><Badge>{visibleRequests.length}/{requests.length}</Badge></div><div className="omni-filter-bar"><input className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l(language, 'URL, модель или провайдер', 'URL, model or provider')} /><select className="text-input small" value={profile} onChange={(event) => setProfile(event.target.value)}><option value="all">All profiles</option><option value="llm">LLM</option><option value="custom">Custom</option></select><select className="text-input small" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All status</option>{['2xx','3xx','4xx','5xx','error'].map((value) => <option key={value} value={value}>{value}</option>)}</select><select className="text-input small" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">All sources</option>{['agent-bridge','custom-host','http-proxy','system-proxy'].map((value) => <option key={value} value={value}>{value}</option>)}</select><select className="text-input small" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}><option value="">All sessions</option>{sessions.map((session) => <option key={omniId(session)} value={omniId(session)}>{omniLabel(session)}</option>)}</select></div>
      {visibleRequests.length === 0 ? <Empty>{l(language, 'Перехваченных запросов пока нет.', 'No captured requests yet.')}</Empty> : <div className="omni-traffic-layout"><div className="omni-table-wrap"><table className="omni-table interactive"><thead><tr><th>{l(language, 'Метод', 'Method')}</th><th>Host / path</th><th>{l(language, 'Модель', 'Model')}</th><th>{l(language, 'Статус', 'Status')}</th><th>{l(language, 'Время', 'Time')}</th></tr></thead><tbody>{visibleRequests.map((request) => { const id = omniId(request); const statusValue = request.status ?? request.statusCode; const statusCode = typeof statusValue === 'number' ? statusValue : 0; return <tr key={id} className={selected === id ? 'selected' : ''} onClick={() => setSelected(id)}><td><Badge tone="blue">{omniText(request.method, 'POST')}</Badge></td><td className="truncate"><strong>{omniText(request.host)}</strong>{omniText(request.path ?? request.url)}</td><td>{omniText(request.mappedModel ?? request.sourceModel, '—')}</td><td><Badge tone={statusCode >= 200 && statusCode < 400 ? 'good' : statusCode ? 'bad' : 'neutral'}>{statusCode || omniText(statusValue, '—')}</Badge></td><td>{omniNumber(request.totalLatencyMs ?? request.durationMs ?? request.duration)} ms</td></tr> })}</tbody></table></div>{requestDetail && <aside className="omni-request-detail-pane"><div className="omni-request-detail-head"><strong>{omniText(requestDetail.method)} {omniText(requestDetail.host)}{omniText(requestDetail.path)}</strong><button type="button" className="omni-icon-button" onClick={() => setSelected('')}><Icon name="close" size={13} /></button></div><dl className="omni-detail-list"><div><dt>Source</dt><dd>{omniText(requestDetail.source)}</dd></div><div><dt>Model</dt><dd>{omniText(requestDetail.sourceModel)} → {omniText(requestDetail.mappedModel)}</dd></div><div><dt>Latency</dt><dd>{omniNumber(requestDetail.totalLatencyMs)} ms</dd></div></dl><details open><summary>Request</summary><pre>{omniText(requestDetail.requestBody, formatOmniJson(requestDetail.requestHeaders))}</pre></details><details><summary>Response</summary><pre>{omniText(requestDetail.responseBody, formatOmniJson(requestDetail.responseHeaders))}</pre></details><Field label={l(language, 'Аннотация', 'Annotation')}><textarea className="omni-textarea compact" value={annotation} onChange={(event) => setAnnotation(event.target.value)} /></Field><div className="omni-card-actions"><button type="button" className="btn" disabled={busy === 'annotation'} onClick={() => void saveAnnotation()}><Icon name="save" size={13} />{l(language, 'Заметка', 'Note')}</button><button type="button" className="btn primary" disabled={busy === 'replay'} onClick={() => void replay()}><Icon name="play" size={13} />Replay</button></div></aside>}</div>}
    </section>
  </div>
}

function PlaygroundPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [model, setModel] = useState('')
  const [system, setSystem] = useState('')
  const [prompt, setPrompt] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [response, setResponse] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const resource = useOmniResource(() => omniRequest<unknown>('GET', '/api/v1/models'), [refreshKey])
  const models = omniList(resource.data, 'data', 'models')
  useEffect(() => { if (!model && models[0]) setModel(omniText(models[0].id)) }, [model, models])
  const send = async (event: FormEvent): Promise<void> => { event.preventDefault(); if (!model || !prompt.trim()) return; setRunning(true); setError(''); setResponse(null); try { setResponse(await omniRequest('POST', '/api/v1/chat/completions', { model, messages: [...(system.trim() ? [{ role: 'system', content: system.trim() }] : []), { role: 'user', content: prompt.trim() }], temperature, max_tokens: maxTokens, stream: false })) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setRunning(false) } }
  const responseRecord = isRecord(response) ? response : {}
  const choices = Array.isArray(responseRecord.choices) ? responseRecord.choices.filter(isRecord) : []
  const message = choices[0] ? getNestedRecord(choices[0], 'message') : {}
  const answer = omniText(message.content ?? responseRecord.output_text, response ? formatOmniJson(response) : '')
  return <div className="omni-page"><PageHeader icon="flask" title={tr(language, 'omni.playground')} subtitle={l(language, 'Проверка моделей через единый Chat Completions API.', 'Test models through the unified Chat Completions API.')} />{(resource.error || error) && <Notice kind="error">{resource.error || error}</Notice>}
    <form className="omni-playground" onSubmit={(event) => void send(event)}><section className="omni-panel omni-playground-settings"><div className="omni-panel-title"><span>{l(language, 'Параметры', 'Parameters')}</span></div><Field label={l(language, 'Модель', 'Model')}><select className="text-input" value={model} onChange={(event) => setModel(event.target.value)}>{models.map((item) => <option key={omniText(item.id)} value={omniText(item.id)}>{omniText(item.id)}</option>)}</select></Field><Field label={l(language, 'Системная инструкция', 'System instruction')}><textarea className="omni-textarea small" value={system} onChange={(event) => setSystem(event.target.value)} /></Field><Field label={`${l(language, 'Температура', 'Temperature')}: ${temperature}`}><input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></Field><Field label="Max tokens"><input className="text-input" type="number" min="1" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></Field></section><section className="omni-panel omni-playground-chat"><div className="omni-panel-title"><span>{l(language, 'Диалог', 'Conversation')}</span></div><textarea className="omni-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={l(language, 'Введите сообщение…', 'Enter a message…')} />{answer && <div className="omni-answer"><div className="omni-answer-label"><Icon name="sparkles" size={15} />{l(language, 'Ответ модели', 'Model response')}</div><pre>{answer}</pre></div>}<div className="omni-playground-send"><span>{models.length} {l(language, 'моделей', 'models')}</span><button className="btn primary" disabled={running || !model || !prompt.trim()}>{running ? <span className="omni-spinner small" /> : <Icon name="send" size={14} />}{l(language, 'Отправить', 'Send')}</button></div></section></form>
  </div>
}

function NativePage({ path, language, refreshKey }: { path: string; language: AppLanguage; refreshKey: number }): JSX.Element {
  if (path === '/home') return <HomePage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/endpoint') return <EndpointsPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/api-manager') return <ApiManagerPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/providers') return <FullProvidersPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/combos') return <CombosPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/combos/live') return <CombosPage language={language} refreshKey={refreshKey} studio />
  if (path === '/dashboard/quota') return <QuotaPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/compression/studio') return <CompressionPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/cli-code') return <CliPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/tools/traffic-inspector') return <TrafficPage language={language} refreshKey={refreshKey} />
  if (path === '/dashboard/playground') return <PlaygroundPage language={language} refreshKey={refreshKey} />
  return <HomePage language={language} refreshKey={refreshKey} />
}

export function OmnirouteView(): JSX.Element {
  const status = useApp((s) => s.omnirouteStatus)
  const path = useApp((s) => s.omniroutePath)
  const openOmniroutePage = useApp((s) => s.openOmniroutePage)
  const closeOmniroute = useApp((s) => s.closeOmniroute)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey): string => tr(appLanguage, key)
  const [reloadKey, setReloadKey] = useState(0)
  const [sectionsOpen, setSectionsOpen] = useState(false)
  const [tabScroll, setTabScroll] = useState({ overflow: false, left: false, right: false })
  const tabsRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef<HTMLDivElement>(null)

  const updateTabScroll = useCallback((): void => {
    const tabs = tabsRef.current
    if (!tabs) return
    const maxScrollLeft = Math.max(0, tabs.scrollWidth - tabs.clientWidth)
    setTabScroll({
      overflow: maxScrollLeft > 2,
      left: tabs.scrollLeft > 1,
      right: tabs.scrollLeft < maxScrollLeft - 1
    })
  }, [])

  useEffect(() => {
    if (useApp.getState().omnirouteStatus.state === 'stopped') void api.omniroute.start().catch(() => {})
  }, [])

  useEffect(() => {
    const tabs = tabsRef.current
    if (!tabs) return
    const scrollWheelHorizontally = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const before = tabs.scrollLeft
      tabs.scrollLeft += event.deltaY
      if (tabs.scrollLeft !== before) event.preventDefault()
    }
    const observer = new ResizeObserver(updateTabScroll)
    observer.observe(tabs)
    tabs.addEventListener('scroll', updateTabScroll, { passive: true })
    tabs.addEventListener('wheel', scrollWheelHorizontally, { passive: false })
    updateTabScroll()
    return () => {
      observer.disconnect()
      tabs.removeEventListener('scroll', updateTabScroll)
      tabs.removeEventListener('wheel', scrollWheelHorizontally)
    }
  }, [updateTabScroll])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const activeTab = tabsRef.current?.querySelector<HTMLElement>('.omni-tab.active')
      activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      updateTabScroll()
    })
    return () => cancelAnimationFrame(frame)
  }, [appLanguage, path, updateTabScroll])

  useEffect(() => {
    if (!sectionsOpen) return
    const closeOutside = (event: MouseEvent): void => {
      if (!sectionsRef.current?.contains(event.target as Node)) setSectionsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSectionsOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sectionsOpen])

  const scrollTabs = (direction: -1 | 1): void => {
    const tabs = tabsRef.current
    if (!tabs) return
    tabs.scrollBy({ left: direction * Math.max(180, tabs.clientWidth * 0.65), behavior: 'smooth' })
  }

  return (
    <div className="omni-view">
      <div className="omni-toolbar">
        <span className="omni-view-title"><Icon name="route" size={15} /><span>{t('rail.omniroute')}</span></span>
        <div className="omni-sections" ref={sectionsRef}>
          <button
            className={`omni-sections-button${sectionsOpen ? ' active' : ''}`}
            type="button"
            aria-label={t('omni.sections')}
            aria-haspopup="menu"
            aria-expanded={sectionsOpen}
            title={t('omni.sections')}
            onClick={() => setSectionsOpen((open) => !open)}
          >
            <Icon name="list" size={14} />
            <span>{t('omni.sections')}</span>
            <Icon name="chevronDown" size={11} />
          </button>
          {sectionsOpen && (
            <div className="omni-sections-menu" role="menu" aria-label={t('omni.sections')}>
              {OMNI_PAGE_GROUPS.map((group) => (
                <div className="omni-sections-group" role="group" aria-label={t(group.labelKey)} key={group.id}>
                  <div className="omni-sections-group-label">{t(group.labelKey)}</div>
                  {OMNI_PAGES.filter((page) => page.group === group.id).map((page) => (
                    <button
                      className={`omni-sections-item${path === page.path ? ' active' : ''}`}
                      type="button"
                      role="menuitem"
                      aria-current={path === page.path ? 'page' : undefined}
                      key={page.path}
                      onClick={() => {
                        openOmniroutePage(page.path)
                        setSectionsOpen(false)
                      }}
                    >
                      <Icon name={page.icon} size={14} />
                      <span>{t(page.labelKey)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {tabScroll.overflow && (
          <button className="omni-tab-scroll left" type="button" disabled={!tabScroll.left} aria-label={t('omni.scrollLeft')} title={t('omni.scrollLeft')} onClick={() => scrollTabs(-1)}><Icon name="chevronRight" size={13} /></button>
        )}
        <div className="omni-tabs" ref={tabsRef} role="tablist">
          {OMNI_PAGES.map((page) => <button className={`omni-tab${path === page.path ? ' active' : ''}`} key={page.path} role="tab" aria-selected={path === page.path} title={t(page.labelKey)} onClick={() => openOmniroutePage(page.path)}><Icon name={page.icon} size={14} /><span>{t(page.labelKey)}</span></button>)}
        </div>
        {tabScroll.overflow && (
          <button className="omni-tab-scroll" type="button" disabled={!tabScroll.right} aria-label={t('omni.scrollRight')} title={t('omni.scrollRight')} onClick={() => scrollTabs(1)}><Icon name="chevronRight" size={13} /></button>
        )}
        <button className="omni-toolbtn" title={t('common.refresh')} aria-label={t('common.refresh')} disabled={status.state !== 'ready'} onClick={() => setReloadKey((key) => key + 1)}><Icon name="refresh" size={14} /></button>
        <button className="omni-toolbtn" title={t('common.close')} aria-label={t('common.close')} onClick={closeOmniroute}><Icon name="close" size={14} /></button>
      </div>
      <div className="omni-host">
        {status.state === 'ready' ? <div className="omni-native-scroll"><NativePage key={`${path}:${reloadKey}`} path={path} language={appLanguage} refreshKey={reloadKey} /></div> : status.state === 'error' ? <div className="omni-state"><Icon name="route" size={26} /><div className="omni-state-title">{t('settings.omnirouteError')}</div>{status.error && <pre className="omni-state-error">{status.error}</pre>}<div className="omni-state-actions"><button className="btn" onClick={() => void api.omniroute.start().catch(() => {})}>{t('settings.omnirouteRetry')}</button>{status.logsPath && <button className="btn" onClick={() => void api.fs.openPath(status.logsPath)}>{t('settings.omnirouteOpenLogs')}</button>}</div></div> : <div className="omni-state"><span className="omni-spinner" aria-hidden="true" /><div className="omni-state-title">{(status.startingForMs ?? 0) > FIRST_BOOT_HINT_MS ? t('settings.omnirouteFirstStart') : t('settings.omnirouteStarting')}</div></div>}
      </div>
    </div>
  )
}
