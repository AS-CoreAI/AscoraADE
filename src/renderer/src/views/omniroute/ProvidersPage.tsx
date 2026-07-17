import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import {
  isRecord,
  omniId,
  omniLabel,
  omniList,
  omniNumber,
  omniOptionalNumber,
  omniRequest,
  omniText,
  type OmniRecord
} from '@/lib/omnirouteApi'
import {
  OMNI_PROVIDER_CATALOG,
  type OmniProviderCatalogEntry,
  type OmniProviderCategory
} from '@/lib/omnirouteProviderCatalog.generated'
import { tr } from '@/language'
import { useApp, type AppLanguage } from '@/state/store'

type ProviderCategory = OmniProviderCategory | 'compatible'
type DisplayMode = 'all' | 'configured' | 'compact'
type CompatibleMode = 'openai' | 'anthropic' | 'cc'

interface ProviderEntry extends Omit<OmniProviderCatalogEntry, 'category'> {
  category: ProviderCategory
  compatible?: boolean
  node?: OmniRecord
}

interface ProviderResource {
  connections: OmniRecord[]
  nodes: OmniRecord[]
  models: OmniRecord[]
}

interface ConnectionDraft {
  id: string
  name: string
  apiKey: string
  tokenSecret: string
  priority: string
  globalPriority: string
  defaultModel: string
  maxConcurrent: string
  isActive: boolean
  baseUrl: string
  region: string
  accountId: string
  cx: string
  providerSpecificJson: string
}

interface CompatibleDraft {
  id: string
  mode: CompatibleMode
  name: string
  prefix: string
  apiType: string
  baseUrl: string
  chatPath: string
  modelsPath: string
  iconUrl: string
}

const CATEGORY_ORDER: ProviderCategory[] = [
  'compatible',
  'oauth',
  'apikey',
  'no-auth',
  'web-cookie',
  'local',
  'search',
  'audio',
  'cloud-agent',
  'upstream-proxy'
]

const CATEGORY_COLORS: Record<ProviderCategory, string> = {
  compatible: '#f97316',
  oauth: '#3b82f6',
  apikey: '#f59e0b',
  'no-auth': '#78716c',
  'web-cookie': '#a855f7',
  local: '#10b981',
  search: '#14b8a6',
  audio: '#f43f5e',
  'upstream-proxy': '#6366f1',
  'cloud-agent': '#8b5cf6'
}

const CAPABILITY_FILTERS = ['all', 'llm', 'image', 'video', 'music', 'tts', 'stt', 'embedding', 'webSearch'] as const
const DEVICE_CODE_PROVIDERS = new Set(['github', 'qwen', 'kiro', 'amazon-q', 'kimi-coding', 'kilocode', 'codebuddy-cn'])
const IMPORT_TOKEN_PROVIDERS = new Set(['windsurf', 'devin-cli', 'grok-cli'])
const SPECIAL_IMPORT_PROVIDERS = new Set(['cursor', 'trae', 'zed'])
const OPTIONAL_CREDENTIAL_PROVIDERS = new Set([
  'searxng-search', 'pollinations', 'copilot-web', 'hackclub', 'huggingchat', 'gitlawb', 'gitlawb-gmi'
])
const CONFIGURABLE_BASE_URL_PROVIDERS = new Set([
  'azure-openai', 'azure-ai', 'bailian-coding-plan', 'xiaomi-mimo', 'siliconflow', 'heroku',
  'databricks', 'snowflake', 'searxng-search', 'petals'
])
const DEFAULT_BASE_URLS: Record<string, string> = {
  'azure-openai': 'https://example-resource.openai.azure.com',
  'azure-ai': 'https://example-resource.services.ai.azure.com/openai/v1',
  'bailian-coding-plan': 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1',
  'xiaomi-mimo': 'https://token-plan-sgp.xiaomimimo.com/v1',
  siliconflow: 'https://api.siliconflow.com/v1',
  'searxng-search': 'http://localhost:8888/search',
  petals: 'https://chat.petals.dev/api/v1/generate'
}

function l(language: AppLanguage, ru: string, en: string): string {
  return language === 'ru' || language === 'uk' ? ru : en
}

function categoryLabel(language: AppLanguage, category: ProviderCategory): string {
  const labels: Record<ProviderCategory, [string, string]> = {
    compatible: ['Совместимые провайдеры', 'Compatible providers'],
    oauth: ['OAuth и IDE', 'OAuth and IDE'],
    apikey: ['Провайдеры с API-ключом', 'API-key providers'],
    'no-auth': ['Без аутентификации', 'No authentication'],
    'web-cookie': ['Веб-сессии и Cookie', 'Web sessions and cookies'],
    local: ['Локальные и self-hosted', 'Local and self-hosted'],
    search: ['Поиск и веб-загрузка', 'Search and web fetch'],
    audio: ['Аудио', 'Audio'],
    'upstream-proxy': ['Вышестоящие прокси', 'Upstream proxies'],
    'cloud-agent': ['Облачные агенты', 'Cloud agents']
  }
  return l(language, ...labels[category])
}

function capabilityLabel(language: AppLanguage, capability: string): string {
  const labels: Record<string, [string, string]> = {
    all: ['Все возможности', 'All capabilities'],
    llm: ['Чат', 'Chat'],
    image: ['Изображения', 'Images'],
    video: ['Видео', 'Video'],
    music: ['Музыка', 'Music'],
    tts: ['Синтез речи', 'Text to speech'],
    stt: ['Распознавание речи', 'Speech to text'],
    embedding: ['Эмбеддинги', 'Embeddings'],
    webSearch: ['Поиск', 'Search']
  }
  return l(language, ...(labels[capability] ?? [capability, capability]))
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }): JSX.Element {
  useEffect(() => {
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div className="omni-provider-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className={`omni-provider-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button type="button" className="omni-icon-button" onClick={onClose}><Icon name="close" size={16} /></button></header>
        <div className="omni-provider-modal-body">{children}</div>
      </section>
    </div>
  )
}

function ProviderLogo({ entry, size = 28 }: { entry: ProviderEntry; size?: number }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const source = entry.logo || omniText(entry.node?.iconUrl)
  const fallback = entry.textIcon || entry.name.slice(0, 2).toUpperCase()
  return (
    <span className="omni-provider-brand" style={{ width: size + 12, height: size + 12, backgroundColor: `${entry.color || '#64748b'}18` }}>
      {source && !failed
        ? <img src={source} alt="" width={size} height={size} onError={() => setFailed(true)} />
        : <span style={{ color: entry.color || '#64748b', fontSize: Math.max(9, Math.round(size * 0.42)) }}>{fallback}</span>}
    </span>
  )
}

function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'bad' | 'blue'; children: ReactNode }): JSX.Element {
  return <span className={`omni-badge ${tone}`}>{children}</span>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return <label className="omni-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }): JSX.Element {
  return <div className={`omni-notice ${kind}`}>{children}</div>
}

function Loading(): JSX.Element {
  return <div className="omni-inline-loading"><span className="omni-spinner" aria-hidden="true" /></div>
}

function connectionTone(connection: OmniRecord): 'neutral' | 'good' | 'bad' | 'blue' {
  if (connection.isActive === false) return 'neutral'
  const status = omniText(connection.testStatus).toLowerCase()
  if (['active', 'healthy', 'success', 'ok'].includes(status)) return 'good'
  if (['error', 'failed', 'expired', 'banned', 'credits_exhausted', 'unavailable'].includes(status)) return 'bad'
  return 'blue'
}

