import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import type { AppLanguage } from '../../state/store'
import {
  formatOmniDate,
  isRecord,
  omniBool,
  omniList,
  omniNumber,
  omniRequest,
  omniStringList,
  omniText,
  type OmniRecord
} from '../../lib/omnirouteApi'

type AgenticPageProps = {
  path: string
  language: AppLanguage
  refreshKey: number
}

type AgenticResource = {
  data: unknown[] | null
  loading: boolean
  error: string | null
}

const pageMeta: Record<
  string,
  { title: string; titleEn: string; subtitle: string; subtitleEn: string; icon: IconName; accent: string }
> = {
  memory: {
    title: 'Память',
    titleEn: 'Memory',
    subtitle: 'Долговременная память и состояние поискового движка',
    subtitleEn: 'Persistent memory and retrieval engine health',
    icon: 'bulb',
    accent: '#10B981'
  },
  'agent-skills': {
    title: 'Навыки агента',
    titleEn: 'Agent skills',
    subtitle: 'Реестр навыков и покрытие инструментов агента',
    subtitleEn: 'Agent skill registry and tool coverage',
    icon: 'gitBranch',
    accent: '#D946EF'
  },
  chaos: {
    title: 'Chaos Mode',
    titleEn: 'Chaos Mode',
    subtitle: 'Параллельное выполнение запросов несколькими моделями',
    subtitleEn: 'Multi-model parallel execution',
    icon: 'sparkles',
    accent: '#E03ED8'
  },
  'omni-skills': {
    title: 'Омнискиллс',
    titleEn: 'Omni Skills',
    subtitle: 'Навыки песочницы и каталог готовых интеграций',
    subtitleEn: 'Sandbox skills and integration catalog',
    icon: 'flask',
    accent: '#F43F5E'
  },
  mcp: {
    title: 'MCP',
    titleEn: 'MCP',
    subtitle: 'Состояние MCP-сервера, инструменты и активность',
    subtitleEn: 'MCP server health, tools, and activity',
    icon: 'layers',
    accent: '#8B5CF6'
  },
  a2a: {
    title: 'A2A',
    titleEn: 'A2A',
    subtitle: 'Сервер протокола Agent-to-Agent и его задачи',
    subtitleEn: 'Agent-to-Agent protocol server and tasks',
    icon: 'route',
    accent: '#06B6D4'
  },
  plugins: {
    title: 'Плагины',
    titleEn: 'Plugins',
    subtitle: 'Установленные расширения и каталог плагинов',
    subtitleEn: 'Installed extensions and plugin marketplace',
    icon: 'plug',
    accent: '#BFE03E'
  }
}

function l(language: AppLanguage, ru: string, en: string): string {
  return language === 'ru' || language === 'uk' ? ru : en
}

function formatCount(value: number, language: AppLanguage): string {
  return new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US').format(value)
}

function nestedRecord(value: unknown, key: string): OmniRecord {
  if (!isRecord(value)) return {}
  return isRecord(value[key]) ? value[key] : {}
}

