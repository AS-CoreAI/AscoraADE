import { useEffect, useMemo, useState, type FocusEvent, type JSX, type MouseEvent } from 'react'
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

const PROVIDER_LABEL: Record<string, string> = {
  lmstudio: 'LM Studio',
  codex: 'Codex',
  claude: 'Claude Code',
  glm: 'GLM (ZCode)'
}
const providerLabel = (p: string): string => PROVIDER_LABEL[p] ?? p

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const heatmapDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
})

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

function Heatmap({ data }: { data: Analytics }): JSX.Element {
  const cells = data.heatmap
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
        <span>Activity heatmap</span>
        <span className="an-legend-scale">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="an-heat-cell legend" data-level={l} />
          ))}
          More
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
            aria-label={`${heatmapDateFmt.format(c.date)}: ${c.count.toLocaleString()} tokens`}
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
              ? `${tooltip.tokens.toLocaleString()} tokens`
              : 'No activity'}
          </strong>
        </div>
      )}
    </div>
  )
}

function TokensPerDay({ data }: { data: Analytics }): JSX.Element {
  const max = Math.max(1, ...data.daily.map((d) => d.total))
  const tickEvery = Math.max(1, Math.ceil(data.daily.length / 6))
  const colorOf = (model: string): string => colorAt(data.models.indexOf(model))

  // Stack order: by global model ranking so colours are consistent across days.
  const stackFor = (d: DailyBucket): { model: string; tokens: number }[] =>
    data.models
      .filter((m) => (d.byModel[m] ?? 0) > 0)
      .map((m) => ({ model: m, tokens: d.byModel[m] }))

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>Tokens per day</span>
      </div>
      <div className="an-bars">
        {data.daily.map((d) => (
          <div className="an-bar-col" key={d.day} title={`${d.day}: ${formatTokens(d.total)} tokens`}>
            <div className="an-bar-stack">
              {stackFor(d).map((s) => (
                <div
                  key={s.model}
                  className="an-bar-seg"
                  style={{ height: `${(s.tokens / max) * 100}%`, background: colorOf(s.model) }}
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
    </div>
  )
}

function ModelDonut({ data }: { data: Analytics }): JSX.Element {
  const r = 54
  const C = 2 * Math.PI * r
  let offset = 0
  const segments = data.perModel.map((m, i) => {
    const seg = { ...m, color: colorAt(i), dash: m.share * C, offset }
    offset += m.share * C
    return seg
  })

  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>Model usage</span>
      </div>
      <div className="an-donut-row">
        <div className="an-donut-wrap">
          <svg viewBox="0 0 140 140" className="an-donut">
            <circle cx="70" cy="70" r={r} className="an-donut-track" />
            {segments.map((s) => (
              <circle
                key={s.model}
                cx="70"
                cy="70"
                r={r}
                className="an-donut-seg"
                stroke={s.color}
                strokeDasharray={`${s.dash} ${C - s.dash}`}
                strokeDashoffset={-s.offset}
              />
            ))}
          </svg>
          <div className="an-donut-center">
            <div className="an-donut-total">{formatTokens(data.totalTokens)}</div>
            <div className="an-donut-cap">tokens</div>
          </div>
        </div>
        <div className="an-model-list">
          {data.perModel.map((m, i) => (
            <div className="an-model-row" key={m.model}>
              <span className="an-dot" style={{ background: colorAt(i) }} />
              <div className="an-model-text">
                <span className="an-model-name">{m.model}</span>
                <span className="an-model-tokens">{formatTokens(m.tokens)} tokens</span>
              </div>
              <span className="an-model-share">{Math.round(m.share * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProjectsTable({ data }: { data: Analytics }): JSX.Element {
  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>Projects</span>
      </div>
      <table className="an-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Models / routers</th>
            <th className="num">Sessions</th>
            <th className="num">Messages</th>
            <th className="num">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {data.perProject.map((p) => (
            <tr key={p.workspaceId}>
              <td>{p.name}</td>
              <td className="an-muted">{p.models.join(', ')}</td>
              <td className="num">{p.sessions}</td>
              <td className="num">{p.messages}</td>
              <td className="num">{formatTokens(p.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProvidersTable({ data }: { data: Analytics }): JSX.Element {
  return (
    <div className="an-panel">
      <div className="an-panel-head">
        <span>Routers</span>
      </div>
      <table className="an-table">
        <thead>
          <tr>
            <th>Router</th>
            <th className="num">Share</th>
            <th className="num">Sessions</th>
            <th className="num">Messages</th>
            <th className="num">Tokens</th>
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
          <Icon name="barChart" size={18} /> Analytics
        </h1>
        <span className="spacer" />
        <select className="an-select" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="an-refresh" onClick={load} title="Refresh">
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {events === null ? (
        <div className="an-empty">Loading…</div>
      ) : empty ? (
        <div className="an-empty">
          No usage recorded yet. Start a task with LM Studio or Codex and your token usage,
          sessions and model breakdown will show up here.
        </div>
      ) : (
        <div className="an-scroll">
          <div className="an-cards">
            <StatCard icon="sparkles" label="Token usage" value={formatTokens(data.totalTokens)} />
            <StatCard icon="message" label="Sessions" value={String(data.sessions)} />
            <StatCard icon="message" label="Messages" value={String(data.messages)} />
            <StatCard icon="check" label="Active days" value={String(data.activeDays)} />
            <StatCard icon="refresh" label="Current streak" value={String(data.currentStreak)} />
            <StatCard
              icon="sparkles"
              label="Favorite model"
              value={data.favorite ? data.favorite.model : '—'}
              sub={data.favorite ? `${Math.round(data.favorite.share * 100)}% share` : undefined}
            />
          </div>

          <Heatmap data={data} />
          <TokensPerDay data={data} />
          <ModelDonut data={data} />
          <ProjectsTable data={data} />
          <ProvidersTable data={data} />
        </div>
      )}
    </div>
  )
}