function connectionStatus(language: AppLanguage, connection: OmniRecord): string {
  if (connection.isActive === false) return l(language, 'Отключено', 'Disabled')
  return omniText(connection.testStatus, l(language, 'Не проверено', 'Not tested'))
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function defaultBaseUrl(entry: ProviderEntry): string {
  return entry.localDefault || entry.baseUrl || omniText(entry.node?.baseUrl) || DEFAULT_BASE_URLS[entry.id] || ''
}

function isCredentialOptional(entry: ProviderEntry): boolean {
  return entry.compatible === true || entry.noAuth === true || entry.category === 'local' || entry.category === 'no-auth' || OPTIONAL_CREDENTIAL_PROVIDERS.has(entry.id)
}

function initialConnectionDraft(entry: ProviderEntry, connection?: OmniRecord | null, count = 0): ConnectionDraft {
  const providerData = connection && isRecord(connection.providerSpecificData) ? connection.providerSpecificData : {}
  return {
    id: connection ? omniId(connection) : '',
    name: connection ? omniLabel(connection, '') : count === 0 ? 'main' : `account-${count + 1}`,
    apiKey: '',
    tokenSecret: '',
    priority: connection ? String(omniNumber(connection.priority, 1)) : '1',
    globalPriority: connection && omniOptionalNumber(connection.globalPriority) !== null ? String(connection.globalPriority) : '',
    defaultModel: connection ? omniText(connection.defaultModel) : '',
    maxConcurrent: connection && omniOptionalNumber(connection.maxConcurrent) !== null ? String(connection.maxConcurrent) : '',
    isActive: connection?.isActive !== false,
    baseUrl: omniText(providerData.baseUrl, defaultBaseUrl(entry)),
    region: omniText(providerData.region, entry.id === 'bedrock' ? 'eu-west-2' : 'us-central1'),
    accountId: omniText(providerData.accountId),
    cx: omniText(providerData.cx),
    providerSpecificJson: JSON.stringify(providerData, null, 2)
  }
}

function ConnectionEditor({
  language,
  entry,
  connection,
  connectionCount,
  onClose,
  onSaved
}: {
  language: AppLanguage
  entry: ProviderEntry
  connection?: OmniRecord | null
  connectionCount: number
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [draft, setDraft] = useState(() => initialConnectionDraft(entry, connection, connectionCount))
  const [advanced, setAdvanced] = useState(Boolean(connection))
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null)
  const configurableBaseUrl = entry.compatible || entry.category === 'local' || CONFIGURABLE_BASE_URL_PROVIDERS.has(entry.id)
  const showsRegion = entry.id === 'bedrock' || entry.id === 'vertex' || entry.id === 'vertex-partner'
  const credentialLabel = entry.category === 'web-cookie'
    ? l(language, 'Cookie или токен сессии', 'Cookie or session token')
    : entry.id === 'modal' ? l(language, 'Token ID', 'Token ID') : 'API key'

  const providerSpecificData = (): Record<string, unknown> | undefined => {
    let data: Record<string, unknown> = {}
    if (draft.providerSpecificJson.trim()) {
      const parsed: unknown = JSON.parse(draft.providerSpecificJson)
      if (!isRecord(parsed)) throw new Error(l(language, 'Дополнительные параметры должны быть JSON-объектом.', 'Advanced settings must be a JSON object.'))
      data = { ...parsed }
    }
    if (draft.baseUrl.trim()) data.baseUrl = draft.baseUrl.trim()
    if (showsRegion && draft.region.trim()) data.region = draft.region.trim()
    if (entry.id === 'cloudflare-ai' && draft.accountId.trim()) data.accountId = draft.accountId.trim()
    if (entry.id === 'google-pse-search' && draft.cx.trim()) data.cx = draft.cx.trim()
    return Object.keys(data).length > 0 ? data : undefined
  }

  const credential = (): string => entry.id === 'modal' && draft.apiKey.trim() && draft.tokenSecret.trim()
    ? `${draft.apiKey.trim()}:${draft.tokenSecret.trim()}`
    : draft.apiKey.trim()

  const validate = async (): Promise<void> => {
    setBusy('validate'); setMessage(null)
    try {
      const body: Record<string, unknown> = { provider: entry.id, apiKey: credential() }
      if (draft.baseUrl.trim()) body.baseUrl = draft.baseUrl.trim()
      if (showsRegion) body.region = draft.region.trim()
      if (draft.cx.trim()) body.cx = draft.cx.trim()
      const response = await omniRequest<unknown>('POST', '/api/providers/validate', body)
      const result = isRecord(response) ? response : {}
      const unsupported = result.unsupported === true
      const valid = result.valid === true
      setMessage({
        kind: valid ? 'success' : unsupported ? 'info' : 'error',
        text: valid
          ? l(language, 'Учётные данные работают.', 'Credentials are valid.')
          : unsupported
            ? l(language, 'У провайдера нет отдельной проверки — подключение можно сохранить и протестировать моделью.', 'This provider has no separate validator; save it and test with a model.')
            : omniText(result.error, l(language, 'Проверка не пройдена.', 'Validation failed.'))
      })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy('') }
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy('save'); setMessage(null)
    try {
      const apiKey = credential()
      const data = providerSpecificData()
      if (!connection && !isCredentialOptional(entry) && !apiKey) throw new Error(l(language, 'Введите ключ или учётные данные.', 'Enter an API key or credential.'))
      if (entry.id === 'google-pse-search' && !draft.cx.trim()) throw new Error(l(language, 'Укажите Search Engine ID (cx).', 'Enter the Search Engine ID (cx).'))
      if (entry.id === 'cloudflare-ai' && !draft.accountId.trim()) throw new Error(l(language, 'Укажите Cloudflare Account ID.', 'Enter the Cloudflare Account ID.'))
      const payload: Record<string, unknown> = {
        name: draft.name.trim(),
        priority: Math.max(1, optionalNumber(draft.priority) ?? 1),
        globalPriority: optionalNumber(draft.globalPriority),
        defaultModel: draft.defaultModel.trim() || null,
        providerSpecificData: data
      }
      if (connection) {
        payload.isActive = draft.isActive
        payload.maxConcurrent = optionalNumber(draft.maxConcurrent)
        if (apiKey) payload.apiKey = apiKey
        await omniRequest('PUT', `/api/providers/${encodeURIComponent(omniId(connection))}`, payload)
      } else {
        payload.provider = entry.id
        if (apiKey) payload.apiKey = apiKey
        await omniRequest('POST', '/api/providers', payload)
      }
      onSaved()
      onClose()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
    finally { setBusy('') }
  }

  return (
    <Modal title={connection ? l(language, 'Редактировать подключение', 'Edit connection') : `${l(language, 'Подключить', 'Connect')} ${entry.name}`} onClose={onClose} wide>
      <form className="omni-provider-editor" onSubmit={(event) => void save(event)}>
        {entry.subscriptionRisk && <Notice kind="info">{l(language, 'Этот способ использует пользовательскую подписку или веб-сессию. Проверьте правила поставщика перед использованием.', 'This method uses a consumer subscription or web session. Review the provider terms before use.')}</Notice>}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="omni-form-grid">
          <Field label={l(language, 'Название подключения', 'Connection name')}><input className="text-input" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <Field label={credentialLabel} hint={isCredentialOptional(entry) ? l(language, 'Необязательно для локального сервера.', 'Optional for a local server.') : entry.authHint}>
            <input className="text-input" type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={connection ? l(language, 'Оставьте пустым, чтобы не менять', 'Leave blank to keep current') : ''} />
          </Field>
          {entry.id === 'modal' && <Field label="Token Secret"><input className="text-input" type="password" value={draft.tokenSecret} onChange={(event) => setDraft({ ...draft, tokenSecret: event.target.value })} /></Field>}
          {configurableBaseUrl && <Field label="Base URL"><input className="text-input" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder={defaultBaseUrl(entry)} /></Field>}
          {showsRegion && <Field label={l(language, 'Регион', 'Region')}><input className="text-input" value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></Field>}
          {entry.id === 'cloudflare-ai' && <Field label="Cloudflare Account ID"><input className="text-input" required value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })} /></Field>}
          {entry.id === 'google-pse-search' && <Field label="Search Engine ID (cx)"><input className="text-input" required value={draft.cx} onChange={(event) => setDraft({ ...draft, cx: event.target.value })} /></Field>}
          <Field label={l(language, 'Приоритет', 'Priority')}><input className="text-input" type="number" min="1" max="100" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} /></Field>
          <Field label={l(language, 'Модель по умолчанию', 'Default model')}><input className="text-input" value={draft.defaultModel} onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })} placeholder={l(language, 'Необязательно', 'Optional')} /></Field>
        </div>
        <button className="omni-provider-advanced-toggle" type="button" onClick={() => setAdvanced((value) => !value)}><Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={13} />{l(language, 'Расширенные настройки', 'Advanced settings')}</button>
        {advanced && <div className="omni-provider-advanced">
          <div className="omni-form-grid">
            <Field label={l(language, 'Глобальный приоритет', 'Global priority')}><input className="text-input" type="number" min="1" max="100" value={draft.globalPriority} onChange={(event) => setDraft({ ...draft, globalPriority: event.target.value })} /></Field>
            <Field label={l(language, 'Макс. параллельных запросов', 'Max concurrency')}><input className="text-input" type="number" min="0" value={draft.maxConcurrent} onChange={(event) => setDraft({ ...draft, maxConcurrent: event.target.value })} /></Field>
            {!configurableBaseUrl && <Field label={l(language, 'Переопределить Base URL', 'Override Base URL')}><input className="text-input" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></Field>}
            {connection && <label className="omni-switch omni-switch-field"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /><span />{l(language, 'Подключение активно', 'Connection active')}</label>}
          </div>
          <Field label="providerSpecificData (JSON)" hint={l(language, 'Для специальных параметров провайдера: tags, excludedModels, customUserAgent и других.', 'Provider-specific options such as tags, excludedModels, customUserAgent, and others.')}><textarea className="text-input omni-provider-json" value={draft.providerSpecificJson} onChange={(event) => setDraft({ ...draft, providerSpecificJson: event.target.value })} /></Field>
        </div>}
        <div className="omni-provider-modal-actions">
          <button type="button" className="btn" disabled={busy !== '' || (!draft.apiKey.trim() && !isCredentialOptional(entry))} onClick={() => void validate()}><Icon name="activity" size={14} />{busy === 'validate' ? l(language, 'Проверка…', 'Validating…') : l(language, 'Проверить', 'Validate')}</button>
          <span />
          <button type="button" className="btn" onClick={onClose}>{l(language, 'Отмена', 'Cancel')}</button>
          <button className="btn primary" disabled={busy !== '' || !draft.name.trim()}><Icon name="save" size={14} />{busy === 'save' ? l(language, 'Сохранение…', 'Saving…') : l(language, 'Сохранить', 'Save')}</button>
        </div>
      </form>
    </Modal>
  )
}