function useAgenticResource(refreshKey: number, paths: string[]): AgenticResource {
  const [resource, setResource] = useState<AgenticResource>({ data: null, loading: true, error: null })
  const pathKey = paths.join('|')

  useEffect(() => {
    let cancelled = false
    setResource((current) => ({ ...current, loading: true, error: null }))
    Promise.all(paths.map((path) => omniRequest('GET', path)))
      .then((data) => {
        if (!cancelled) setResource({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResource({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
    // pathKey makes the route set an explicit dependency without recreating the request on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, pathKey])

  return resource
}

function AgenticHeader({
  page,
  language,
  children
}: {
  page: keyof typeof pageMeta
  language: AppLanguage
  children?: ReactNode
}): ReactNode {
  const meta = pageMeta[page]
  return (
    <header
      className="omni-page-head omni-agentic-page-head"
      style={{ '--agentic-accent': meta.accent } as CSSProperties}
    >
      <div className="omni-page-heading">
        <span className="omni-page-icon omni-agentic-page-icon">
          <Icon name={meta.icon} size={20} />
        </span>
        <div>
          <h1>{l(language, meta.title, meta.titleEn)}</h1>
          <p>{l(language, meta.subtitle, meta.subtitleEn)}</p>
        </div>
      </div>
      {children ? <div className="omni-page-actions">{children}</div> : null}
    </header>
  )
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return <span className={`omni-badge ${tone === 'neutral' ? '' : tone}`.trim()}>{children}</span>
}

function Loading({ language }: { language: AppLanguage }) {
  return (
    <div className="omni-inline-loading">
      <span className="omni-spinner small" /> {l(language, 'Загружаем данные…', 'Loading data…')}
    </div>
  )
}

function ErrorNotice({ error, language }: { error: string | null; language: AppLanguage }) {
  if (!error) return null
  return (
    <div className="omni-notice error">
      <Icon name="info" size={17} />
      <div>
        <strong>{l(language, 'Не удалось получить данные', 'Could not load data')}</strong>
        <span>{error}</span>
      </div>
    </div>
  )
}

function Empty({ icon = 'archive', title, detail }: { icon?: IconName; title: string; detail: string }) {
  return (
    <div className="omni-empty omni-agentic-empty">
      <Icon name={icon} size={24} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <article className="omni-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  )
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="omni-agentic-search">
      <Icon name="search" size={16} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

function SwitchControl({
  checked,
  disabled,
  label,
  onChange,
  testId
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
  testId: string
}) {
  return (
    <label className={`omni-agentic-switch${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="omni-agentic-switch-track" aria-hidden="true"><span /></span>
      <strong>{label}</strong>
    </label>
  )
}

function AgenticModal({
  title,
  subtitle,
  language,
  wide = false,
  onClose,
  children,
  footer
}: {
  title: string
  subtitle?: string
  language: AppLanguage
  wide?: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="omni-agentic-modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className={`omni-agentic-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button className="omni-icon-button" type="button" aria-label={l(language, 'Закрыть', 'Close')} title={l(language, 'Закрыть', 'Close')} onClick={onClose}><Icon name="close" size={16} /></button>
        </header>
        <div className="omni-agentic-modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </section>
    </div>
  )
}

function EngineCard({
  icon,
  title,
  available,
  detail,
  language
}: {
  icon: IconName
  title: string
  available: boolean
  detail: string
  language: AppLanguage
}) {
  return (
    <article className="omni-agentic-engine-card">
      <span className="omni-agentic-card-icon"><Icon name={icon} size={18} /></span>
      <div>
        <div className="omni-agentic-card-title">
          <strong>{title}</strong>
          <Badge tone={available ? 'good' : 'neutral'}>{available ? l(language, 'Доступно', 'Available') : l(language, 'Неактивно', 'Inactive')}</Badge>
        </div>
        <p>{detail}</p>
      </div>
    </article>
  )
}

function MemoryPage({ language, refreshKey }: Omit<AgenticPageProps, 'path'>) {
  const [revision, setRevision] = useState(0)
  const [savingEnabled, setSavingEnabled] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [memoryKey, setMemoryKey] = useState('')
  const [memoryType, setMemoryType] = useState<'factual' | 'episodic' | 'procedural' | 'semantic'>('factual')
  const [memoryContent, setMemoryContent] = useState('')
  const resource = useAgenticResource(refreshKey + revision, ['/api/memory', '/api/memory/engine-status', '/api/settings/memory'])
  const memory = isRecord(resource.data?.[0]) ? resource.data[0] : {}
  const engine = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const settingsRoot = isRecord(resource.data?.[2]) ? resource.data[2] : {}
  const settings = isRecord(settingsRoot.settings) ? settingsRoot.settings : settingsRoot
  const enabled = omniBool(settings.enabled)
  const stats = nestedRecord(memory, 'stats')
  const entries = omniList(memory, 'data', 'memories', 'items')
  const total = omniNumber(memory.total, entries.length)
  const hitRateValue = omniNumber(stats.hitRate)
  const hitRate = hitRateValue <= 1 ? hitRateValue * 100 : hitRateValue
  const keyword = nestedRecord(engine, 'keyword')
  const embedding = nestedRecord(engine, 'embedding')
  const vectorStore = nestedRecord(engine, 'vectorStore')
  const rerank = nestedRecord(engine, 'rerank')

  const setMemoryEnabled = async (nextEnabled: boolean) => {
    setSavingEnabled(true)
    setActionError(null)
    setSuccess(null)
    try {
      await omniRequest('PUT', '/api/settings/memory', { enabled: nextEnabled })
      setSuccess(nextEnabled ? l(language, 'Память включена.', 'Memory enabled.') : l(language, 'Память выключена.', 'Memory disabled.'))
      setRevision((value) => value + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingEnabled(false)
    }
  }

  const createMemory = async (event: FormEvent) => {
    event.preventDefault()
    if (!memoryKey.trim() || !memoryContent.trim()) return
    setCreating(true)
    setActionError(null)
    setSuccess(null)
    try {
      await omniRequest('POST', '/api/memory', {
        key: memoryKey.trim(),
        type: memoryType,
        content: memoryContent.trim()
      })
      setMemoryKey('')
      setMemoryType('factual')
      setMemoryContent('')
      setCreateOpen(false)
      setSuccess(l(language, 'Запись памяти создана.', 'Memory entry created.'))
      setRevision((value) => value + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="omni-page omni-agentic-page">
      <AgenticHeader page="memory" language={language}>
        <Badge tone={omniBool(keyword.available) ? 'good' : 'warn'}>{omniText(keyword.backend, 'FTS')}</Badge>
        <SwitchControl checked={enabled} disabled={resource.loading || savingEnabled} label={enabled ? l(language, 'Память включена', 'Memory on') : l(language, 'Память выключена', 'Memory off')} onChange={(checked) => void setMemoryEnabled(checked)} testId="memory-enabled-switch" />
        <button className="btn primary omni-agentic-add-button" type="button" onClick={() => { setActionError(null); setCreateOpen(true) }}><Icon name="plus" size={14} />{l(language, 'Добавить запись', 'Add entry')}</button>
      </AgenticHeader>
      <ErrorNotice error={resource.error} language={language} />
      <ErrorNotice error={actionError} language={language} />
      {success ? <div className="omni-notice success"><Icon name="check" size={17} /><div><strong>{success}</strong></div></div> : null}
      {!resource.loading && !enabled ? <div className="omni-notice info"><Icon name="info" size={17} /><div><strong>{l(language, 'Автоматическая память отключена', 'Automatic memory is disabled')}</strong><span>{l(language, 'Сохранённые записи останутся доступны, но не будут добавляться в контекст запросов до включения памяти.', 'Saved entries remain available, but will not be injected into request context until memory is enabled.')}</span></div></div> : null}
      {resource.loading && !resource.data ? <Loading language={language} /> : (
        <>
          <section className="omni-stat-grid">
            <Metric label={l(language, 'Записей', 'Entries')} value={formatCount(total, language)} />
            <Metric label={l(language, 'Использовано токенов', 'Tokens used')} value={formatCount(omniNumber(stats.tokensUsed), language)} />
            <Metric label={l(language, 'Доля попаданий', 'Hit rate')} value={`${Math.round(hitRate)}%`} />
            <Metric label={l(language, 'Векторный индекс', 'Vector index')} value={omniNumber(vectorStore.rowCount)} note={omniText(vectorStore.backend, 'none')} />
          </section>
          <section className="omni-panel">
            <div className="omni-panel-title">
              <div><strong>{l(language, 'Поисковый движок', 'Retrieval engine')}</strong><span>{l(language, 'Компоненты, участвующие в поиске по памяти', 'Components used for memory retrieval')}</span></div>
            </div>
            <div className="omni-agentic-engine-grid">
              <EngineCard icon="search" title={l(language, 'Ключевой поиск', 'Keyword search')} available={omniBool(keyword.available)} detail={omniText(keyword.backend, l(language, 'Не настроен', 'Not configured'))} language={language} />
              <EngineCard icon="bulb" title={l(language, 'Эмбеддинги', 'Embeddings')} available={omniBool(embedding.available)} detail={omniText(embedding.model, omniText(embedding.reason, l(language, 'Источник не выбран', 'No source selected')))} language={language} />
              <EngineCard icon="layers" title={l(language, 'Векторное хранилище', 'Vector store')} available={omniBool(vectorStore.available)} detail={omniText(vectorStore.backend, omniText(vectorStore.reason, 'none'))} language={language} />
              <EngineCard icon="sliders" title={l(language, 'Реранжирование', 'Reranking')} available={omniBool(rerank.available)} detail={omniText(rerank.model, omniText(rerank.reason, l(language, 'Отключено', 'Disabled')))} language={language} />
            </div>
          </section>
          <section className="omni-panel">
            <div className="omni-panel-title">
              <div><strong>{l(language, 'Последние записи', 'Recent entries')}</strong><span>{l(language, 'Долговременный контекст, доступный агентам', 'Persistent context available to agents')}</span></div>
              <button className="btn" type="button" onClick={() => { setActionError(null); setCreateOpen(true) }}><Icon name="plus" size={13} />{l(language, 'Добавить', 'Add')}</button>
            </div>
            {entries.length === 0 ? (
              <Empty icon="archive" title={l(language, 'Память пока пуста', 'Memory is empty')} detail={l(language, 'Записи появятся после использования функций памяти.', 'Entries will appear after memory features are used.')} />
            ) : (
              <div className="omni-agentic-list">
                {entries.slice(0, 20).map((entry, index) => (
                  <article className="omni-agentic-list-row" key={omniText(entry.id, String(index))}>
                    <span className="omni-agentic-card-icon"><Icon name="message" size={17} /></span>
                    <div><strong>{omniText(entry.key, omniText(entry.title, l(language, 'Запись памяти', 'Memory entry')))}</strong><p>{omniText(entry.summary, omniText(entry.content, omniText(entry.text, '—')))}</p></div>
                    <div className="omni-agentic-row-end"><Badge>{omniText(entry.type, 'factual')}</Badge><small>{formatOmniDate(omniText(entry.updatedAt, omniText(entry.createdAt)), language)}</small></div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {createOpen ? (
        <AgenticModal title={l(language, 'Новая запись памяти', 'New memory entry')} subtitle={l(language, 'Добавьте постоянный контекст, который сможет использовать агент.', 'Add persistent context that the agent can use.')} language={language} onClose={() => !creating && setCreateOpen(false)} footer={<><button className="btn" type="button" disabled={creating} onClick={() => setCreateOpen(false)}>{l(language, 'Отмена', 'Cancel')}</button><button className="btn primary" type="submit" form="omni-memory-create-form" disabled={creating || !memoryKey.trim() || !memoryContent.trim()}>{creating ? <span className="omni-spinner small" /> : <Icon name="plus" size={14} />}{l(language, 'Создать запись', 'Create entry')}</button></>}>
          <form id="omni-memory-create-form" className="omni-agentic-memory-form" onSubmit={(event) => void createMemory(event)}>
            <label className="omni-field"><span>{l(language, 'Ключ записи', 'Entry key')}</span><input className="text-input" autoFocus value={memoryKey} onChange={(event) => setMemoryKey(event.target.value)} placeholder={l(language, 'Например: preference:code-style', 'For example: preference:code-style')} required /><small>{l(language, 'Стабильный уникальный ключ для обновления и поиска записи.', 'A stable unique key used to update and find this entry.')}</small></label>
            <label className="omni-field"><span>{l(language, 'Тип памяти', 'Memory type')}</span><select className="text-input" value={memoryType} onChange={(event) => setMemoryType(event.target.value as typeof memoryType)}><option value="factual">{l(language, 'Фактическая', 'Factual')}</option><option value="episodic">{l(language, 'Эпизодическая', 'Episodic')}</option><option value="procedural">{l(language, 'Процедурная', 'Procedural')}</option><option value="semantic">{l(language, 'Семантическая', 'Semantic')}</option></select></label>
            <label className="omni-field omni-agentic-memory-content"><span>{l(language, 'Содержимое', 'Content')}</span><textarea className="omni-textarea" value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} placeholder={l(language, 'Что агент должен запомнить?', 'What should the agent remember?')} rows={8} required /><small>{l(language, 'Не добавляйте сюда пароли, API-ключи и другие секреты.', 'Do not store passwords, API keys, or other secrets here.')}</small></label>
          </form>
        </AgenticModal>
      ) : null}
    </div>
  )
}

function AgentSkillsPage({ language, refreshKey }: Omit<AgenticPageProps, 'path'>) {
  const resource = useAgenticResource(refreshKey, ['/api/agent-skills', '/api/agent-skills/coverage'])
  const root = isRecord(resource.data?.[0]) ? resource.data[0] : {}
  const coverage = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const skills = omniList(root, 'skills', 'data')
  const api = nestedRecord(coverage, 'api')
  const cli = nestedRecord(coverage, 'cli')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | 'api' | 'cli'>('all')
  const [selectedSkill, setSelectedSkill] = useState<OmniRecord | null>(null)
  const [skillDetail, setSkillDetail] = useState<OmniRecord | null>(null)
  const [skillMarkdown, setSkillMarkdown] = useState('')
  const [skillSource, setSkillSource] = useState('')
  const [skillLoading, setSkillLoading] = useState(false)
  const [skillError, setSkillError] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return skills.filter((skill) => {
      const skillCategory = omniText(skill.category).toLocaleLowerCase()
      const matchesCategory = category === 'all' || skillCategory === category
      const haystack = `${omniText(skill.name)} ${omniText(skill.description)} ${omniText(skill.area)}`.toLocaleLowerCase()
      return matchesCategory && (!needle || haystack.includes(needle))
    })
  }, [category, query, skills])

  const openSkill = async (skill: OmniRecord) => {
    const id = omniText(skill.id)
    setSelectedSkill(skill)
    setSkillDetail(null)
    setSkillMarkdown('')
    setSkillSource('')
    setSkillError(null)
    setSkillLoading(true)
    const [detailResult, markdownResult] = await Promise.allSettled([
      omniRequest('GET', `/api/agent-skills/${encodeURIComponent(id)}`),
      omniRequest('GET', `/api/agent-skills/${encodeURIComponent(id)}/raw`)
    ])
    if (detailResult.status === 'fulfilled') {
      const response = detailResult.value
      if (isRecord(response)) setSkillDetail(isRecord(response.skill) ? response.skill : response)
    }
    if (markdownResult.status === 'fulfilled') {
      if (typeof markdownResult.value === 'string') {
        setSkillMarkdown(markdownResult.value)
        setSkillSource('SKILL.md')
      } else if (isRecord(markdownResult.value)) {
        setSkillMarkdown(omniText(markdownResult.value.body))
        setSkillSource(omniText(markdownResult.value.source))
      }
    } else if (markdownResult.status === 'rejected') {
      setSkillError(markdownResult.reason instanceof Error ? markdownResult.reason.message : String(markdownResult.reason))
    }
    if (detailResult.status === 'rejected' && markdownResult.status === 'rejected') {
      setSkillError(detailResult.reason instanceof Error ? detailResult.reason.message : String(detailResult.reason))
    }
    setSkillLoading(false)
  }

  const visibleSkill = skillDetail ?? selectedSkill
  const visibleEndpoints = visibleSkill ? omniStringList(visibleSkill.endpoints) : []
  const visibleCommands = visibleSkill ? omniStringList(visibleSkill.cliCommands) : []

  return (
    <div className="omni-page omni-agentic-page">
      <AgenticHeader page="agent-skills" language={language}><Badge>{formatCount(skills.length, language)} skills</Badge></AgenticHeader>
      <ErrorNotice error={resource.error} language={language} />
      {resource.loading && !resource.data ? <Loading language={language} /> : (
        <>
          <section className="omni-stat-grid">
            <Metric label={l(language, 'Всего навыков', 'Total skills')} value={formatCount(skills.length, language)} />
            <Metric label="API" value={`${omniNumber(api.have)} / ${omniNumber(api.total)}`} />
            <Metric label="CLI" value={`${omniNumber(cli.have)} / ${omniNumber(cli.total)}`} />
            <Metric label={l(language, 'Сгенерировано', 'Generated')} value={formatCount(omniNumber(coverage.totalSkills), language)} />
          </section>
          <section className="omni-panel">
            <div className="omni-agentic-toolbar">
              <SearchField value={query} onChange={setQuery} placeholder={l(language, 'Найти навык…', 'Find a skill…')} />
              <div className="omni-agentic-segments">
                {(['all', 'api', 'cli'] as const).map((item) => <button className={category === item ? 'active' : ''} key={item} onClick={() => setCategory(item)}>{item === 'all' ? l(language, 'Все', 'All') : item.toUpperCase()}</button>)}
              </div>
            </div>
            {filtered.length === 0 ? (
              <Empty icon="search" title={l(language, 'Ничего не найдено', 'No matching skills')} detail={l(language, 'Измените запрос или фильтр категории.', 'Change the query or category filter.')} />
            ) : (
              <div className="omni-agentic-card-grid">
                {filtered.map((skill, index) => {
                  const endpoints = omniStringList(skill.endpoints)
                  const commands = omniStringList(skill.cliCommands)
                  return (
                    <article className="omni-agentic-card" key={omniText(skill.id, `${omniText(skill.name)}-${index}`)}>
                      <header><span className="omni-agentic-card-icon"><Icon name={omniText(skill.category) === 'cli' ? 'terminal' : 'route'} size={18} /></span><div><strong>{omniText(skill.name, omniText(skill.id, 'Skill'))}</strong><small>{omniText(skill.area, omniText(skill.category, 'agent'))}</small></div>{omniBool(skill.isNew) ? <Badge tone="good">New</Badge> : null}</header>
                      <p>{omniText(skill.description, l(language, 'Описание не указано.', 'No description provided.'))}</p>
                      <footer><Badge>{omniText(skill.category, 'skill').toUpperCase()}</Badge>{endpoints.length > 0 ? <span>{endpoints.length} endpoints</span> : null}{commands.length > 0 ? <span>{commands.length} commands</span> : null}<button className="omni-agentic-view-button" type="button" onClick={() => void openSkill(skill)}><Icon name="external" size={12} />{l(language, 'Посмотреть', 'View')}</button></footer>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
      {selectedSkill ? (
        <AgenticModal wide title={omniText(visibleSkill?.name, omniText(selectedSkill.id, 'Skill'))} subtitle={omniText(visibleSkill?.description, l(language, 'Описание навыка', 'Skill details'))} language={language} onClose={() => setSelectedSkill(null)}>
          <div className="omni-agentic-skill-modal-head">
            <div className="omni-agentic-skill-meta"><Badge>{omniText(visibleSkill?.category, 'skill').toUpperCase()}</Badge><Badge>{omniText(visibleSkill?.area, 'agent')}</Badge>{skillSource ? <Badge tone="good">{skillSource}</Badge> : null}</div>
            <code>{omniText(visibleSkill?.id, omniText(selectedSkill.id))}</code>
          </div>
          {(visibleEndpoints.length > 0 || visibleCommands.length > 0) ? <div className="omni-agentic-skill-contracts">{visibleEndpoints.length > 0 ? <section><strong>{l(language, 'API-методы', 'API endpoints')}</strong><div>{visibleEndpoints.map((endpoint) => <code key={endpoint}>{endpoint}</code>)}</div></section> : null}{visibleCommands.length > 0 ? <section><strong>{l(language, 'CLI-команды', 'CLI commands')}</strong><div>{visibleCommands.map((command) => <code key={command}>{command}</code>)}</div></section> : null}</div> : null}
          <section className="omni-agentic-skill-document">
            <div><strong>SKILL.md</strong>{skillLoading ? <span className="omni-spinner small" /> : null}</div>
            {skillError ? <div className="omni-notice error"><Icon name="info" size={16} /><span>{skillError}</span></div> : null}
            {skillMarkdown ? <pre>{skillMarkdown}</pre> : !skillLoading && !skillError ? <Empty icon="file" title={l(language, 'Текст навыка недоступен', 'Skill document unavailable')} detail={l(language, 'Для этого навыка не найден файл SKILL.md.', 'No SKILL.md file was found for this skill.')} /> : null}
          </section>
        </AgenticModal>
      ) : null}
    </div>
  )
}

function ChaosPage({ language, refreshKey }: Omit<AgenticPageProps, 'path'>) {
  const resource = useAgenticResource(refreshKey, ['/api/chaos/config'])
  const root = isRecord(resource.data?.[0]) ? resource.data[0] : {}
  const config = isRecord(root.config) ? root.config : root
  const enabled = omniBool(config.enabled)
  const overrides = Array.isArray(config.providerOverrides) ? config.providerOverrides.filter(isRecord) : []

  return (
    <div className="omni-page omni-agentic-page">
      <AgenticHeader page="chaos" language={language}><Badge tone={enabled ? 'good' : 'neutral'}>{enabled ? l(language, 'Включён', 'Enabled') : l(language, 'Выключен', 'Disabled')}</Badge></AgenticHeader>
      <ErrorNotice error={resource.error} language={language} />
      {resource.loading && !resource.data ? <Loading language={language} /> : (
        <>
          <section className="omni-stat-grid">
            <Metric label={l(language, 'Состояние', 'Status')} value={enabled ? l(language, 'Активен', 'Active') : l(language, 'Неактивен', 'Inactive')} />
            <Metric label={l(language, 'Режим', 'Mode')} value={omniText(config.defaultMode, 'parallel')} />
            <Metric label={l(language, 'Тайм-аут', 'Timeout')} value={`${Math.round(omniNumber(config.timeoutMs) / 1000)} s`} />
            <Metric label={l(language, 'Макс. токенов', 'Max tokens')} value={formatCount(omniNumber(config.maxTokens), language)} />
          </section>
          <div className="omni-notice info"><Icon name="info" size={17} /><div><strong>{l(language, 'Режим параллельных ответов', 'Parallel response mode')}</strong><span>{l(language, 'Chaos Mode отправляет запрос нескольким выбранным моделям и собирает результаты в одном запуске.', 'Chaos Mode sends a prompt to multiple selected models and collects the results in one run.')}</span></div></div>
          <section className="omni-panel">
            <div className="omni-panel-title"><div><strong>{l(language, 'Переопределения провайдеров', 'Provider overrides')}</strong><span>{l(language, 'Специальные настройки моделей для Chaos Mode', 'Model-specific settings used by Chaos Mode')}</span></div></div>
            {overrides.length === 0 ? <Empty icon="sliders" title={l(language, 'Переопределений нет', 'No overrides')} detail={l(language, 'Будут использованы параметры провайдеров по умолчанию.', 'Default provider settings will be used.')} /> : (
              <div className="omni-agentic-list">{overrides.map((item, index) => <article className="omni-agentic-list-row" key={`${omniText(item.provider, 'provider')}-${index}`}><span className="omni-agentic-card-icon"><Icon name="sparkles" size={17} /></span><div><strong>{omniText(item.provider, omniText(item.model, 'Provider'))}</strong><p>{omniText(item.model, omniText(item.mode, '—'))}</p></div><Badge>{item.enabled === undefined || omniBool(item.enabled) ? l(language, 'Активен', 'Active') : l(language, 'Выключен', 'Disabled')}</Badge></article>)}</div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function OmniSkillsPage({ language, refreshKey }: Omit<AgenticPageProps, 'path'>) {
  const resource = useAgenticResource(refreshKey, ['/api/skills', '/api/skills/marketplace'])
  const installedRoot = isRecord(resource.data?.[0]) ? resource.data[0] : {}
  const marketRoot = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const installed = omniList(installedRoot, 'skills', 'data', 'items')
  const marketplace = omniList(marketRoot, 'skills', 'data', 'items')
  const popular = Array.isArray(installedRoot.popularDefaults) ? installedRoot.popularDefaults.length : 0

  const cards = (items: OmniRecord[], marketplaceMode: boolean) => (
    <div className="omni-agentic-card-grid">
      {items.map((skill, index) => <article className="omni-agentic-card" key={`${omniText(skill.id, omniText(skill.name, 'skill'))}-${index}`}><header><span className="omni-agentic-card-icon"><Icon name="flask" size={18} /></span><div><strong>{omniText(skill.name, 'Skill')}</strong><small>{omniText(skill.provider, marketplaceMode ? l(language, 'Каталог', 'Marketplace') : l(language, 'Установлен', 'Installed'))}</small></div>{marketplaceMode ? <Badge>{formatCount(omniNumber(skill.installCount), language)}</Badge> : <Badge tone="good">Installed</Badge>}</header><p>{omniText(skill.description, l(language, 'Описание не указано.', 'No description provided.'))}</p>{omniStringList(skill.tags).length ? <footer>{omniStringList(skill.tags).slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}</footer> : null}</article>)}
    </div>
  )

  return (
    <div className="omni-page omni-agentic-page">
      <AgenticHeader page="omni-skills" language={language}><Badge>{formatCount(installed.length, language)} installed</Badge></AgenticHeader>
      <ErrorNotice error={resource.error} language={language} />
      {resource.loading && !resource.data ? <Loading language={language} /> : <>
        <section className="omni-stat-grid"><Metric label={l(language, 'Установлено', 'Installed')} value={installed.length} /><Metric label={l(language, 'В каталоге', 'Marketplace')} value={marketplace.length} /><Metric label={l(language, 'Популярные', 'Popular defaults')} value={popular} /><Metric label={l(language, 'Страница', 'Page')} value={omniNumber(installedRoot.page, 1)} /></section>
        <section className="omni-panel"><div className="omni-panel-title"><div><strong>{l(language, 'Установленные навыки', 'Installed skills')}</strong><span>{l(language, 'Навыки, доступные локальным агентам', 'Skills available to local agents')}</span></div></div>{installed.length ? cards(installed, false) : <Empty icon="flask" title={l(language, 'Навыки ещё не установлены', 'No installed skills')} detail={l(language, 'Ниже доступны варианты из встроенного каталога.', 'Browse the built-in catalog below.')} />}</section>
        <section className="omni-panel"><div className="omni-panel-title"><div><strong>{l(language, 'Каталог', 'Marketplace')}</strong><span>{l(language, 'Готовые навыки для типовых задач', 'Ready-made skills for common tasks')}</span></div></div>{marketplace.length ? cards(marketplace, true) : <Empty title={l(language, 'Каталог пуст', 'Marketplace is empty')} detail={l(language, 'OmniRoute не вернул доступные навыки.', 'OmniRoute returned no available skills.')} />}</section>
      </>}
    </div>
  )
}

function McpPage({ language, refreshKey }: Omit<AgenticPageProps, 'path'>) {
  const resource = useAgenticResource(refreshKey, ['/api/mcp/status', '/api/mcp/tools'])
  const status = isRecord(resource.data?.[0]) ? resource.data[0] : {}
  const toolsRoot = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const activity = nestedRecord(status, 'activity')
  const tools = omniList(toolsRoot, 'tools', 'data')
  const online = omniBool(status.online)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return tools.filter((tool) => !needle || `${omniText(tool.name)} ${omniText(tool.description)} ${omniStringList(tool.scopes).join(' ')}`.toLocaleLowerCase().includes(needle))
  }, [query, tools])

  return (
    <div className="omni-page omni-agentic-page">
      <AgenticHeader page="mcp" language={language}><Badge tone={online ? 'good' : 'neutral'}>{online ? l(language, 'В сети', 'Online') : l(language, 'Не в сети', 'Offline')}</Badge></AgenticHeader>
      <ErrorNotice error={resource.error} language={language} />
      {resource.loading && !resource.data ? <Loading language={language} /> : <>
        <section className="omni-stat-grid"><Metric label={l(language, 'Статус', 'Status')} value={omniText(status.status, online ? 'online' : 'offline')} /><Metric label={l(language, 'Транспорт', 'Transport')} value={omniText(status.transport, 'stdio')} /><Metric label={l(language, 'Инструментов', 'Tools')} value={omniNumber(toolsRoot.total, tools.length)} note={`${omniNumber(toolsRoot.mappedTotal, tools.length)} mapped`} /><Metric label={l(language, 'Вызовов за 24 ч', 'Calls in 24h')} value={formatCount(omniNumber(activity.totalCalls24h), language)} note={`${Math.round(omniNumber(activity.successRate))}% success`} /></section>
        <section className="omni-panel"><div className="omni-panel-title"><div><strong>{l(language, 'Инструменты MCP', 'MCP tools')}</strong><span>{l(language, 'Команды, опубликованные локальным MCP-сервером', 'Commands exposed by the local MCP server')}</span></div><SearchField value={query} onChange={setQuery} placeholder={l(language, 'Найти инструмент…', 'Find a tool…')} /></div>{filtered.length ? <div className="omni-agentic-tool-list">{filtered.map((tool, index) => <article key={`${omniText(tool.name, 'tool')}-${index}`}><span className="omni-agentic-card-icon"><Icon name="layers" size={17} /></span><div><strong>{omniText(tool.name, 'Tool')}</strong><p>{omniText(tool.description, l(language, 'Без описания', 'No description'))}</p></div><div className="omni-agentic-tool-meta">{omniStringList(tool.scopes).slice(0, 2).map((scope) => <Badge key={scope}>{scope}</Badge>)}<small>Phase {omniNumber(tool.phase)}</small></div></article>)}</div> : <Empty icon="search" title={l(language, 'Инструменты не найдены', 'No tools found')} detail={l(language, 'Измените поисковый запрос.', 'Try a different search query.')} />}</section>
      </>}
    </div>
  )
}

function A2aPage({ language, refreshKey }: Omit<AgenticPageProps, 'path'>) {
  const [revision, setRevision] = useState(0)
  const [savingEnabled, setSavingEnabled] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const resource = useAgenticResource(refreshKey + revision, ['/api/a2a/status', '/api/a2a/tasks'])
  const status = isRecord(resource.data?.[0]) ? resource.data[0] : {}
  const tasksRoot = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const taskStatus = nestedRecord(status, 'tasks')
  const counts = nestedRecord(taskStatus, 'counts')
  const tasks = omniList(tasksRoot, 'tasks', 'data')
  const skills = Array.isArray(status.skills) ? status.skills : []
  const online = omniBool(status.online)
  const enabled = omniBool(status.enabled)

  const setA2aEnabled = async (nextEnabled: boolean) => {
    setSavingEnabled(true)
    setActionError(null)
    setSuccess(null)
    try {
      await omniRequest('PATCH', '/api/settings', { a2aEnabled: nextEnabled })
      setSuccess(nextEnabled ? l(language, 'A2A-сервер включён.', 'A2A server enabled.') : l(language, 'A2A-сервер выключен.', 'A2A server disabled.'))
      setRevision((value) => value + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingEnabled(false)
    }
  }

  return (
    <div className="omni-page omni-agentic-page">
      <AgenticHeader page="a2a" language={language}><Badge tone={online ? 'good' : enabled ? 'warn' : 'neutral'}>{omniText(status.status, online ? 'online' : enabled ? 'starting' : 'disabled')}</Badge><SwitchControl checked={enabled} disabled={resource.loading || savingEnabled} label={enabled ? l(language, 'A2A включён', 'A2A on') : l(language, 'A2A выключен', 'A2A off')} onChange={(checked) => void setA2aEnabled(checked)} testId="a2a-enabled-switch" /></AgenticHeader>
      <ErrorNotice error={resource.error} language={language} />
      <ErrorNotice error={actionError} language={language} />
      {success ? <div className="omni-notice success"><Icon name="check" size={17} /><div><strong>{success}</strong></div></div> : null}
      {!resource.loading && !enabled ? <div className="omni-notice info"><Icon name="info" size={17} /><div><strong>{l(language, 'A2A-сервер отключён', 'A2A server is disabled')}</strong><span>{l(language, 'Включите сервер, чтобы принимать задачи от других совместимых агентов.', 'Enable the server to accept tasks from other compatible agents.')}</span></div></div> : null}
      {resource.loading && !resource.data ? <Loading language={language} /> : <>
        <section className="omni-stat-grid"><Metric label={l(language, 'Всего задач', 'Total tasks')} value={omniNumber(taskStatus.total, omniNumber(tasksRoot.total))} /><Metric label={l(language, 'В работе', 'Working')} value={omniNumber(counts.working)} /><Metric label={l(language, 'Потоки', 'Streams')} value={omniNumber(taskStatus.activeStreams)} /><Metric label={l(language, 'Навыки', 'Skills')} value={skills.length} /></section>
        <section className="omni-panel"><div className="omni-panel-title"><div><strong>{l(language, 'Состояния задач', 'Task states')}</strong><span>{l(language, 'Сводка очереди Agent-to-Agent', 'Agent-to-Agent queue summary')}</span></div></div><div className="omni-agentic-state-grid">{['submitted', 'working', 'completed', 'failed', 'cancelled'].map((state) => <div key={state}><span>{state}</span><strong>{omniNumber(counts[state])}</strong></div>)}</div></section>
        <section className="omni-panel"><div className="omni-panel-title"><div><strong>{l(language, 'Последние задачи', 'Recent tasks')}</strong><span>{l(language, 'Запросы, принятые A2A-сервером', 'Requests accepted by the A2A server')}</span></div></div>{tasks.length ? <div className="omni-agentic-list">{tasks.map((task, index) => <article className="omni-agentic-list-row" key={omniText(task.id, String(index))}><span className="omni-agentic-card-icon"><Icon name="route" size={17} /></span><div><strong>{omniText(task.name, omniText(task.id, 'Task'))}</strong><p>{omniText(task.message, omniText(task.description, '—'))}</p></div><div className="omni-agentic-row-end"><Badge tone={omniText(task.status) === 'failed' ? 'bad' : omniText(task.status) === 'completed' ? 'good' : 'neutral'}>{omniText(task.status, 'submitted')}</Badge><small>{formatOmniDate(omniText(task.updatedAt, omniText(task.createdAt)), language)}</small></div></article>)}</div> : <Empty icon="route" title={l(language, 'Задач пока нет', 'No tasks yet')} detail={l(language, 'Новые A2A-запросы появятся здесь.', 'New A2A requests will appear here.')} />}</section>
      </>}
    </div>
  )
}

function PluginsPage({ language, refreshKey }: Omit<AgenticPageProps, 'path'>) {
  const resource = useAgenticResource(refreshKey, ['/api/plugins?status=installed', '/api/plugins?status=active', '/api/plugins/marketplace'])
  const installedRoot = isRecord(resource.data?.[0]) ? resource.data[0] : {}
  const activeRoot = isRecord(resource.data?.[1]) ? resource.data[1] : {}
  const marketRoot = isRecord(resource.data?.[2]) ? resource.data[2] : {}
  const installed = omniList(installedRoot, 'plugins', 'data')
  const active = omniList(activeRoot, 'plugins', 'data')
  const marketplace = omniList(marketRoot, 'plugins', 'data')
  const activeNames = new Set(active.map((plugin) => omniText(plugin.name, omniText(plugin.id))))
  const verified = marketplace.filter((plugin) => omniBool(plugin.verified)).length

  const pluginCards = (items: OmniRecord[], market: boolean) => <div className="omni-agentic-card-grid">{items.map((plugin, index) => { const name = omniText(plugin.name, omniText(plugin.id, 'Plugin')); const isActive = activeNames.has(name); return <article className="omni-agentic-card" key={`${name}-${index}`}><header><span className="omni-agentic-card-icon"><Icon name="plug" size={18} /></span><div><strong>{name}</strong><small>{omniText(plugin.author, omniText(plugin.version, market ? 'Marketplace' : 'Installed'))}</small></div>{market ? (omniBool(plugin.verified) ? <Badge tone="good">Verified</Badge> : null) : <Badge tone={isActive ? 'good' : 'neutral'}>{isActive ? l(language, 'Активен', 'Active') : l(language, 'Установлен', 'Installed')}</Badge>}</header><p>{omniText(plugin.description, l(language, 'Описание не указано.', 'No description provided.'))}</p><footer>{omniStringList(plugin.tags).slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}{market && omniNumber(plugin.downloads) > 0 ? <span>{formatCount(omniNumber(plugin.downloads), language)} downloads</span> : null}</footer></article> })}</div>

  return (
    <div className="omni-page omni-agentic-page">
      <AgenticHeader page="plugins" language={language}><Badge>{formatCount(installed.length, language)} installed</Badge></AgenticHeader>
      <ErrorNotice error={resource.error} language={language} />
      {resource.loading && !resource.data ? <Loading language={language} /> : <>
        <section className="omni-stat-grid"><Metric label={l(language, 'Установлено', 'Installed')} value={installed.length} /><Metric label={l(language, 'Активно', 'Active')} value={active.length} /><Metric label={l(language, 'В каталоге', 'Marketplace')} value={marketplace.length} /><Metric label={l(language, 'Проверено', 'Verified')} value={verified} /></section>
        <section className="omni-panel"><div className="omni-panel-title"><div><strong>{l(language, 'Установленные плагины', 'Installed plugins')}</strong><span>{l(language, 'Расширения текущего экземпляра OmniRoute', 'Extensions in this OmniRoute instance')}</span></div></div>{installed.length ? pluginCards(installed, false) : <Empty icon="plug" title={l(language, 'Плагины не установлены', 'No installed plugins')} detail={l(language, 'Доступные расширения показаны в каталоге ниже.', 'Available extensions are listed below.')} />}</section>
        <section className="omni-panel"><div className="omni-panel-title"><div><strong>{l(language, 'Каталог плагинов', 'Plugin marketplace')}</strong><span>{l(language, 'Проверенные расширения и инструменты', 'Verified extensions and utilities')}</span></div></div>{marketplace.length ? pluginCards(marketplace, true) : <Empty title={l(language, 'Каталог пуст', 'Marketplace is empty')} detail={l(language, 'OmniRoute не вернул доступные плагины.', 'OmniRoute returned no available plugins.')} />}</section>
      </>}
    </div>
  )
}

export function AgenticPage({ path, language, refreshKey }: AgenticPageProps) {
  const key = path.replace(/^\/dashboard\//, '').split('/')[0]
  if (key === 'memory') return <MemoryPage language={language} refreshKey={refreshKey} />
  if (key === 'agent-skills') return <AgentSkillsPage language={language} refreshKey={refreshKey} />
  if (key === 'chaos') return <ChaosPage language={language} refreshKey={refreshKey} />
  if (key === 'omni-skills') return <OmniSkillsPage language={language} refreshKey={refreshKey} />
  if (key === 'mcp') return <McpPage language={language} refreshKey={refreshKey} />
  if (key === 'a2a') return <A2aPage language={language} refreshKey={refreshKey} />
  return <PluginsPage language={language} refreshKey={refreshKey} />
}
