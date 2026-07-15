import { Fragment, useEffect, useMemo, useState, type FocusEvent, type JSX, type MouseEvent } from 'react'
import type { UsageEvent } from '@shared/ipc'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import {
  aggregate,
  colorAt,
  formatTokens,
  heatLevel,
  type Analytics,
  type DailyBucket
} from '@/lib/analytics'
import { formatUsd } from '@/lib/pricing'
import { localeForLanguage, tr, type LanguageCode } from '@/language'
import { useApp } from '@/state/store'

const PROVIDER_LABEL: Record<string, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  omniroute: 'OmniRoute',
  codex: 'Codex',
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  glm: 'GLM (ZCode)'
}
const providerLabel = (p: string): string => PROVIDER_LABEL[p] ?? p

function StatCard({
  icon,
  label,
  value,
  sub
}: {
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  value: string
  sub?: string
}): JSX.Element {
  return (
    <div className="an-card">
      <div className="an-card-label">
        <Icon name={icon} size={14} />
        {label}
      </div>
      <div className="an-card-value">{value}</div>
      {sub && <div className="an-card-sub">{sub}</div>}
    </div>
  )
}

function Heatmap({ data, language }: { data: Analytics; language: LanguageCode }): JSX.Element {
  const cells = data.heatmap
  const locale = localeForLanguage(language)
  const heatmapDateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
    [locale]
  )
  const firstWeekday = cells.length > 0 ? cells[0].date.getDay() : 0
  const placeholders = Array.from({ length: firstWeekday })
  const [tooltip, setTooltip] = useState<{
    day: string
    tokens: number
    left: number
    top: number
  } | null>(null)

  const showTooltip = (
    cell: (typeof cells)[number],
    target: HTMLElement
  ): void => {
    const rect = target.getBoundingClientRect()
    const halfTooltipWidth = 105
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, halfTooltipWidth + 8),
      window.innerWidth - halfTooltipWidth - 8
    )
    setTooltip({
      day: heatmapDateFmt.format(cell.date),
      tokens: cell.count,
      left,
      top: rect.top - 8
    })
  }

  const handleMouseEnter =
    (cell: (typeof cells)[number]) => (event: MouseEvent<HTMLSpanElement>): void =>
      showTooltip(cell, event.currentTarget)

  const handleFocus =
    (cell: (typeof cells)[number]) => (event: FocusEvent<HTMLSpanElement>): void =>
      showTooltip(cell, event.currentTarget)

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>{tr(language, 'analytics.activityHeatmap')}</span>
        <span className="an-legend-scale">
          {tr(language, 'analytics.less')}
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="an-heat-cell legend" data-level={l} />
          ))}
          {tr(language, 'analytics.more')}
        </span>
      </div>
      <div className="an-heatmap" style={{ gridTemplateRows: 'repeat(7, 1fr)' }}>
        {placeholders.map((_, i) => (
          <span key={`p${i}`} className="an-heat-cell empty" />
        ))}
        {cells.map((c) => (
          <span
            key={c.day}
            className="an-heat-cell"
            data-level={heatLevel(c.count, data.heatLevels)}
            role="img"
            tabIndex={0}
            aria-label={`${heatmapDateFmt.format(c.date)}: ${c.count.toLocaleString(locale)} ${tr(language, 'analytics.tokens')}`}
            onMouseEnter={handleMouseEnter(c)}
            onMouseLeave={() => setTooltip(null)}
            onFocus={handleFocus(c)}
            onBlur={() => setTooltip(null)}
          />
        ))}
      </div>
      {tooltip && (
        <div
          className="an-heat-tooltip"
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <span>{tooltip.day}</span>
          <strong>
            {tooltip.tokens > 0
              ? `${tooltip.tokens.toLocaleString(locale)} ${tr(language, 'analytics.tokens')}`
              : tr(language, 'analytics.noActivity')}
          </strong>
        </div>
      )}
    </div>
  )
}