function initialCompatibleDraft(mode: CompatibleMode, node?: OmniRecord | null): CompatibleDraft {
  const id = node ? omniId(node) : ''
  const inferredMode: CompatibleMode = id.startsWith('anthropic-compatible-cc-') ? 'cc' : omniText(node?.type) === 'anthropic-compatible' ? 'anthropic' : mode
  return {
    id,
    mode: inferredMode,
    name: node ? omniLabel(node, '') : '',
    prefix: omniText(node?.prefix),
    apiType: omniText(node?.apiType, 'chat'),
    baseUrl: omniText(node?.baseUrl, inferredMode === 'openai' ? 'https://api.openai.com/v1' : inferredMode === 'anthropic' ? 'https://api.anthropic.com/v1' : ''),
    chatPath: omniText(node?.chatPath, inferredMode === 'cc' ? '/v1/messages?beta=true' : ''),
    modelsPath: omniText(node?.modelsPath),
    iconUrl: omniText(node?.iconUrl)
  }
}

function CompatibleEditor({ language, mode, node, onClose, onSaved }: { language: AppLanguage; mode: CompatibleMode; node?: OmniRecord | null; onClose: () => void; onSaved: (node: OmniRecord) => void }): JSX.Element {
  const [draft, setDraft] = useState(() => initialCompatibleDraft(mode, node))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [testKey, setTestKey] = useState('')
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy('save'); setError('')
    try {
      const type = draft.mode === 'openai' ? 'openai-compatible' : 'anthropic-compatible'
      const payload: Record<string, unknown> = {
        name: draft.name.trim(), prefix: draft.prefix.trim(), baseUrl: draft.baseUrl.trim(), type,
        chatPath: draft.chatPath.trim(), modelsPath: draft.mode === 'cc' ? '' : draft.modelsPath.trim(), iconUrl: draft.iconUrl.trim()
      }
      if (draft.mode === 'openai') payload.apiType = draft.apiType
      if (draft.mode === 'cc') payload.compatMode = 'cc'
      const response = await omniRequest<unknown>(node ? 'PUT' : 'POST', node ? `/api/provider-nodes/${encodeURIComponent(omniId(node))}` : '/api/provider-nodes', payload)
      const saved = isRecord(response) && isRecord(response.node) ? response.node : {}
      onSaved(saved); onClose()
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  const validate = async (): Promise<void> => {
    setBusy('validate'); setError('')
    try {
      const type = draft.mode === 'openai' ? 'openai-compatible' : 'anthropic-compatible'
      const response = await omniRequest<unknown>('POST', '/api/provider-nodes/validate', { baseUrl: draft.baseUrl.trim(), apiKey: testKey.trim(), type, modelsPath: draft.modelsPath.trim(), chatPath: draft.chatPath.trim(), ...(draft.mode === 'cc' ? { compatMode: 'cc' } : {}) })
      const body = isRecord(response) ? response : {}
      if (body.valid !== true) throw new Error(omniText(body.error, l(language, 'Проверка не пройдена.', 'Validation failed.')))
      setError(l(language, 'Соединение успешно проверено.', 'Connection validated successfully.'))
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }
  return <Modal title={node ? l(language, 'Изменить совместимого провайдера', 'Edit compatible provider') : l(language, 'Добавить совместимого провайдера', 'Add compatible provider')} onClose={onClose} wide>
    <form className="omni-provider-editor" onSubmit={(event) => void save(event)}>
      {error && <Notice kind={error.includes(l(language, 'успешно', 'successfully')) ? 'success' : 'error'}>{error}</Notice>}
      {!node && <div className="omni-segmented"><button type="button" className={draft.mode === 'openai' ? 'active' : ''} onClick={() => setDraft(initialCompatibleDraft('openai'))}>OpenAI compatible</button><button type="button" className={draft.mode === 'anthropic' ? 'active' : ''} onClick={() => setDraft(initialCompatibleDraft('anthropic'))}>Anthropic compatible</button><button type="button" className={draft.mode === 'cc' ? 'active' : ''} onClick={() => setDraft(initialCompatibleDraft('cc'))}>Claude Code compatible</button></div>}
      <div className="omni-form-grid">
        <Field label={l(language, 'Название', 'Name')}><input className="text-input" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label={l(language, 'Префикс моделей', 'Model prefix')}><input className="text-input" required value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value })} placeholder="my-provider" /></Field>
        {draft.mode === 'openai' && <Field label="API type"><select className="text-input" value={draft.apiType} onChange={(event) => setDraft({ ...draft, apiType: event.target.value })}>{['chat','responses','embeddings','audio-transcriptions','audio-speech','images-generations'].map((value) => <option key={value}>{value}</option>)}</select></Field>}
        <Field label="Base URL"><input className="text-input" required value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></Field>
        <Field label="Chat path"><input className="text-input" value={draft.chatPath} onChange={(event) => setDraft({ ...draft, chatPath: event.target.value })} placeholder={draft.mode === 'openai' ? '/v1/chat/completions' : '/v1/messages'} /></Field>
        {draft.mode !== 'cc' && <Field label="Models path"><input className="text-input" value={draft.modelsPath} onChange={(event) => setDraft({ ...draft, modelsPath: event.target.value })} placeholder="/v1/models" /></Field>}
        <Field label={l(language, 'URL иконки', 'Icon URL')}><input className="text-input" value={draft.iconUrl} onChange={(event) => setDraft({ ...draft, iconUrl: event.target.value })} placeholder="https://…/logo.svg" /></Field>
        <Field label={l(language, 'Ключ для проверки', 'Validation key')}><input className="text-input" type="password" value={testKey} onChange={(event) => setTestKey(event.target.value)} /></Field>
      </div>
      <div className="omni-provider-modal-actions"><button type="button" className="btn" disabled={busy !== '' || !draft.baseUrl.trim()} onClick={() => void validate()}><Icon name="activity" size={14} />{l(language, 'Проверить', 'Validate')}</button><span /><button type="button" className="btn" onClick={onClose}>{l(language, 'Отмена', 'Cancel')}</button><button className="btn primary" disabled={busy !== '' || !draft.name.trim() || !draft.prefix.trim() || !draft.baseUrl.trim()}><Icon name="save" size={14} />{l(language, 'Сохранить', 'Save')}</button></div>
    </form>
  </Modal>
}

