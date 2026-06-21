import type { UsageEvent } from '@shared/ipc'

/** Stable colour palette for models/providers across all charts. */
export const PALETTE = [
  '#5b9dff',
  '#3fcf8e',
  '#c08cff',
  '#f0a35e',
  '#f06a6a',
  '#5ed0d0',
  '#e6c84f',
  '#9aa7b2'
]

export function colorAt(index: number): string {
  return PALETTE[index % PALETTE.length]
}

/** Compact token label, e.g. 12.1M / 9.4K / 530. */
export function formatTokens(n: number): string {
  if (n >= 1e9) return `${trim1(n / 1e9)}B`
  if (n >= 1e6) return `${trim1(n / 1e6)}M`
  if (n >= 1e3) return `${trim1(n / 1e3)}K`
  return String(Math.round(n))
}

function trim1(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

function dayKey(ts: number): string {
  return dateKey(new Date(ts))
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export interface ModelStat {
  model: string
  tokens: number
  messages: number
  sessions: number
  share: number
}

export interface ProjectStat {
  workspaceId: string
  name: string
  tokens: number
  messages: number
  sessions: number
  models: string[]
}

export interface ProviderStat {
  provider: string
  tokens: number
  messages: number
  sessions: number
  share: number
}

export interface DailyBucket {
  /** YYYY-MM-DD */
  day: string
  date: Date
  total: number
  byModel: Record<string, number>
}

export interface HeatCell {
  day: string
  date: Date
  count: number
}

export interface Analytics {
  totalTokens: number
  sessions: number
  messages: number
  activeDays: number
  currentStreak: number
  favorite: { model: string; share: number } | null
  /** Models sorted by tokens desc — drives colour assignment + legends. */
  models: string[]
  perModel: ModelStat[]
  perProject: ProjectStat[]
  perProvider: ProviderStat[]
  /** Contiguous daily series (oldest → newest) over `dailyDays`. */
  daily: DailyBucket[]
  /** Contiguous day cells (oldest → newest) over `heatmapDays` for the heatmap. */
  heatmap: HeatCell[]
  /** Token thresholds (>=) for heatmap intensity levels 1..4. */
  heatLevels: [number, number, number, number]
}

const tokensOf = (e: UsageEvent): number => e.inputTokens + e.outputTokens
const msgsOf = (e: UsageEvent): number => e.userMessages + e.assistantMessages

/** Aggregate raw usage events into everything the dashboard renders. */
export function aggregate(
  events: UsageEvent[],
  opts: { dailyDays?: number; heatmapDays?: number } = {}
): Analytics {
  const dailyDays = opts.dailyDays ?? 30
  const heatmapDays = opts.heatmapDays ?? 182 // ~26 weeks

  let totalTokens = 0
  let messages = 0
  const sessionIds = new Set<string>()
  const activeDayKeys = new Set<string>()

  const modelAgg = new Map<string, { tokens: number; messages: number; sessions: Set<string> }>()
  const projectAgg = new Map<
    string,
    { name: string; tokens: number; messages: number; sessions: Set<string>; models: Set<string> }
  >()
  const providerAgg = new Map<string, { tokens: number; messages: number; sessions: Set<string> }>()
  const tokensByDay = new Map<string, number>() // for heatmap intensity

  for (const e of events) {
    const tok = tokensOf(e)
    const msg = msgsOf(e)
    totalTokens += tok
    messages += msg
    sessionIds.add(e.taskId)
    activeDayKeys.add(dayKey(e.ts))
    tokensByDay.set(dayKey(e.ts), (tokensByDay.get(dayKey(e.ts)) ?? 0) + tok)

    const m = modelAgg.get(e.model) ?? { tokens: 0, messages: 0, sessions: new Set<string>() }
    m.tokens += tok
    m.messages += msg
    m.sessions.add(e.taskId)
    modelAgg.set(e.model, m)

    const p = projectAgg.get(e.workspaceId) ?? {
      name: e.workspaceName,
      tokens: 0,
      messages: 0,
      sessions: new Set<string>(),
      models: new Set<string>()
    }
    p.name = e.workspaceName || p.name
    p.tokens += tok
    p.messages += msg
    p.sessions.add(e.taskId)
    p.models.add(e.model)
    projectAgg.set(e.workspaceId, p)

    const pr = providerAgg.get(e.provider) ?? { tokens: 0, messages: 0, sessions: new Set<string>() }
    pr.tokens += tok
    pr.messages += msg
    pr.sessions.add(e.taskId)
    providerAgg.set(e.provider, pr)
  }

  const perModel: ModelStat[] = [...modelAgg.entries()]
    .map(([model, v]) => ({
      model,
      tokens: v.tokens,
      messages: v.messages,
      sessions: v.sessions.size,
      share: totalTokens > 0 ? v.tokens / totalTokens : 0
    }))
    .sort((a, b) => b.tokens - a.tokens)

  const perProject: ProjectStat[] = [...projectAgg.entries()]
    .map(([workspaceId, v]) => ({
      workspaceId,
      name: v.name,
      tokens: v.tokens,
      messages: v.messages,
      sessions: v.sessions.size,
      models: [...v.models]
    }))
    .sort((a, b) => b.tokens - a.tokens)

  const perProvider: ProviderStat[] = [...providerAgg.entries()]
    .map(([provider, v]) => ({
      provider,
      tokens: v.tokens,
      messages: v.messages,
      sessions: v.sessions.size,
      share: totalTokens > 0 ? v.tokens / totalTokens : 0
    }))
    .sort((a, b) => b.tokens - a.tokens)

  const models = perModel.map((m) => m.model)
  const favorite = perModel.length > 0 ? { model: perModel[0].model, share: perModel[0].share } : null

  // ----- daily token series (stacked by model), contiguous over the window -----
  const today = startOfDay(new Date())
  const dailyByDay = new Map<string, Record<string, number>>()
  for (const e of events) {
    const key = dayKey(e.ts)
    const rec = dailyByDay.get(key) ?? {}
    rec[e.model] = (rec[e.model] ?? 0) + tokensOf(e)
    dailyByDay.set(key, rec)
  }
  const daily: DailyBucket[] = []
  for (let i = dailyDays - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = dateKey(date)
    const byModel = dailyByDay.get(key) ?? {}
    const total = Object.values(byModel).reduce((s, v) => s + v, 0)
    daily.push({ day: key, date, total, byModel })
  }

  // ----- heatmap cells -----
  const heatmap: HeatCell[] = []
  for (let i = heatmapDays - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = dateKey(date)
    heatmap.push({ day: key, date, count: tokensByDay.get(key) ?? 0 })
  }
  // Scale only against the visible window. Old outlier days must not flatten the
  // colour contrast of every cell the user can currently see.
  const maxDay = Math.max(0, ...heatmap.map((cell) => cell.count))
  const heatLevels: [number, number, number, number] =
    maxDay > 0
      ? [maxDay * 0.05, maxDay * 0.25, maxDay * 0.5, maxDay * 0.75]
      : [1, 2, 3, 4]

  // ----- current streak (consecutive active days ending today) -----
  let currentStreak = 0
  for (let i = 0; ; i++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    if (activeDayKeys.has(dateKey(date))) currentStreak++
    else break
  }

  return {
    totalTokens,
    sessions: sessionIds.size,
    messages,
    activeDays: activeDayKeys.size,
    currentStreak,
    favorite,
    models,
    perModel,
    perProject,
    perProvider,
    daily,
    heatmap,
    heatLevels
  }
}

export function heatLevel(count: number, levels: [number, number, number, number]): number {
  if (count <= 0) return 0
  if (count >= levels[3]) return 4
  if (count >= levels[2]) return 3
  if (count >= levels[1]) return 2
  return 1
}