function TokensPerDay({ data, language }: { data: Analytics; language: LanguageCode }): JSX.Element {
  const max = Math.max(1, ...data.daily.map((d) => d.total))
  const tickEvery = Math.max(1, Math.ceil(data.daily.length / 6))
  const colorOf = (model: string): string => colorAt(data.models.indexOf(model))
  const locale = localeForLanguage(language)
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    [locale]
  )
  const heatmapDateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
    [locale]
  )
  const [tooltip, setTooltip] = useState<{
    day: string
    model: string
    color: string
    tokens: number
    left: number
    top: number
  } | null>(null)

  const showTooltip = (
    d: DailyBucket,
    s: { model: string; tokens: number },
    target: HTMLElement
  ): void => {
    const rect = target.getBoundingClientRect()
    const halfTooltipWidth = 105
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, halfTooltipWidth + 8),
      window.innerWidth - halfTooltipWidth - 8
    )
    setTooltip({
      day: heatmapDateFmt.format(d.date),
      model: s.model,
      color: colorOf(s.model),
      tokens: s.tokens,
      left,
      top: rect.top - 8
    })
  }

  // Stack order: by global model ranking so colours are consistent across days.
  const stackFor = (d: DailyBucket): { model: string; tokens: number }[] =>
    data.models
      .filter((m) => (d.byModel[m] ?? 0) > 0)
      .map((m) => ({ model: m, tokens: d.byModel[m] }))

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>{tr(language, 'analytics.tokensPerDay')}</span>
      </div>
      <div className="an-bars">
        {data.daily.map((d) => (
          <div className="an-bar-col" key={d.day}>
            <div className="an-bar-stack">
              {stackFor(d).map((s) => (
                <div
                  key={s.model}
                  className="an-bar-seg"
                  role="img"
                  tabIndex={0}
                  aria-label={`${d.day}: ${s.model}, ${s.tokens.toLocaleString(locale)} ${tr(language, 'analytics.tokens')}`}
                  style={{ height: `${(s.tokens / max) * 100}%`, background: colorOf(s.model) }}
                  onMouseEnter={(e) => showTooltip(d, s, e.currentTarget)}
                  onMouseLeave={() => setTooltip(null)}
                  onFocus={(e) => showTooltip(d, s, e.currentTarget)}
                  onBlur={() => setTooltip(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="an-bars-axis">
        {data.daily.map((d, i) => (
          <span className="an-tick" key={d.day}>
            {i % tickEvery === 0 ? dateFmt.format(d.date) : ''}
          </span>
        ))}
      </div>
      <div className="an-legend">
        {data.models.map((m) => (
          <span className="an-legend-item" key={m}>
            <span className="an-dot" style={{ background: colorOf(m) }} />
            {m}
          </span>
        ))}
      </div>
      {tooltip && (
        <div
          className="an-heat-tooltip"
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <span>{tooltip.day}</span>
          <strong className="an-bar-tooltip-model">
            <span className="an-dot" style={{ background: tooltip.color }} />
            {tooltip.model}
          </strong>
          <span>
            {tooltip.tokens.toLocaleString(locale)} {tr(language, 'analytics.tokens')}
          </span>
        </div>
      )}
    </div>
  )
}

function ModelTrends({
  data,
  language
}: {
  data: Analytics
  language: LanguageCode
}): JSX.Element | null {
  const weeks = data.weekly
  const models = data.models
  const locale = localeForLanguage(language)
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    [locale]
  )
  const [hovered, setHovered] = useState<{ index: number; left: number; top: number } | null>(
    null
  )

  if (models.length === 0 || !weeks.some((w) => w.total > 0)) return null

  // Share of each model per week; empty weeks carry the nearest known mix so the
  // 100%-stacked area stays continuous instead of collapsing to zero.
  const raw: (number[] | null)[] = weeks.map((w) =>
    w.total > 0 ? models.map((m) => (w.byModel[m] ?? 0) / w.total) : null
  )
  const shares: number[][] = new Array(weeks.length)
  let carry: number[] | null = null
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]) carry = raw[i]
    shares[i] = carry as number[] // backfilled below for leading empty weeks
  }
  carry = null
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i]) carry = raw[i]
    if (!shares[i]) shares[i] = carry as number[]
  }

  const n = weeks.length
  const xOf = (i: number): number => (n > 1 ? (i / (n - 1)) * 100 : 100)
  // Cumulative boundaries per week: model 0 (largest) on top, matching the bars.
  const polygons = models.map((model, k) => {
    const top = shares.map((s) => s.slice(0, k).reduce((sum, v) => sum + v, 0) * 100)
    const bottom = shares.map((s) => s.slice(0, k + 1).reduce((sum, v) => sum + v, 0) * 100)
    const pts = [
      ...top.map((y, i) => `${xOf(i)},${y}`),
      ...bottom.map((y, i) => `${xOf(i)},${y}`).reverse()
    ].join(' ')
    return { model, color: colorAt(k), pts }
  })

  const tickEvery = Math.max(1, Math.ceil(n / 6))
  const handleMove = (e: MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    const index = Math.round(rel * (n - 1))
    const halfTooltipWidth = 105
    const left = Math.min(
      Math.max(rect.left + (xOf(index) / 100) * rect.width, halfTooltipWidth + 8),
      window.innerWidth - halfTooltipWidth - 8
    )
    setHovered({ index, left, top: rect.top - 8 })
  }

  const active = hovered ? weeks[hovered.index] : null
  const activeRows = active
    ? models
        .map((m, k) => ({ model: m, tokens: active.byModel[m] ?? 0, color: colorAt(k) }))
        .filter((r) => r.tokens > 0)
    : []

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>{tr(language, 'analytics.modelShareOverTime')}</span>
        <span className="an-panel-cap">{tr(language, 'analytics.weeklyLastWeeks', { count: n })}</span>
      </div>
      <div
        className="an-trend-wrap"
        onMouseMove={handleMove}
        onMouseLeave={() => setHovered(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="an-trend-svg">
          {polygons.map((p) => (
            <polygon key={p.model} points={p.pts} fill={p.color} className="an-trend-area" />
          ))}
          {hovered && (
            <line
              x1={xOf(hovered.index)}
              x2={xOf(hovered.index)}
              y1={0}
              y2={100}
              className="an-trend-guide"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="an-bars-axis">
        {weeks.map((w, i) => (
          <span className="an-tick" key={w.week}>
            {i % tickEvery === 0 ? dateFmt.format(w.date) : ''}
          </span>
        ))}
      </div>
      <div className="an-legend">
        {models.map((m, k) => (
          <span className="an-legend-item" key={m}>
            <span className="an-dot" style={{ background: colorAt(k) }} />
            {m}
          </span>
        ))}
      </div>
      {hovered && active && (
        <div
          className="an-heat-tooltip"
          role="tooltip"
          style={{ left: hovered.left, top: hovered.top }}
        >
          <span>{tr(language, 'analytics.weekOf', { date: dateFmt.format(active.date) })}</span>
          {activeRows.length > 0 ? (
            activeRows.map((r) => (
              <span className="an-trend-tip-row" key={r.model}>
                <span className="an-dot" style={{ background: r.color }} />
                {r.model}
                <strong>{Math.round((r.tokens / active.total) * 100)}%</strong>
              </span>
            ))
          ) : (
            <strong>{tr(language, 'analytics.noActivity')}</strong>
          )}
        </div>
      )}
    </div>
  )
}

function HourHeatmap({ data, language }: { data: Analytics; language: LanguageCode }): JSX.Element {
  const locale = localeForLanguage(language)
  // 2024-01-01 is a Monday; used only to render localized Mon..Sun labels.
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 1 + i)))
  }, [locale])
  const [tooltip, setTooltip] = useState<{
    label: string
    tokens: number
    left: number
    top: number
  } | null>(null)

  const showTooltip = (day: number, hour: number, target: HTMLElement): void => {
    const rect = target.getBoundingClientRect()
    const halfTooltipWidth = 105
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, halfTooltipWidth + 8),
      window.innerWidth - halfTooltipWidth - 8
    )
    setTooltip({
      label: `${weekdayLabels[day]}, ${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
      tokens: data.hourGrid[day][hour],
      left,
      top: rect.top - 8
    })
  }

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>{tr(language, 'analytics.activityByHour')}</span>
        <span className="an-legend-scale">
          {tr(language, 'analytics.less')}
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="an-heat-cell legend" data-level={l} />
          ))}
          {tr(language, 'analytics.more')}
        </span>
      </div>
      <div className="an-hour-grid">
        {data.hourGrid.map((row, day) => (
          <Fragment key={day}>
            <span className="an-hour-day">{weekdayLabels[day]}</span>
            {row.map((tokens, hour) => (
              <span
                key={hour}
                className="an-heat-cell an-hour-cell"
                data-level={heatLevel(tokens, data.hourLevels)}
                role="img"
                tabIndex={0}
                aria-label={`${weekdayLabels[day]} ${hour}:00: ${tokens.toLocaleString(locale)} ${tr(language, 'analytics.tokens')}`}
                onMouseEnter={(e) => showTooltip(day, hour, e.currentTarget)}
                onMouseLeave={() => setTooltip(null)}
                onFocus={(e) => showTooltip(day, hour, e.currentTarget)}
                onBlur={() => setTooltip(null)}
              />
            ))}
          </Fragment>
        ))}
        <span className="an-hour-day" />
        {Array.from({ length: 24 }, (_, h) => (
          <span className="an-hour-tick" key={h}>
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
      </div>
      {tooltip && (
        <div
          className="an-heat-tooltip"
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <span>{tooltip.label}</span>
          <strong>
            {tooltip.tokens > 0
              ? `${tooltip.tokens.toLocaleString(locale)} ${tr(language, 'analytics.tokens')}`
              : tr(language, 'analytics.noActivity')}
          </strong>
        </div>
      )}
    </div>
  )
}

function ModelDonut({ data, language }: { data: Analytics; language: LanguageCode }): JSX.Element {
  const r = 54
  const C = 2 * Math.PI * r
  const [hovered, setHovered] = useState<number | null>(null)
  let offset = 0
  const segments = data.perModel.map((m, i) => {
    const seg = { ...m, color: colorAt(i), dash: m.share * C, offset }
    offset += m.share * C
    return seg
  })
  const active = hovered != null ? segments[hovered] : null

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>{tr(language, 'analytics.modelUsage')}</span>
      </div>
      <div className="an-donut-row">
        <div className="an-donut-wrap">
          <svg viewBox="0 0 140 140" className="an-donut">
            <circle cx="70" cy="70" r={r} className="an-donut-track" />
            {segments.map((s, i) => (
              <circle
                key={s.model}
                cx="70"
                cy="70"
                r={r}
                className={`an-donut-seg${
                  hovered == null ? '' : hovered === i ? ' is-active' : ' is-dimmed'
                }`}
                stroke={s.color}
                strokeDasharray={`${s.dash} ${C - s.dash}`}
                strokeDashoffset={-s.offset}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </svg>
          <div className="an-donut-center">
            {active ? (
              <div>
                <div className="an-donut-model" style={{ color: active.color }}>
                  {active.model}
                </div>
                <div className="an-donut-total">{Math.round(active.share * 100)}%</div>
                <div className="an-donut-cap">
                  {formatTokens(active.tokens)} {tr(language, 'analytics.tokens')}
                </div>
              </div>
            ) : (
              <div>
                <div className="an-donut-total">{formatTokens(data.totalTokens)}</div>
                <div className="an-donut-cap">{tr(language, 'analytics.tokens')}</div>
              </div>
            )}
          </div>
        </div>
        <div className="an-model-list">
          {data.perModel.map((m, i) => (
            <div
              className={`an-model-row${hovered === i ? ' is-active' : ''}`}
              key={m.model}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="an-dot" style={{ background: colorAt(i) }} />
              <div className="an-model-text">
                <span className="an-model-name">{m.model}</span>
                <span className="an-model-tokens">
                  {formatTokens(m.tokens)} {tr(language, 'analytics.tokens')}
                  {m.costUsd > 0 ? ` · ~${formatUsd(m.costUsd)}` : ''}
                </span>
              </div>
              <span className="an-model-share">{Math.round(m.share * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProjectsTable({
  data,
  language
}: {
  data: Analytics
  language: LanguageCode
}): JSX.Element {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  const toggleProject = (workspaceId: string): void => {
    setExpandedProjects((current) => ({ ...current, [workspaceId]: !current[workspaceId] }))
  }

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>{tr(language, 'analytics.projects')}</span>
      </div>
      <table className="an-table">
        <thead>
          <tr>
            <th>{tr(language, 'analytics.project')}</th>
            <th>{tr(language, 'analytics.modelsRouters')}</th>
            <th className="num">{tr(language, 'analytics.sessions')}</th>
            <th className="num">{tr(language, 'analytics.messages')}</th>
            <th className="num">{tr(language, 'analytics.tokens')}</th>
            <th className="num">{tr(language, 'analytics.estimatedCost')}</th>
          </tr>
        </thead>
        <tbody>
          {data.perProject.map((p) => {
            const expanded = !!expandedProjects[p.workspaceId]
            return (
              <Fragment key={p.workspaceId}>
                <tr className="an-project-row">
                  <td>
                    <button
                      className="an-project-toggle"
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`project-models-${p.workspaceId}`}
                      onClick={() => toggleProject(p.workspaceId)}
                    >
                      <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
                      <span>{p.name}</span>
                    </button>
                  </td>
                  <td className="an-muted">{p.models.join(', ')}</td>
                  <td className="num">{p.sessions}</td>
                  <td className="num">{p.messages}</td>
                  <td className="num">{formatTokens(p.tokens)}</td>
                  <td className="num">{p.costUsd > 0 ? `~${formatUsd(p.costUsd)}` : '—'}</td>
                </tr>
                {expanded && (
                  <tr className="an-project-details-row">
                    <td colSpan={6}>
                      <div className="an-project-models" id={`project-models-${p.workspaceId}`}>
                        {p.modelStats.map((model) => (
                          <div className="an-project-model" key={model.model}>
                            <div className="an-project-model-head">
                              <span
                                className="an-dot"
                                style={{ background: colorAt(data.models.indexOf(model.model)) }}
                              />
                              <span className="an-project-model-name">{model.model}</span>
                              <span className="an-project-model-share">
                                {Math.round(model.share * 100)}%
                              </span>
                            </div>
                            <div className="an-project-model-metrics">
                              <span>
                                {tr(language, 'analytics.tokens')} <strong>{formatTokens(model.tokens)}</strong>
                              </span>
                              <span>
                                {tr(language, 'analytics.sessions')} <strong>{model.sessions}</strong>
                              </span>
                              <span>
                                {tr(language, 'analytics.messages')} <strong>{model.messages}</strong>
                              </span>
                              {model.costUsd > 0 && (
                                <span>
                                  {tr(language, 'analytics.estimatedCost')} <strong>~{formatUsd(model.costUsd)}</strong>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ProvidersTable({
  data,
  language
}: {
  data: Analytics
  language: LanguageCode
}): JSX.Element {
  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>{tr(language, 'analytics.routers')}</span>
      </div>
      <table className="an-table">
        <thead>
          <tr>
            <th>{tr(language, 'analytics.router')}</th>
            <th className="num">{tr(language, 'analytics.shareLabel')}</th>
            <th className="num">{tr(language, 'analytics.sessions')}</th>
            <th className="num">{tr(language, 'analytics.messages')}</th>
            <th className="num">{tr(language, 'analytics.tokens')}</th>
            <th className="num">{tr(language, 'analytics.estimatedCost')}</th>
          </tr>
        </thead>
        <tbody>
          {data.perProvider.map((p) => (
            <tr key={p.provider}>
              <td>{providerLabel(p.provider)}</td>
              <td className="num">{Math.round(p.share * 100)}%</td>
              <td className="num">{p.sessions}</td>
              <td className="num">{p.messages}</td>
              <td className="num">{formatTokens(p.tokens)}</td>
              <td className="num">{p.costUsd > 0 ? `~${formatUsd(p.costUsd)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AnalyticsView(): JSX.Element {
  const [events, setEvents] = useState<UsageEvent[] | null>(null)
  const [project, setProject] = useState<string>('all')
  const appLanguage = useApp((s) => s.appLanguage)

  const load = (): void => {
    void api.analytics.list().then(setEvents)
  }
  useEffect(load, [])

  // Project options derived from the data.
  const projects = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of events ?? []) map.set(e.workspaceId, e.workspaceName)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [events])

  const filtered = useMemo(
    () => (project === 'all' ? (events ?? []) : (events ?? []).filter((e) => e.workspaceId === project)),
    [events, project]
  )

  const data = useMemo(() => aggregate(filtered), [filtered])

  const empty = (events?.length ?? 0) === 0

  return (
    <div className="analytics">
      <div className="an-header">
        <h1 className="an-title">
          <Icon name="barChart" size={18} /> {tr(appLanguage, 'analytics.title')}
        </h1>
        <span className="spacer" />
        <select className="an-select" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">{tr(appLanguage, 'analytics.allProjects')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="an-refresh"
          onClick={load}
          title={tr(appLanguage, 'common.refresh')}
          aria-label={tr(appLanguage, 'common.refresh')}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {events === null ? (
        <div className="an-empty">{tr(appLanguage, 'analytics.loading')}</div>
      ) : empty ? (
        <div className="an-empty">
          {tr(appLanguage, 'analytics.empty')}
        </div>
      ) : (
        <div className="an-scroll">
          <div className="an-cards">
            <StatCard
              icon="sparkles"
              label={tr(appLanguage, 'analytics.tokenUsage')}
              value={formatTokens(data.totalTokens)}
            />
            <StatCard icon="message" label={tr(appLanguage, 'analytics.sessions')} value={String(data.sessions)} />
            <StatCard icon="message" label={tr(appLanguage, 'analytics.messages')} value={String(data.messages)} />
            <StatCard icon="check" label={tr(appLanguage, 'analytics.activeDays')} value={String(data.activeDays)} />
            <StatCard icon="refresh" label={tr(appLanguage, 'analytics.currentStreak')} value={String(data.currentStreak)} />
            <StatCard
              icon="sparkles"
              label={tr(appLanguage, 'analytics.favoriteModel')}
              value={data.favorite ? data.favorite.model : '—'}
              sub={
                data.favorite
                  ? tr(appLanguage, 'analytics.share', {
                      count: Math.round(data.favorite.share * 100)
                    })
                  : undefined
              }
            />
            <StatCard
              icon="barChart"
              label={tr(appLanguage, 'analytics.estimatedCost')}
              value={formatUsd(data.costUsd)}
              sub={tr(appLanguage, 'analytics.thisMonthApiRates', {
                cost: formatUsd(data.monthCostUsd)
              })}
            />
            <StatCard
              icon="check"
              label={tr(appLanguage, 'analytics.savedLocalWeb')}
              value={formatUsd(data.savedUsd)}
              sub={tr(appLanguage, 'analytics.apiEquivalentValue')}
            />
          </div>

          <Heatmap data={data} language={appLanguage} />
          <TokensPerDay data={data} language={appLanguage} />
          <ModelTrends data={data} language={appLanguage} />
          <HourHeatmap data={data} language={appLanguage} />
          <ModelDonut data={data} language={appLanguage} />
          <ProjectsTable data={data} language={appLanguage} />
          <ProvidersTable data={data} language={appLanguage} />
        </div>
      )}
    </div>
  )
}