function OAuthEditor({ language, entry, onClose, onSaved }: { language: AppLanguage; entry: ProviderEntry; onClose: () => void; onSaved: () => void }): JSX.Element {
  const status = useApp((state) => state.omnirouteStatus)
  const timer = useRef<number | null>(null)
  const closed = useRef(false)
  const [phase, setPhase] = useState<'starting' | 'manual' | 'device' | 'token' | 'success' | 'error'>('starting')
  const [authData, setAuthData] = useState<OmniRecord>({})
  const [deviceData, setDeviceData] = useState<OmniRecord>({})
  const [callback, setCallback] = useState('')
  const [token, setToken] = useState('')
  const [importFields, setImportFields] = useState({
    machineId: '',
    webId: '',
    bizUserId: '',
    userUniqueId: '',
    scope: 'marscode-us',
    tenant: 'marscode',
    region: 'US-East',
    manualProvider: 'openai'
  })
  const [importHint, setImportHint] = useState('')
  const [zedCandidates, setZedCandidates] = useState<OmniRecord[]>([])
  const [selectedZedCandidates, setSelectedZedCandidates] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const complete = (): void => { if (!closed.current) { setPhase('success'); onSaved() } }
  const pollDevice = (data: OmniRecord): void => {
    const poll = async (): Promise<void> => {
      if (closed.current) return
      try {
        const response = await omniRequest<unknown>('POST', `/api/oauth/${encodeURIComponent(entry.id)}/poll`, {
          deviceCode: omniText(data.device_code), codeVerifier: omniText(data.codeVerifier),
          extraData: entry.id === 'kiro' || entry.id === 'amazon-q' ? { _clientId: data._clientId, _clientSecret: data._clientSecret, _region: data._region } : null
        })
        const body = isRecord(response) ? response : {}
        if (closed.current) return
        if (body.success === true) { complete(); return }
        if (['expired_token', 'access_denied'].includes(omniText(body.error))) throw new Error(omniText(body.errorDescription ?? body.error))
        timer.current = window.setTimeout(() => void poll(), Math.max(2, omniNumber(data.interval, 5)) * 1000)
      } catch (caught) { if (!closed.current) { setError(caught instanceof Error ? caught.message : String(caught)); setPhase('error') } }
    }
    timer.current = window.setTimeout(() => void poll(), Math.max(2, omniNumber(data.interval, 5)) * 1000)
  }
  const pollCallback = (): void => {
    const poll = async (): Promise<void> => {
      if (closed.current) return
      try {
        const response = await omniRequest<unknown>('POST', `/api/oauth/${encodeURIComponent(entry.id)}/poll-callback`, {})
        const body = isRecord(response) ? response : {}
        if (closed.current) return
        if (body.success === true) { complete(); return }
        if (body.error && body.pending !== true) throw new Error(omniText(body.errorDescription ?? body.error))
        timer.current = window.setTimeout(() => void poll(), 2000)
      } catch (caught) { if (!closed.current) { setError(caught instanceof Error ? caught.message : String(caught)); setPhase('error') } }
    }
    timer.current = window.setTimeout(() => void poll(), 2000)
  }
  const start = async (): Promise<void> => {
    setError(''); setPhase('starting')
    try {
      if (IMPORT_TOKEN_PROVIDERS.has(entry.id) || SPECIAL_IMPORT_PROVIDERS.has(entry.id)) {
        setPhase('token')
        if (entry.id === 'cursor') {
          setImportHint(l(language, 'Ищу токен в локальной базе Cursor…', 'Looking for a token in the local Cursor database…'))
          try {
            const response = await omniRequest<unknown>('GET', '/api/oauth/cursor/auto-import')
            if (closed.current) return
            const data = isRecord(response) ? response : {}
            if (data.found === true) {
              setToken(omniText(data.accessToken))
              setImportFields((current) => ({ ...current, machineId: omniText(data.machineId) }))
              setImportHint(l(language, 'Учётные данные Cursor найдены автоматически.', 'Cursor credentials were detected automatically.'))
            } else setImportHint(omniText(data.error, l(language, 'Cursor не найден — токен можно вставить вручную.', 'Cursor was not detected; you can paste the token manually.')))
          } catch (caught) { setImportHint(caught instanceof Error ? caught.message : String(caught)) }
        }
        return
      }
      if (DEVICE_CODE_PROVIDERS.has(entry.id)) {
        const response = await omniRequest<unknown>('GET', `/api/oauth/${encodeURIComponent(entry.id)}/device-code`)
        if (closed.current) return
        const data = isRecord(response) ? response : {}
        setDeviceData(data); setPhase('device')
        const url = omniText(data.verification_uri_complete ?? data.verification_uri)
        if (url) void api.live.openExternal(url)
        pollDevice(data)
        return
      }
      if (entry.id === 'codex') {
        const response = await omniRequest<unknown>('GET', '/api/oauth/codex/start-callback-server')
        if (closed.current) return
        const data = isRecord(response) ? response : {}
        setAuthData(data); setPhase('manual')
        const url = omniText(data.authUrl)
        if (url) void api.live.openExternal(url)
        pollCallback()
        return
      }
      const port = status.port ?? 20128
      const host = entry.id === 'agy' || entry.id === 'antigravity' ? '127.0.0.1' : 'localhost'
      const redirectUri = `http://${host}:${port}/callback`
      const response = await omniRequest<unknown>('GET', `/api/oauth/${encodeURIComponent(entry.id)}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`)
      if (closed.current) return
      const data = isRecord(response) ? response : {}
      const url = omniText(data.authUrl)
      if (!url) throw new Error(omniText(data.error, l(language, 'OAuth недоступен для этого провайдера.', 'OAuth is unavailable for this provider.')))
      setAuthData({ ...data, redirectUri: omniText(data.redirectUri, redirectUri) }); setPhase('manual')
      void api.live.openExternal(url)
    } catch (caught) { if (!closed.current) { setError(caught instanceof Error ? caught.message : String(caught)); setPhase('error') } }
  }
  useEffect(() => {
    closed.current = false
    const launch = window.setTimeout(() => void start(), 0)
    return () => {
      closed.current = true
      window.clearTimeout(launch)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const exchange = async (): Promise<void> => {
    setError('')
    try {
      const value = callback.trim()
      let code = ''
      let state = omniText(authData.state)
      try { const parsed = new URL(value); code = parsed.searchParams.get('code') || ''; state = parsed.searchParams.get('state') || state }
      catch { const parts = value.split('#', 2); code = parts[0]; state = parts[1] || state }
      if (!code) throw new Error(l(language, 'В callback не найден код авторизации.', 'No authorization code was found in the callback.'))
      await omniRequest('POST', `/api/oauth/${encodeURIComponent(entry.id)}/exchange`, { code, state: state || undefined, redirectUri: omniText(authData.redirectUri), codeVerifier: omniText(authData.codeVerifier) })
      complete()
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setPhase('error') }
  }
  const importToken = async (): Promise<void> => {
    setError('')
    try {
      if (entry.id === 'cursor') {
        await omniRequest('POST', '/api/oauth/cursor/import', { accessToken: token.trim(), machineId: importFields.machineId.trim() || undefined })
      } else if (entry.id === 'trae') {
        await omniRequest('POST', '/api/oauth/trae/import', {
          accessToken: token.trim(),
          webId: importFields.webId.trim() || undefined,
          bizUserId: importFields.bizUserId.trim() || undefined,
          userUniqueId: importFields.userUniqueId.trim() || undefined,
          scope: importFields.scope.trim() || undefined,
          tenant: importFields.tenant.trim() || undefined,
          region: importFields.region.trim() || undefined
        })
      } else if (entry.id === 'zed') {
        await omniRequest('POST', '/api/providers/zed/manual-import', { provider: importFields.manualProvider, token: token.trim() })
      } else {
        await omniRequest('POST', `/api/oauth/${encodeURIComponent(entry.id)}/import-token`, { token: token.trim() })
      }
      complete()
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setPhase('error') }
  }
  const discoverZed = async (): Promise<void> => {
    setError(''); setImportHint(l(language, 'Читаю системное хранилище Zed…', 'Reading the Zed system keychain…'))
    try {
      const response = await omniRequest<unknown>('POST', '/api/providers/zed/discover', {})
      const candidates = omniList(response, 'candidates')
      setZedCandidates(candidates)
      setSelectedZedCandidates(new Set(candidates.map((item) => omniText(item.fingerprint)).filter(Boolean)))
      setImportHint(candidates.length > 0
        ? l(language, `Найдено учётных данных: ${candidates.length}. Выберите записи и подтвердите импорт.`, `${candidates.length} credentials found. Select entries and confirm the import.`)
        : l(language, 'Поддерживаемые учётные данные Zed не найдены.', 'No supported Zed credentials were found.'))
    } catch (caught) { setImportHint(''); setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  const importZedCandidates = async (): Promise<void> => {
    setError('')
    try {
      const confirmedAccounts = zedCandidates.filter((item) => selectedZedCandidates.has(omniText(item.fingerprint))).map((item) => ({ service: omniText(item.service), account: omniText(item.account), fingerprint: omniText(item.fingerprint) }))
      await omniRequest('POST', '/api/providers/zed/import', { confirmedAccounts })
      complete()
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setPhase('error') }
  }
  return <Modal title={`${l(language, 'Вход в', 'Sign in to')} ${entry.name}`} onClose={onClose}>
    <div className="omni-oauth-flow">
      {phase === 'starting' && <Loading />}
      {phase === 'device' && <><Notice>{l(language, 'Открыта страница входа. Введите показанный код и не закрывайте это окно.', 'The sign-in page has opened. Enter the code shown below and keep this window open.')}</Notice><strong className="omni-device-code">{omniText(deviceData.user_code)}</strong><code>{omniText(deviceData.verification_uri_complete ?? deviceData.verification_uri)}</code><span className="omni-inline-loading"><span className="omni-spinner" />{l(language, 'Ожидание авторизации…', 'Waiting for authorization…')}</span></>}
      {phase === 'manual' && <><Notice>{l(language, 'Завершите вход в браузере. Если окно не закрылось автоматически, скопируйте полный callback URL из адресной строки и вставьте ниже.', 'Finish signing in in the browser. If it does not complete automatically, copy the full callback URL from the address bar and paste it below.')}</Notice><Field label="Callback URL / code"><textarea className="text-input" value={callback} onChange={(event) => setCallback(event.target.value)} /></Field><button type="button" className="btn primary" disabled={!callback.trim()} onClick={() => void exchange()}>{l(language, 'Завершить подключение', 'Complete connection')}</button></>}
      {phase === 'token' && <>
        <Notice>{entry.id === 'cursor'
          ? l(language, 'Ascora может взять токен из установленного Cursor или принять его вручную.', 'Ascora can read the token from an installed Cursor or accept it manually.')
          : entry.id === 'trae'
            ? l(language, 'Войдите на solo.trae.ai и скопируйте JWT из заголовка Authorization: Cloud-IDE-JWT.', 'Sign in at solo.trae.ai and copy the JWT from the Authorization: Cloud-IDE-JWT header.')
            : entry.id === 'zed'
              ? l(language, 'Импортируйте ключи из системного хранилища Zed или вставьте один ключ вручную.', 'Import keys from the Zed system keychain or paste one key manually.')
              : l(language, 'Этот провайдер подключается импортом токена.', 'This provider connects by importing a token.')}</Notice>
        {error && <Notice kind="error">{error}</Notice>}
        {importHint && <Notice kind="info">{importHint}</Notice>}
        {entry.id === 'trae' && <button type="button" className="btn" onClick={() => void api.live.openExternal('https://solo.trae.ai/')}><Icon name="external" size={14} />solo.trae.ai</button>}
        {entry.id === 'zed' && <>
          <button type="button" className="btn" onClick={() => void discoverZed()}><Icon name="search" size={14} />{l(language, 'Найти ключи в Zed', 'Discover Zed credentials')}</button>
          {zedCandidates.length > 0 && <div className="omni-zed-candidates">{zedCandidates.map((item) => { const fingerprint = omniText(item.fingerprint); return <label key={fingerprint}><input type="checkbox" checked={selectedZedCandidates.has(fingerprint)} onChange={(event) => setSelectedZedCandidates((current) => { const next = new Set(current); if (event.target.checked) next.add(fingerprint); else next.delete(fingerprint); return next })} /><span><strong>{omniText(item.provider)}</strong><small>{omniText(item.service)} · {omniText(item.account)}</small></span></label> })}<button type="button" className="btn primary" disabled={selectedZedCandidates.size === 0} onClick={() => void importZedCandidates()}>{l(language, 'Импортировать выбранные', 'Import selected')}</button></div>}
        </>}
        <Field label={entry.id === 'trae' ? 'Cloud-IDE-JWT' : 'Token'}><input className="text-input" type="password" value={token} onChange={(event) => setToken(event.target.value)} /></Field>
        {entry.id === 'cursor' && <Field label="Machine ID" hint={l(language, 'Необязательно для cursor-agent.', 'Optional for cursor-agent.')}><input className="text-input" value={importFields.machineId} onChange={(event) => setImportFields({ ...importFields, machineId: event.target.value })} /></Field>}
        {entry.id === 'trae' && <div className="omni-form-grid"><Field label="Web ID"><input className="text-input" value={importFields.webId} onChange={(event) => setImportFields({ ...importFields, webId: event.target.value })} /></Field><Field label="Biz User ID"><input className="text-input" value={importFields.bizUserId} onChange={(event) => setImportFields({ ...importFields, bizUserId: event.target.value })} /></Field><Field label="User Unique ID"><input className="text-input" value={importFields.userUniqueId} onChange={(event) => setImportFields({ ...importFields, userUniqueId: event.target.value })} /></Field><Field label="Scope"><input className="text-input" value={importFields.scope} onChange={(event) => setImportFields({ ...importFields, scope: event.target.value })} /></Field><Field label="Tenant"><input className="text-input" value={importFields.tenant} onChange={(event) => setImportFields({ ...importFields, tenant: event.target.value })} /></Field><Field label="Region"><input className="text-input" value={importFields.region} onChange={(event) => setImportFields({ ...importFields, region: event.target.value })} /></Field></div>}
        {entry.id === 'zed' && <Field label={l(language, 'Провайдер ручного ключа', 'Provider for manual key')}><select className="text-input" value={importFields.manualProvider} onChange={(event) => setImportFields({ ...importFields, manualProvider: event.target.value })}>{['openai','anthropic','google','mistral','xai','openrouter','deepseek'].map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>}
        <button type="button" className="btn primary" disabled={!token.trim()} onClick={() => void importToken()}>{l(language, 'Импортировать токен', 'Import token')}</button>
      </>}
      {phase === 'success' && <div className="omni-provider-success"><Icon name="check" size={28} /><strong>{l(language, 'Провайдер подключён', 'Provider connected')}</strong><button type="button" className="btn primary" onClick={onClose}>{l(language, 'Готово', 'Done')}</button></div>}
      {phase === 'error' && <><Notice kind="error">{error}</Notice><button type="button" className="btn" onClick={() => void start()}><Icon name="refresh" size={14} />{l(language, 'Повторить', 'Try again')}</button>{authData.authUrl && <button type="button" className="btn" onClick={() => void api.live.openExternal(omniText(authData.authUrl))}>{l(language, 'Открыть страницу входа', 'Open sign-in page')}</button>}</>}
    </div>
  </Modal>
}

function CommandCodeEditor({ language, onClose, onSaved }: { language: AppLanguage; onClose: () => void; onSaved: () => void }): JSX.Element {
  const timer = useRef<number | null>(null)
  const activeRun = useRef(0)
  const [phase, setPhase] = useState<'starting' | 'waiting' | 'success' | 'error'>('starting')
  const [session, setSession] = useState<OmniRecord>({})
  const [error, setError] = useState('')

  useEffect(() => () => {
    activeRun.current += 1
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const apply = async (state: string, status: OmniRecord, run: number): Promise<void> => {
    await omniRequest('POST', '/api/providers/command-code/auth/apply', {
      state,
      connectionId: omniText(status.connectionId) || undefined,
      name: omniText(status.name) || undefined,
      setDefault: status.setDefault === true
    })
    if (activeRun.current !== run) return
    setPhase('success')
    onSaved()
  }

  const poll = (data: OmniRecord, run: number): void => {
    const state = omniText(data.state)
    const deadline = new Date(omniText(data.expiresAt)).getTime() || Date.now() + 180_000
    const check = async (): Promise<void> => {
      if (activeRun.current !== run) return
      if (Date.now() >= deadline) { setError(l(language, 'Ссылка авторизации истекла.', 'The authorization link expired.')); setPhase('error'); return }
      try {
        const response = await omniRequest<unknown>('GET', `/api/providers/command-code/auth/status?state=${encodeURIComponent(state)}`)
        const status = isRecord(response) ? response : {}
        const value = omniText(status.status ?? status.state ?? status.phase).toLowerCase()
        if (value === 'received') { await apply(state, status, run); return }
        if (value === 'applied') { if (activeRun.current === run) { setPhase('success'); onSaved() }; return }
        if (value === 'expired') { setError(l(language, 'Ссылка авторизации истекла.', 'The authorization link expired.')); setPhase('error'); return }
      } catch {
        // A transient poll failure is retried until the short-lived session expires.
      }
      if (activeRun.current === run) timer.current = window.setTimeout(() => void check(), 2000)
    }
    timer.current = window.setTimeout(() => void check(), 1000)
  }

  const start = async (): Promise<void> => {
    const run = activeRun.current + 1
    activeRun.current = run
    if (timer.current !== null) window.clearTimeout(timer.current)
    setPhase('starting'); setError('')
    try {
      const response = await omniRequest<unknown>('POST', '/api/providers/command-code/auth/start', {})
      const data = isRecord(response) ? response : {}
      if (activeRun.current !== run) return
      const authUrl = omniText(data.authUrl)
      if (!authUrl || !omniText(data.state)) throw new Error(l(language, 'Не удалось запустить авторизацию Command Code.', 'Could not start Command Code authorization.'))
      setSession(data); setPhase('waiting')
      void api.live.openExternal(authUrl)
      poll(data, run)
    } catch (caught) { if (activeRun.current === run) { setError(caught instanceof Error ? caught.message : String(caught)); setPhase('error') } }
  }

  useEffect(() => {
    const launch = window.setTimeout(() => void start(), 0)
    return () => window.clearTimeout(launch)
  }, [])

  return <Modal title={l(language, 'Подключить Command Code', 'Connect Command Code')} onClose={onClose}>
    <div className="omni-oauth-flow">
      {phase === 'starting' && <Loading />}
      {phase === 'waiting' && <><Notice>{l(language, 'В браузере открыта Command Code Studio. Подтвердите доступ — подключение появится автоматически.', 'Command Code Studio opened in your browser. Approve access and the connection will appear automatically.')}</Notice><div className="omni-inline-loading"><span className="omni-spinner" />{l(language, 'Ожидание подтверждения…', 'Waiting for approval…')}</div><button type="button" className="btn" onClick={() => void api.live.openExternal(omniText(session.authUrl))}><Icon name="external" size={14} />{l(language, 'Открыть снова', 'Open again')}</button>{session.callbackUrl && <code className="omni-command-code-callback">{omniText(session.callbackUrl)}</code>}</>}
      {phase === 'success' && <div className="omni-provider-success"><Icon name="check" size={28} /><strong>{l(language, 'Command Code подключён', 'Command Code connected')}</strong><button type="button" className="btn primary" onClick={onClose}>{l(language, 'Готово', 'Done')}</button></div>}
      {phase === 'error' && <><Notice kind="error">{error}</Notice><button type="button" className="btn" onClick={() => void start()}><Icon name="refresh" size={14} />{l(language, 'Повторить', 'Try again')}</button></>}
    </div>
  </Modal>
}

export function ProvidersPage({ language, refreshKey }: { language: AppLanguage; refreshKey: number }): JSX.Element {
  const openOmniroutePage = useApp((state) => state.openOmniroutePage)
  const [revision, setRevision] = useState(0)
  const [resource, setResource] = useState<{ data: ProviderResource | null; loading: boolean; error: string }>({ data: null, loading: true, error: '' })
  const [query, setQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('all')
  const [category, setCategory] = useState<ProviderCategory | 'all'>('all')
  const [capability, setCapability] = useState<(typeof CAPABILITY_FILTERS)[number]>('all')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set())
  const [connectionEditor, setConnectionEditor] = useState<{ entry: ProviderEntry; connection?: OmniRecord | null } | null>(null)
  const [compatibleEditor, setCompatibleEditor] = useState<{ mode: CompatibleMode; node?: OmniRecord | null } | null>(null)
  const [oauthEntry, setOauthEntry] = useState<ProviderEntry | null>(null)
  const [commandCodeOpen, setCommandCodeOpen] = useState(false)
  const [selectedModels, setSelectedModels] = useState<OmniRecord[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    setResource((current) => ({ ...current, loading: current.data === null, error: '' }))
    void Promise.all([
      omniRequest<unknown>('GET', '/api/providers'),
      omniRequest<unknown>('GET', '/api/provider-nodes'),
      omniRequest<unknown>('GET', '/api/v1/models')
    ]).then(([connectionsBody, nodesBody, modelsBody]) => {
      if (!alive) return
      setResource({ data: { connections: omniList(connectionsBody, 'connections', 'providers', 'data'), nodes: omniList(nodesBody, 'nodes', 'data'), models: omniList(modelsBody, 'data', 'models') }, loading: false, error: '' })
    }, (error: unknown) => alive && setResource({ data: null, loading: false, error: error instanceof Error ? error.message : String(error) }))
    return () => { alive = false }
  }, [refreshKey, revision])

  const connections = resource.data?.connections ?? []
  const entries = useMemo<ProviderEntry[]>(() => {
    const compatible = (resource.data?.nodes ?? []).map((node): ProviderEntry => {
      const id = omniId(node)
      const cc = id.startsWith('anthropic-compatible-cc-')
      const anthropic = omniText(node.type) === 'anthropic-compatible'
      return {
        id,
        name: omniLabel(node),
        category: 'compatible',
        color: cc ? '#b45309' : anthropic ? '#d97757' : '#10a37f',
        textIcon: cc ? 'CC' : anthropic ? 'AC' : 'OC',
        apiType: omniText(node.apiType),
        baseUrl: omniText(node.baseUrl),
        serviceKinds: [omniText(node.apiType, 'llm')],
        compatible: true,
        node
      }
    })
    return [...compatible, ...OMNI_PROVIDER_CATALOG]
  }, [resource.data?.nodes])

  const connectionsByProvider = useMemo(() => {
    const map = new Map<string, OmniRecord[]>()
    for (const connection of connections) {
      const provider = omniText(connection.provider)
      map.set(provider, [...(map.get(provider) ?? []), connection])
    }
    return map
  }, [connections])

  const modelIndex = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const model of resource.data?.models ?? []) {
      const id = omniText(model.id)
      const owners = new Set<string>()
      const ownedBy = omniText(model.owned_by ?? model.provider)
      if (ownedBy) owners.add(ownedBy)
      if (id.includes('/')) owners.add(id.split('/')[0])
      if (Array.isArray(model.providers)) for (const provider of model.providers) if (typeof provider === 'string') owners.add(provider)
      for (const owner of owners) map.set(owner, [...(map.get(owner) ?? []), id])
    }
    return map
  }, [resource.data?.models])

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const providerConnections = connectionsByProvider.get(entry.id) ?? []
    if (displayMode === 'configured' && providerConnections.length === 0) return false
    if (displayMode === 'compact' && providerConnections.length === 0 && entry.category !== 'no-auth') return false
    if (category !== 'all' && entry.category !== category) return false
    if (capability !== 'all' && !entry.serviceKinds.includes(capability)) return false
    const needle = query.trim().toLowerCase()
    if (needle && !`${entry.name} ${entry.id} ${entry.authHint ?? ''} ${entry.apiHint ?? ''}`.toLowerCase().includes(needle)) return false
    const modelNeedle = modelQuery.trim().toLowerCase()
    if (modelNeedle && !(modelIndex.get(entry.id) ?? []).some((model) => model.toLowerCase().includes(modelNeedle))) return false
    return true
  }), [capability, category, connectionsByProvider, displayMode, entries, modelIndex, modelQuery, query])

  const selectedEntry = entries.find((entry) => entry.id === selectedProviderId) ?? null
  const selectedConnections = selectedEntry ? connectionsByProvider.get(selectedEntry.id) ?? [] : []

  useEffect(() => {
    if (!selectedEntry) { setSelectedModels([]); return }
    let alive = true
    setModelsLoading(true)
    void omniRequest<unknown>('GET', `/api/v1/providers/${encodeURIComponent(selectedEntry.id)}/models`).then(
      (body) => alive && setSelectedModels(omniList(body, 'data', 'models')),
      () => alive && setSelectedModels((resource.data?.models ?? []).filter((model) => omniText(model.owned_by ?? model.provider) === selectedEntry.id || omniText(model.id).startsWith(`${selectedEntry.id}/`)))
    ).finally(() => { if (alive) setModelsLoading(false) })
    return () => { alive = false }
  }, [selectedEntry?.id, revision])

  const reload = (text?: string): void => {
    if (text) setMessage({ kind: 'success', text })
    setRevision((value) => value + 1)
  }

  const perform = async (key: string, run: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key); setMessage(null)
    try { await run(); reload(success); return true }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) }); return false }
    finally { setBusy('') }
  }

  const openConnection = (entry: ProviderEntry, connection?: OmniRecord | null): void => {
    if (entry.id === 'command-code' && !connection) { setCommandCodeOpen(true); return }
    if (entry.category === 'oauth' && !connection) { setOauthEntry(entry); return }
    if (entry.category === 'upstream-proxy') { openOmniroutePage('/dashboard/cli-code'); return }
    if (entry.category === 'no-auth' && !connection) { setMessage({ kind: 'info', text: l(language, 'Этот провайдер работает без подключения и уже доступен для маршрутизации.', 'This provider needs no connection and is already available for routing.') }); return }
    setConnectionEditor({ entry, connection })
  }

  const deleteConnection = async (connection: OmniRecord): Promise<void> => {
    if (!window.confirm(l(language, `Удалить подключение «${omniLabel(connection)}»?`, `Delete connection “${omniLabel(connection)}”?`))) return
    await perform(`delete:${omniId(connection)}`, () => omniRequest('DELETE', `/api/providers/${encodeURIComponent(omniId(connection))}`), l(language, 'Подключение удалено.', 'Connection deleted.'))
  }

  const bulkUpdate = async (action: 'enable' | 'disable' | 'delete'): Promise<void> => {
    const ids = [...selectedConnectionIds]
    if (ids.length === 0) return
    if (action === 'delete' && !window.confirm(l(language, `Удалить подключений: ${ids.length}?`, `Delete ${ids.length} connections?`))) return
    const completed = await perform(`bulk:${action}`, async () => {
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100)
        await (action === 'delete'
          ? omniRequest('DELETE', '/api/providers', { ids: batch })
          : omniRequest('PATCH', '/api/providers', { ids: batch, isActive: action === 'enable' }))
      }
    }, l(language, 'Групповая операция выполнена.', 'Bulk action completed.'))
    if (completed) setSelectedConnectionIds(new Set())
  }

  const deleteNode = async (entry: ProviderEntry): Promise<void> => {
    if (!window.confirm(l(language, `Удалить «${entry.name}» и все его подключения?`, `Delete “${entry.name}” and all of its connections?`))) return
    const deleted = await perform(`node-delete:${entry.id}`, () => omniRequest('DELETE', `/api/provider-nodes/${encodeURIComponent(entry.id)}`), l(language, 'Совместимый провайдер удалён.', 'Compatible provider deleted.'))
    if (deleted) setSelectedProviderId('')
  }

  const categoryCounts = useMemo(() => Object.fromEntries(CATEGORY_ORDER.map((item) => {
    const categoryEntries = entries.filter((entry) => entry.category === item)
    const configured = categoryEntries.filter((entry) => (connectionsByProvider.get(entry.id) ?? []).length > 0).length
    return [item, { total: categoryEntries.length, configured }]
  })) as Record<ProviderCategory, { total: number; configured: number }>, [connectionsByProvider, entries])

  return <div className="omni-page omni-providers-page">
    <header className="omni-page-head"><div className="omni-page-heading"><span className="omni-page-icon"><Icon name="server" size={19} /></span><div><h1>{tr(language, 'omni.providers')}</h1><p>{l(language, 'Полный каталог провайдеров, подключения, модели и проверка учётных данных.', 'Full provider catalog, connections, models, and credential health.')}</p></div></div><div className="omni-page-actions"><button type="button" className="btn" disabled={busy === 'test-all' || connections.length === 0} onClick={() => void perform('test-all', () => omniRequest('POST', '/api/providers/test-batch', { mode: 'all', providerId: null }), l(language, 'Проверка всех подключений завершена.', 'All connections tested.'))}><Icon name="activity" size={14} />{l(language, 'Проверить все', 'Test all')}</button><button type="button" className="btn primary" onClick={() => setCompatibleEditor({ mode: 'openai' })}><Icon name="plus" size={14} />{l(language, 'Совместимый', 'Compatible')}</button></div></header>
    {resource.error && <Notice kind="error">{resource.error}</Notice>}
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {connections.length === 0 && !resource.loading && <section className="omni-provider-onboarding"><ProviderLogo entry={OMNI_PROVIDER_CATALOG.find((item) => item.id === 'openai') as ProviderEntry} size={34} /><div><strong>{l(language, 'Добавьте первого провайдера', 'Add your first provider')}</strong><p>{l(language, 'Выберите тип в каталоге. Ascora проведёт через API-ключ, локальный сервер, веб-сессию или OAuth.', 'Choose a type from the catalog. Ascora will guide you through API key, local server, web session, or OAuth setup.')}</p></div></section>}
    <section className="omni-provider-toolbar">
      <div className="omni-provider-searches"><label><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l(language, 'Поиск провайдеров…', 'Search providers…')} /></label><label><Icon name="sparkles" size={14} /><input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={l(language, 'Поиск по модели…', 'Search by model…')} /></label></div>
      <div className="omni-segmented" role="radiogroup" aria-label={l(language, 'Режим отображения', 'Display mode')}>{(['all','configured','compact'] as DisplayMode[]).map((mode) => <button type="button" key={mode} className={displayMode === mode ? 'active' : ''} onClick={() => setDisplayMode(mode)}>{mode === 'all' ? l(language, 'Все', 'All') : mode === 'configured' ? l(language, 'Настроенные', 'Configured') : l(language, 'Компактно', 'Compact')}</button>)}</div>
      <div className="omni-provider-filter-row"><button type="button" className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>{l(language, 'Итого', 'Total')} <small>{connections.length}/{entries.length}</small></button>{CATEGORY_ORDER.map((item) => categoryCounts[item].total > 0 && <button type="button" key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}><i style={{ backgroundColor: CATEGORY_COLORS[item] }} />{categoryLabel(language, item)} <small>{categoryCounts[item].configured}/{categoryCounts[item].total}</small></button>)}</div>
      <div className="omni-provider-capability-row"><span>{l(language, 'Возможности', 'Capabilities')}</span>{CAPABILITY_FILTERS.map((item) => <button type="button" key={item} className={capability === item ? 'active' : ''} onClick={() => setCapability(item)}>{capabilityLabel(language, item)}</button>)}</div>
    </section>
    {resource.loading ? <Loading /> : <div className={`omni-provider-browser${selectedEntry ? ' has-detail' : ''}`}>
      <main className="omni-provider-catalog">
        <div className="omni-provider-catalog-summary"><strong>{filteredEntries.length}</strong><span>{l(language, 'провайдеров найдено', 'providers found')}</span>{(query || modelQuery || category !== 'all' || capability !== 'all') && <button type="button" onClick={() => { setQuery(''); setModelQuery(''); setCategory('all'); setCapability('all') }}>{l(language, 'Сбросить фильтры', 'Clear filters')}</button>}</div>
        {filteredEntries.length === 0 ? <div className="omni-empty"><Icon name="search" size={20} />{l(language, 'Ничего не найдено.', 'Nothing found.')}</div> : CATEGORY_ORDER.map((group) => {
          const groupEntries = filteredEntries.filter((entry) => entry.category === group)
          if (groupEntries.length === 0) return null
          return <section className="omni-provider-group" key={group}><header><span><i style={{ backgroundColor: CATEGORY_COLORS[group] }} />{categoryLabel(language, group)}</span><Badge>{groupEntries.length}</Badge></header><div className="omni-provider-grid">{groupEntries.map((entry) => {
            const items = connectionsByProvider.get(entry.id) ?? []
            const active = items.filter((item) => item.isActive !== false).length
            const errors = items.filter((item) => connectionTone(item) === 'bad').length
            return <button type="button" className={`omni-provider-catalog-card${selectedProviderId === entry.id ? ' selected' : ''}${entry.deprecated ? ' deprecated' : ''}`} key={entry.id} onClick={() => { setSelectedProviderId(entry.id); setSelectedConnectionIds(new Set()) }}><div className="omni-provider-card-identity"><ProviderLogo entry={entry} /><strong title={entry.name}>{entry.name}</strong><i style={{ backgroundColor: CATEGORY_COLORS[entry.category] }} /></div>{entry.serviceKinds.length > 0 && <div className="omni-provider-kinds">{entry.serviceKinds.slice(0, 4).map((kind) => <span key={kind}>{capabilityLabel(language, kind)}</span>)}</div>}<div className="omni-provider-card-status">{items.length === 0 ? <span>{entry.category === 'no-auth' ? l(language, 'Готов без настройки', 'Ready without setup') : l(language, 'Нет подключений', 'No connections')}</span> : <><Badge tone={active > 0 ? 'good' : 'neutral'}>{active}/{items.length}</Badge>{errors > 0 && <Badge tone="bad">{errors} errors</Badge>}</>}<Icon name="chevronRight" size={13} /></div></button>
          })}</div></section>
        })}
      </main>
      {selectedEntry && <aside className="omni-provider-detail">
        <header className="omni-provider-detail-head"><ProviderLogo entry={selectedEntry} size={34} /><div><h2>{selectedEntry.name}</h2><code>{selectedEntry.id}</code></div><button type="button" className="omni-icon-button" onClick={() => setSelectedProviderId('')}><Icon name="close" size={15} /></button></header>
        <div className="omni-provider-detail-actions"><button type="button" className="btn primary" onClick={() => openConnection(selectedEntry)}>{selectedEntry.category === 'oauth' ? <Icon name="external" size={14} /> : <Icon name="plus" size={14} />}{selectedEntry.category === 'oauth' ? l(language, 'Войти', 'Sign in') : selectedEntry.category === 'no-auth' ? l(language, 'Уже доступен', 'Already available') : selectedEntry.category === 'upstream-proxy' ? l(language, 'Открыть CLI', 'Open CLI') : l(language, 'Добавить подключение', 'Add connection')}</button><button type="button" className="btn" disabled={busy === `test-provider:${selectedEntry.id}`} onClick={() => void perform(`test-provider:${selectedEntry.id}`, () => omniRequest('POST', '/api/providers/test-batch', { mode: 'provider', providerId: selectedEntry.id }), l(language, 'Проверка провайдера завершена.', 'Provider test completed.'))}><Icon name="activity" size={14} />{l(language, 'Тест', 'Test')}</button>{selectedEntry.website && <button type="button" className="omni-icon-button" title={selectedEntry.website} onClick={() => void api.live.openExternal(selectedEntry.website!)}><Icon name="external" size={14} /></button>}</div>
        {(selectedEntry.authHint || selectedEntry.freeNote || selectedEntry.deprecated) && <div className="omni-provider-description">{selectedEntry.deprecated && <Badge tone="bad">{l(language, 'Устарел', 'Deprecated')}</Badge>}<p>{selectedEntry.deprecationReason || selectedEntry.authHint || selectedEntry.freeNote}</p>{selectedEntry.freeNote && selectedEntry.authHint && <small>{selectedEntry.freeNote}</small>}</div>}
        {selectedEntry.compatible && <div className="omni-provider-node-actions"><button type="button" className="btn" onClick={() => setCompatibleEditor({ mode: 'openai', node: selectedEntry.node })}><Icon name="settings" size={13} />{l(language, 'Настроить узел', 'Edit node')}</button><button type="button" className="btn danger" disabled={busy === `node-delete:${selectedEntry.id}`} onClick={() => void deleteNode(selectedEntry)}><Icon name="trash" size={13} />{l(language, 'Удалить узел', 'Delete node')}</button></div>}
        <section className="omni-provider-detail-section"><div className="omni-panel-title"><span>{l(language, 'Подключения', 'Connections')}</span><Badge>{selectedConnections.length}</Badge>{selectedConnections.length > 0 && <label className="omni-provider-select-all"><input type="checkbox" checked={selectedConnectionIds.size === selectedConnections.length} onChange={(event) => setSelectedConnectionIds(event.target.checked ? new Set(selectedConnections.map(omniId)) : new Set())} />{l(language, 'Все', 'All')}</label>}</div>
          {selectedConnectionIds.size > 0 && <div className="omni-provider-bulk"><span>{l(language, 'Выбрано', 'Selected')}: {selectedConnectionIds.size}</span><button type="button" onClick={() => void bulkUpdate('enable')}>{l(language, 'Включить', 'Enable')}</button><button type="button" onClick={() => void bulkUpdate('disable')}>{l(language, 'Отключить', 'Disable')}</button><button type="button" className="danger" onClick={() => void bulkUpdate('delete')}>{l(language, 'Удалить', 'Delete')}</button></div>}
          {selectedConnections.length === 0 ? <div className="omni-provider-detail-empty">{selectedEntry.category === 'no-auth' ? l(language, 'Учётные данные не требуются.', 'No credentials required.') : l(language, 'Подключений пока нет.', 'No connections yet.')}</div> : <div className="omni-provider-connections">{selectedConnections.map((connection) => <article key={omniId(connection)}><input type="checkbox" checked={selectedConnectionIds.has(omniId(connection))} onChange={(event) => setSelectedConnectionIds((current) => { const next = new Set(current); if (event.target.checked) next.add(omniId(connection)); else next.delete(omniId(connection)); return next })} /><div><strong>{omniLabel(connection)}</strong><small>{omniText(connection.authType, 'apikey')} · priority {omniNumber(connection.priority, 1)}</small>{Boolean(connection.lastError) && <em>{omniText(connection.lastError)}</em>}</div><Badge tone={connectionTone(connection)}>{connectionStatus(language, connection)}</Badge><div className="omni-row-actions"><button type="button" className="omni-icon-button" title={l(language, 'Проверить', 'Test')} onClick={() => void perform(`test:${omniId(connection)}`, () => omniRequest('POST', `/api/providers/${encodeURIComponent(omniId(connection))}/test`), l(language, 'Проверка завершена.', 'Test completed.'))}><Icon name="activity" size={13} /></button><button type="button" className="omni-icon-button" title={l(language, 'Синхронизировать модели', 'Sync models')} onClick={() => void perform(`sync:${omniId(connection)}`, () => omniRequest('POST', `/api/providers/${encodeURIComponent(omniId(connection))}/sync-models?mode=sync`), l(language, 'Модели синхронизированы.', 'Models synced.'))}><Icon name="refresh" size={13} /></button><button type="button" className="omni-icon-button" title={l(language, 'Редактировать', 'Edit')} onClick={() => openConnection(selectedEntry, connection)}><Icon name="settings" size={13} /></button><button type="button" className="omni-icon-button danger" title={l(language, 'Удалить', 'Delete')} onClick={() => void deleteConnection(connection)}><Icon name="trash" size={13} /></button></div></article>)}</div>}
        </section>
        <section className="omni-provider-detail-section"><div className="omni-panel-title"><span>{l(language, 'Модели', 'Models')}</span><Badge>{selectedModels.length}</Badge>{selectedConnections[0] && <button type="button" className="btn" onClick={() => void perform(`sync:${omniId(selectedConnections[0])}`, () => omniRequest('POST', `/api/providers/${encodeURIComponent(omniId(selectedConnections[0]))}/sync-models?mode=sync`), l(language, 'Модели синхронизированы.', 'Models synced.'))}><Icon name="refresh" size={12} />Sync</button>}</div>{modelsLoading ? <Loading /> : selectedModels.length === 0 ? <div className="omni-provider-detail-empty">{l(language, 'Модели не найдены.', 'No models found.')}</div> : <div className="omni-provider-model-list">{selectedModels.slice(0, 160).map((model) => <span key={omniText(model.id)} title={omniText(model.id)}>{omniText(model.id)}</span>)}</div>}</section>
      </aside>}
    </div>}
    {connectionEditor && <ConnectionEditor language={language} entry={connectionEditor.entry} connection={connectionEditor.connection} connectionCount={(connectionsByProvider.get(connectionEditor.entry.id) ?? []).length} onClose={() => setConnectionEditor(null)} onSaved={() => reload(l(language, 'Подключение сохранено.', 'Connection saved.'))} />}
    {compatibleEditor && <CompatibleEditor language={language} mode={compatibleEditor.mode} node={compatibleEditor.node} onClose={() => setCompatibleEditor(null)} onSaved={(node) => { reload(l(language, 'Совместимый провайдер сохранён.', 'Compatible provider saved.')); const id = omniId(node); if (id) setSelectedProviderId(id) }} />}
    {oauthEntry && <OAuthEditor language={language} entry={oauthEntry} onClose={() => setOauthEntry(null)} onSaved={() => reload(l(language, 'OAuth-подключение сохранено.', 'OAuth connection saved.'))} />}
    {commandCodeOpen && <CommandCodeEditor language={language} onClose={() => setCommandCodeOpen(false)} onSaved={() => reload(l(language, 'Command Code подключён.', 'Command Code connected.'))} />}
  </div>
}
