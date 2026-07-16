import {
  useEffect,
  useState,
  type DependencyList,
  type FormEvent,
  type JSX,
  type ReactNode
} from 'react'
import { Icon, type IconName } from '@/components/Icon'
import { OMNI_PAGES } from '@/lib/omniroutePages'
import {
  formatOmniDate,
  formatOmniJson,
  isRecord,
  omniBool,
  omniId,
  omniLabel,
  omniList,
  omniNumber,
  omniRequest,
  omniText,
  type OmniRecord
} from '@/lib/omnirouteApi'
import { useApp, type AppLanguage } from '@/state/store'
import { api } from '@/lib/api'
import { tr, type TranslationKey } from '@/language'

const FIRST_BOOT_HINT_MS = 10_000
const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1'
}

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

function ApiManagerPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState('')
  const [createdKey, setCreatedKey] = useState('')
  const [actionError, setActionError] = useState('')
  const resource = useOmniResource(() => omniRequest<unknown>('GET', '/api/keys'), [refreshKey, revision])
  const keys = omniList(resource.data, 'keys', 'data')

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!label.trim()) return
    setBusy('create'); setActionError(''); setCreatedKey('')
    try {
      // OmniRoute 3.8.x runtime expects `name`; older OpenAPI builds called
      // the same field `label`, so send both for forward/backward compatibility.
      const result = await omniRequest<unknown>('POST', '/api/keys', { name: label.trim(), label: label.trim() })
      if (isRecord(result)) setCreatedKey(omniText(result.key ?? result.apiKey ?? getNestedRecord(result, 'data').key))
      setLabel(''); setRevision((value) => value + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally { setBusy('') }
  }

  const remove = async (id: string): Promise<void> => {
    if (!id || !window.confirm(l(language, 'Удалить этот ключ API?', 'Delete this API key?'))) return
    setBusy(id); setActionError('')
    try { await omniRequest('DELETE', `/api/keys/${encodeURIComponent(id)}`); setRevision((value) => value + 1) }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }

  return (
    <div className="omni-page">
      <PageHeader icon="key" title={tr(language, 'omni.apiManager')} subtitle={l(language, 'Ключи доступа для клиентов OmniRoute.', 'Access keys for OmniRoute clients.')} />
      {(resource.error || actionError) && <Notice kind="error">{resource.error || actionError}</Notice>}
      {createdKey && <Notice kind="success"><strong>{l(language, 'Новый ключ — сохраните его сейчас:', 'New key — save it now:')}</strong><code>{createdKey}</code><CopyButton value={createdKey} label={l(language, 'Копировать', 'Copy')} /></Notice>}
      <section className="omni-panel">
        <div className="omni-panel-title"><span>{l(language, 'Создать ключ', 'Create key')}</span></div>
        <form className="omni-inline-form" onSubmit={(event) => void create(event)}>
          <input className="text-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={l(language, 'Название ключа', 'Key label')} />
          <button className="btn primary" disabled={busy === 'create' || !label.trim()}><Icon name="plus" size={14} />{l(language, 'Создать', 'Create')}</button>
        </form>
      </section>
      <section className="omni-panel">
        <div className="omni-panel-title"><span>{l(language, 'Ключи API', 'API keys')}</span><Badge>{keys.length}</Badge></div>
        {resource.loading ? <Loading /> : keys.length === 0 ? <Empty>{l(language, 'Ключей пока нет.', 'No keys yet.')}</Empty> : (
          <div className="omni-table-wrap"><table className="omni-table"><thead><tr><th>{l(language, 'Название', 'Label')}</th><th>{l(language, 'Ключ', 'Key')}</th><th>{l(language, 'Состояние', 'Status')}</th><th>{l(language, 'Создан', 'Created')}</th><th /></tr></thead><tbody>
            {keys.map((key) => { const id = omniId(key); const active = key.isActive !== false && key.enabled !== false; return <tr key={id || omniLabel(key)}><td><strong>{omniLabel(key)}</strong></td><td><code>•••• {omniText(key.keyPreview ?? key.preview ?? key.lastFour)}</code></td><td><Badge tone={active ? 'good' : 'bad'}>{active ? l(language, 'Активен', 'Active') : l(language, 'Отключён', 'Disabled')}</Badge></td><td>{formatOmniDate(key.createdAt ?? key.created_at, language)}</td><td className="actions"><button className="omni-icon-button danger" disabled={busy === id} onClick={() => void remove(id)}><Icon name="trash" size={14} /></button></td></tr> })}
          </tbody></table></div>
        )}
      </section>
    </div>
  )
}

function ProvidersPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [provider, setProvider] = useState('openai')
  const [name, setName] = useState('')
  const [url, setUrl] = useState(DEFAULT_PROVIDER_URLS.openai)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState('')
  const resource = useOmniResource(() => omniRequest<unknown>('GET', '/api/providers'), [refreshKey, revision])
  const providers = omniList(resource.data, 'connections', 'providers', 'data')

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy('create'); setResult('')
    try {
      await omniRequest('POST', '/api/providers', { provider, name: name.trim() || provider, url: url.trim(), apiKey: apiKey.trim() || undefined, isActive: true })
      setName(''); setApiKey(''); setRevision((value) => value + 1)
    } catch (error) { setResult(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  const action = async (id: string, kind: 'test' | 'delete'): Promise<void> => {
    if (kind === 'delete' && !window.confirm(l(language, 'Удалить провайдера?', 'Delete provider?'))) return
    setBusy(`${kind}:${id}`); setResult('')
    try {
      const response = await omniRequest(kind === 'test' ? 'POST' : 'DELETE', `/api/providers/${encodeURIComponent(id)}${kind === 'test' ? '/test' : ''}`)
      if (kind === 'test') setResult(formatOmniJson(response)); else setRevision((value) => value + 1)
    } catch (error) { setResult(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  return (
    <div className="omni-page">
      <PageHeader icon="server" title={tr(language, 'omni.providers')} subtitle={l(language, 'Подключения к облачным и локальным моделям.', 'Cloud and local model connections.')} />
      {resource.error && <Notice kind="error">{resource.error}</Notice>}
      {result && <Notice kind={result.startsWith('{') ? 'info' : 'error'}><pre>{result}</pre></Notice>}
      <section className="omni-panel">
        <div className="omni-panel-title"><span>{l(language, 'Добавить провайдера', 'Add provider')}</span></div>
        <form className="omni-form-grid" onSubmit={(event) => void create(event)}>
          <Field label={l(language, 'Тип', 'Provider')}><select className="text-input" value={provider} onChange={(event) => { const value = event.target.value; setProvider(value); setUrl(DEFAULT_PROVIDER_URLS[value] ?? '') }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="custom">Custom OpenAI</option></select></Field>
          <Field label={l(language, 'Название', 'Name')}><input className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder={provider} /></Field>
          <Field label="Base URL"><input className="text-input" required value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
          <Field label="API key" hint={l(language, 'Не нужен для локальных серверов.', 'Optional for local servers.')}><input className="text-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></Field>
          <div className="omni-form-submit"><button className="btn primary" disabled={busy === 'create' || !url.trim()}><Icon name="plus" size={14} />{l(language, 'Подключить', 'Connect')}</button></div>
        </form>
      </section>
      <section className="omni-panel">
        <div className="omni-panel-title"><span>{l(language, 'Подключения', 'Connections')}</span><Badge>{providers.length}</Badge></div>
        {resource.loading ? <Loading /> : providers.length === 0 ? <Empty>{l(language, 'Добавьте первый источник моделей.', 'Add your first model source.')}</Empty> : <div className="omni-card-grid">
          {providers.map((item) => { const id = omniId(item); const active = item.isActive !== false && item.enabled !== false; return <article className="omni-provider-card" key={id || omniLabel(item)}><div className="omni-card-head"><span className="omni-provider-logo">{omniLabel(item).slice(0, 2).toUpperCase()}</span><div><strong>{omniLabel(item)}</strong><small>{omniText(item.provider ?? item.type)}</small></div><Badge tone={active ? 'good' : 'bad'}>{active ? l(language, 'активен', 'active') : l(language, 'выключен', 'off')}</Badge></div><code>{omniText(item.url ?? item.baseUrl, '—')}</code><div className="omni-card-actions"><button className="btn" disabled={!id || busy === `test:${id}`} onClick={() => void action(id, 'test')}><Icon name="activity" size={14} />{l(language, 'Проверить', 'Test')}</button><button className="btn danger" disabled={!id || busy === `delete:${id}`} onClick={() => void action(id, 'delete')}><Icon name="trash" size={14} /></button></div></article> })}
        </div>}
      </section>
    </div>
  )
}

function CombosPage({ language, refreshKey, studio = false }: { language: AppLanguage; refreshKey: number; studio?: boolean }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [name, setName] = useState('')
  const [model, setModel] = useState('auto/best-coding')
  const [strategy, setStrategy] = useState('priority')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedCombo, setSelectedCombo] = useState('')
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState('')
  const resource = useOmniResource(() => Promise.all([omniRequest<unknown>('GET', '/api/combos'), omniRequest<unknown>('GET', '/api/providers'), omniRequest<unknown>('GET', '/api/combos/metrics')]), [refreshKey, revision])
  const combos = omniList(resource.data?.[0], 'combos', 'data')
  const providers = omniList(resource.data?.[1], 'connections', 'providers', 'data')
  const activeCombo = combos.find((combo) => omniId(combo) === selectedCombo) ?? combos[0]
  useEffect(() => { if (!selectedCombo && combos[0]) setSelectedCombo(omniId(combos[0])) }, [combos, selectedCombo])

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy('create'); setResult('')
    try {
      await omniRequest('POST', '/api/combos', { name: name.trim(), model: model.trim(), strategy, nodes: selectedNodes.map((connectionId, index) => ({ connectionId, priority: index + 1, weight: 100 })) })
      setName(''); setSelectedNodes([]); setRevision((value) => value + 1)
    } catch (error) { setResult(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(l(language, 'Удалить комбо?', 'Delete combo?'))) return
    setBusy(id)
    try { await omniRequest('DELETE', `/api/combos/${encodeURIComponent(id)}`); setRevision((value) => value + 1) }
    catch (error) { setResult(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  const test = async (): Promise<void> => {
    if (!activeCombo) return
    setBusy('test'); setResult('')
    try { setResult(formatOmniJson(await omniRequest('POST', '/api/combos/test', { comboName: omniLabel(activeCombo) }))) }
    catch (error) { setResult(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  if (studio) {
    const nodes = Array.isArray(activeCombo?.nodes) ? activeCombo.nodes.filter(isRecord) : []
    return <div className="omni-page"><PageHeader icon="gitBranch" title={tr(language, 'omni.comboStudio')} subtitle={l(language, 'Визуальная проверка каскада и стратегии маршрутизации.', 'Visual routing cascade and strategy check.')} actions={<button className="btn primary" disabled={!activeCombo || busy === 'test'} onClick={() => void test()}><Icon name="play" size={14} />{l(language, 'Тестировать', 'Run test')}</button>} />
      {resource.error && <Notice kind="error">{resource.error}</Notice>}{result && <Notice kind={result.startsWith('{') ? 'info' : 'error'}><pre>{result}</pre></Notice>}
      <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Маршрут', 'Route')}</span><select className="text-input small" value={selectedCombo} onChange={(event) => setSelectedCombo(event.target.value)}>{combos.map((combo) => <option key={omniId(combo)} value={omniId(combo)}>{omniLabel(combo)}</option>)}</select></div>
        {!activeCombo ? <Empty>{l(language, 'Сначала создайте комбо.', 'Create a combo first.')}</Empty> : <div className="omni-flow"><div className="omni-flow-node source"><Icon name="message" size={18} /><strong>{l(language, 'Запрос', 'Request')}</strong><small>{omniText(activeCombo.model)}</small></div><Icon name="arrowRight" size={20} /><div className="omni-flow-stack">{nodes.length ? nodes.map((node, index) => <div className="omni-flow-node" key={`${omniText(node.connectionId)}:${index}`}><Badge tone="blue">{index + 1}</Badge><strong>{providers.find((provider) => omniId(provider) === omniText(node.connectionId)) ? omniLabel(providers.find((provider) => omniId(provider) === omniText(node.connectionId))!) : omniText(node.connectionId, l(language, 'Провайдер', 'Provider'))}</strong><small>{l(language, 'вес', 'weight')} {omniNumber(node.weight, 100)}</small></div>) : <div className="omni-flow-node"><strong>Auto</strong><small>{l(language, 'динамический выбор', 'dynamic selection')}</small></div>}</div><Icon name="arrowRight" size={20} /><div className="omni-flow-node target"><Icon name="check" size={18} /><strong>{l(language, 'Ответ', 'Response')}</strong><small>{omniText(activeCombo.strategy, 'priority')}</small></div></div>}
      </section></div>
  }
  return <div className="omni-page"><PageHeader icon="layers" title={tr(language, 'omni.combos')} subtitle={l(language, 'Надёжные маршруты с fallback между провайдерами.', 'Reliable routes with provider fallback.')} />
    {(resource.error || result) && <Notice kind="error">{resource.error || result}</Notice>}
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Новое комбо', 'New combo')}</span></div><form className="omni-form-grid" onSubmit={(event) => void create(event)}><Field label={l(language, 'Название', 'Name')}><input className="text-input" required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label={l(language, 'Псевдоним модели', 'Model alias')}><input className="text-input" required value={model} onChange={(event) => setModel(event.target.value)} /></Field><Field label={l(language, 'Стратегия', 'Strategy')}><select className="text-input" value={strategy} onChange={(event) => setStrategy(event.target.value)}><option value="priority">Priority / fallback</option><option value="weighted">Weighted</option><option value="round-robin">Round robin</option><option value="cost-optimized">Cost optimized</option><option value="least-used">Least used</option><option value="auto">Auto</option></select></Field><fieldset className="omni-node-picker"><legend>{l(language, 'Узлы', 'Nodes')}</legend>{providers.length === 0 ? <small>{l(language, 'Сначала добавьте провайдеров.', 'Add providers first.')}</small> : providers.map((item) => { const id = omniId(item); return <label key={id}><input type="checkbox" checked={selectedNodes.includes(id)} onChange={(event) => setSelectedNodes((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id))} />{omniLabel(item)}</label> })}</fieldset><div className="omni-form-submit"><button className="btn primary" disabled={busy === 'create'}><Icon name="plus" size={14} />{l(language, 'Создать', 'Create')}</button></div></form></section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Комбо маршрутизации', 'Routing combos')}</span><Badge>{combos.length}</Badge></div>{resource.loading ? <Loading /> : combos.length === 0 ? <Empty>{l(language, 'Комбо пока нет.', 'No combos yet.')}</Empty> : <div className="omni-card-grid">{combos.map((combo) => { const id = omniId(combo); const nodes = Array.isArray(combo.nodes) ? combo.nodes.length : 0; return <article className="omni-combo-card" key={id || omniLabel(combo)}><div className="omni-card-head"><Icon name="layers" size={18} /><div><strong>{omniLabel(combo)}</strong><small>{omniText(combo.model)}</small></div><Badge tone="blue">{omniText(combo.strategy, 'priority')}</Badge></div><div className="omni-combo-meta"><span>{nodes} {l(language, 'узлов', 'nodes')}</span><span>{combo.isActive === false ? l(language, 'выключено', 'disabled') : l(language, 'активно', 'active')}</span></div><div className="omni-card-actions"><button className="btn danger" disabled={!id || busy === id} onClick={() => void remove(id)}><Icon name="trash" size={14} />{l(language, 'Удалить', 'Delete')}</button></div></article> })}</div>}</section>
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

function TrafficPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [sessionName, setSessionName] = useState('')
  const resource = useOmniResource(() => Promise.all([omniRequest<unknown>('GET', '/api/tools/traffic-inspector/requests'), omniRequest<unknown>('GET', '/api/tools/traffic-inspector/capture-modes'), omniRequest<unknown>('GET', '/api/tools/traffic-inspector/sessions')]), [refreshKey, revision])
  const requests = omniList(resource.data?.[0], 'requests', 'data')
  const modes = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const sessions = omniList(resource.data?.[2], 'sessions', 'data')
  const httpProxy = getNestedRecord(modes, 'httpProxy')
  const systemProxy = getNestedRecord(modes, 'systemProxy')
  const tls = getNestedRecord(modes, 'tlsIntercept')
  const selectedRequest = requests.find((request) => omniId(request) === selected)
  const invoke = async (method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> => { setError(''); try { await omniRequest(method, path, body); setRevision((value) => value + 1) } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } }
  const toggleSystemProxy = (): void => { const applied = omniBool(systemProxy.applied); if (!applied && !window.confirm(l(language, 'OmniRoute изменит системные настройки прокси. Продолжить?', 'OmniRoute will change the system proxy settings. Continue?'))) return; void invoke('POST', '/api/tools/traffic-inspector/capture-modes/system-proxy', { action: applied ? 'revert' : 'apply', port: omniNumber(httpProxy.port, 8080), guardMinutes: 30 }) }
  return <div className="omni-page"><PageHeader icon="activity" title={tr(language, 'omni.trafficInspector')} subtitle={l(language, 'Захват, фильтрация и повтор запросов к моделям.', 'Capture, inspect and replay model traffic.')} actions={<button className="btn danger" disabled={requests.length === 0} onClick={() => void invoke('DELETE', '/api/tools/traffic-inspector/requests')}><Icon name="trash" size={14} />{l(language, 'Очистить', 'Clear')}</button>} />{(resource.error || error) && <Notice kind="error">{resource.error || error}</Notice>}
    <section className="omni-mode-grid"><button className={`omni-mode-card${omniBool(httpProxy.running) ? ' active' : ''}`} onClick={() => void invoke('POST', '/api/tools/traffic-inspector/capture-modes/http-proxy', { action: omniBool(httpProxy.running) ? 'stop' : 'start' })}><Icon name="globe" size={18} /><div><strong>HTTP_PROXY</strong><small>{omniBool(httpProxy.running) ? `${l(language, 'порт', 'port')} ${omniNumber(httpProxy.port)}` : l(language, 'выключен', 'stopped')}</small></div><Badge tone={omniBool(httpProxy.running) ? 'good' : 'neutral'}>{omniBool(httpProxy.running) ? 'ON' : 'OFF'}</Badge></button><button className={`omni-mode-card${omniBool(tls.enabled) ? ' active' : ''}`} onClick={() => void invoke('POST', '/api/tools/traffic-inspector/capture-modes/tls-intercept', { enabled: !omniBool(tls.enabled) })}><Icon name="key" size={18} /><div><strong>TLS intercept</strong><small>{l(language, 'Расшифровка тела', 'Body decryption')}</small></div><Badge tone={omniBool(tls.enabled) ? 'good' : 'neutral'}>{omniBool(tls.enabled) ? 'ON' : 'OFF'}</Badge></button><button className={`omni-mode-card${omniBool(systemProxy.applied) ? ' active' : ''}`} onClick={toggleSystemProxy}><Icon name="server" size={18} /><div><strong>{l(language, 'Системный прокси', 'System proxy')}</strong><small>{l(language, 'Настройки ОС', 'OS settings')}</small></div><Badge tone={omniBool(systemProxy.applied) ? 'good' : 'neutral'}>{omniBool(systemProxy.applied) ? 'ON' : 'OFF'}</Badge></button></section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Сессии записи', 'Recording sessions')}</span><Badge>{sessions.length}</Badge></div><form className="omni-inline-form" onSubmit={(event) => { event.preventDefault(); void invoke('POST', '/api/tools/traffic-inspector/sessions', { name: sessionName.trim() || undefined }).then(() => setSessionName('')) }}><input className="text-input" value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder={l(language, 'Название сессии', 'Session name')} /><button className="btn"><Icon name="play" size={14} />{l(language, 'Начать запись', 'Start recording')}</button></form></section>
    <section className="omni-panel"><div className="omni-panel-title"><span>{l(language, 'Запросы', 'Requests')}</span><Badge>{requests.length}</Badge></div>{requests.length === 0 ? <Empty>{l(language, 'Перехваченных запросов пока нет.', 'No captured requests yet.')}</Empty> : <div className="omni-traffic-layout"><div className="omni-table-wrap"><table className="omni-table interactive"><thead><tr><th>{l(language, 'Метод', 'Method')}</th><th>URL</th><th>{l(language, 'Статус', 'Status')}</th><th>{l(language, 'Время', 'Time')}</th></tr></thead><tbody>{requests.map((request) => { const id = omniId(request); const statusCode = omniNumber(request.status ?? request.statusCode); return <tr key={id} className={selected === id ? 'selected' : ''} onClick={() => setSelected(id)}><td><Badge tone="blue">{omniText(request.method, 'POST')}</Badge></td><td className="truncate">{omniText(request.url ?? request.path)}</td><td><Badge tone={statusCode >= 200 && statusCode < 400 ? 'good' : 'bad'}>{statusCode || '—'}</Badge></td><td>{omniNumber(request.durationMs ?? request.duration)} ms</td></tr> })}</tbody></table></div>{selectedRequest && <pre className="omni-request-detail">{formatOmniJson(selectedRequest)}</pre>}</div>}</section>
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
  if (path === '/dashboard/providers') return <ProvidersPage language={language} refreshKey={refreshKey} />
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

  useEffect(() => {
    if (useApp.getState().omnirouteStatus.state === 'stopped') void api.omniroute.start().catch(() => {})
  }, [])

  return (
    <div className="omni-view">
      <div className="omni-toolbar">
        <span className="omni-view-title"><Icon name="route" size={15} /><span>{t('rail.omniroute')}</span></span>
        <div className="omni-tabs" role="tablist">
          {OMNI_PAGES.map((page) => <button className={`omni-tab${path === page.path ? ' active' : ''}`} key={page.path} role="tab" aria-selected={path === page.path} title={t(page.labelKey)} onClick={() => openOmniroutePage(page.path)}><Icon name={page.icon} size={14} /><span>{t(page.labelKey)}</span></button>)}
        </div>
        <span className="omni-toolbar-spacer" />
        <button className="omni-toolbtn" title={t('common.refresh')} aria-label={t('common.refresh')} disabled={status.state !== 'ready'} onClick={() => setReloadKey((key) => key + 1)}><Icon name="refresh" size={14} /></button>
        <button className="omni-toolbtn" title={t('common.close')} aria-label={t('common.close')} onClick={closeOmniroute}><Icon name="close" size={14} /></button>
      </div>
      <div className="omni-host">
        {status.state === 'ready' ? <div className="omni-native-scroll"><NativePage key={`${path}:${reloadKey}`} path={path} language={appLanguage} refreshKey={reloadKey} /></div> : status.state === 'error' ? <div className="omni-state"><Icon name="route" size={26} /><div className="omni-state-title">{t('settings.omnirouteError')}</div>{status.error && <pre className="omni-state-error">{status.error}</pre>}<div className="omni-state-actions"><button className="btn" onClick={() => void api.omniroute.start().catch(() => {})}>{t('settings.omnirouteRetry')}</button>{status.logsPath && <button className="btn" onClick={() => void api.fs.openPath(status.logsPath)}>{t('settings.omnirouteOpenLogs')}</button>}</div></div> : <div className="omni-state"><span className="omni-spinner" aria-hidden="true" /><div className="omni-state-title">{(status.startingForMs ?? 0) > FIRST_BOOT_HINT_MS ? t('settings.omnirouteFirstStart') : t('settings.omnirouteStarting')}</div></div>}
      </div>
    </div>
  )
}
