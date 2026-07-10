import type { UsageEvent } from '@shared/ipc'
import { eventCostUsd, FREE_PROVIDERS } from './pricing'

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
  /** Estimated API spend (USD) through paid providers only. */
  costUsd: number
}

export interface ProjectStat {
  workspaceId: string
  name: string
  tokens: number
  messages: number
  sessions: number
  models: string[]
  /** Model-by-model usage within this project (sorted by token count). */
  modelStats: ModelStat[]
  /** Estimated API spend (USD) through paid providers only. */
  costUsd: number
}

export interface ProviderStat {
  provider: string
  tokens: number
  messages: number
  sessions: number
  share: number
  /** Estimated API spend (USD); 0 for local/web providers. */
  costUsd: number
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

export interface WeeklyBucket {
  /** YYYY-MM-DD of the week's Monday. */
  week: string
  date: Date
  total: number
  byModel: Record<string, number>
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
  /** Estimated API spend in USD (paid providers, all time / current calendar month). */
  costUsd: number
  monthCostUsd: number
  /** API-equivalent value of tokens served by free providers (local + web). */
  savedUsd: number
  /** Contiguous weekly series (oldest → newest) over `weeklyWeeks` for model migration. */
  weekly: WeeklyBucket[]
  /** Tokens by weekday (0=Mon .. 6=Sun) × hour of day (0..23), local time. */
  hourGrid: number[][]
  /** Token thresholds (>=) for hour-grid intensity levels 1..4. */
  hourLevels: [number, number, number, number]
}

const tokensOf = (e: UsageEvent): number => e.inputTokens + e.outputTokens
const msgsOf = (e: UsageEvent): number => e.userMessages + e.assistantMessages

/** Aggregate raw usage events into everything the dashboard renders. */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d)
  const shift = (s.getDay() + 6) % 7 // Monday-first
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - shift)
}

export function aggregate(
  events: UsageEvent[],
  opts: { dailyDays?: number; heatmapDays?: number; weeklyWeeks?: number } = {}
): Analytics {
  const dailyDays = opts.dailyDays ?? 30
  const heatmapDays = opts.heatmapDays ?? 182 // ~26 weeks
  const weeklyWeeks = opts.weeklyWeeks ?? 12

  let totalTokens = 0
  let messages = 0
  let costUsd = 0
  let monthCostUsd = 0
  let savedUsd = 0
  const now = new Date()
  const sessionIds = new Set<string>()
  const activeDayKeys = new Set<string>()

  const modelAgg = new Map<
    string,
    { tokens: number; messages: number; sessions: Set<string>; costUsd: number }
  >()
  const projectAgg = new Map<
    string,
    {
      name: string
      tokens: number
      messages: number
      sessions: Set<string>
      models: Map<
        string,
        { tokens: number; messages: number; sessions: Set<string>; costUsd: number }
      >
    }
  >()
  const providerAgg = new Map<
    string,
    { tokens: number; messages: number; sessions: Set<string>; costUsd: number }
  >()
  const tokensByDay = new Map<string, number>() // for heatmap intensity
  const hourGrid: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0))

  for (const e of events) {
    const tok = tokensOf(e)
    const msg = msgsOf(e)
    totalTokens += tok
    messages += msg
    sessionIds.add(e.taskId)
    activeDayKeys.add(dayKey(e.ts))
    tokensByDay.set(dayKey(e.ts), (tokensByDay.get(dayKey(e.ts)) ?? 0) + tok)

    const eventDate = new Date(e.ts)
    hourGrid[(eventDate.getDay() + 6) % 7][eventDate.getHours()] += tok

    const apiCost = eventCostUsd(e)
    const isFree = FREE_PROVIDERS.has(e.provider)
    if (isFree) {
      savedUsd += apiCost
    } else {
      costUsd += apiCost
      if (
        eventDate.getFullYear() === now.getFullYear() &&
        eventDate.getMonth() === now.getMonth()
      ) {
        monthCostUsd += apiCost
      }
    }

    const m = modelAgg.get(e.model) ?? {
      tokens: 0,
      messages: 0,
      sessions: new Set<string>(),
      costUsd: 0
    }
    m.tokens += tok
    m.messages += msg
    m.sessions.add(e.taskId)
    if (!isFree) m.costUsd += apiCost
    modelAgg.set(e.model, m)

    const p = projectAgg.get(e.workspaceId) ?? {
      name: e.workspaceName,
      tokens: 0,
      messages: 0,
      sessions: new Set<string>(),
      models: new Map<
        string,
        { tokens: number; messages: number; sessions: Set<string>; costUsd: number }
      >()
    }
    p.name = e.workspaceName || p.name
    p.tokens += tok
    p.messages += msg
    p.sessions.add(e.taskId)
    const projectModel = p.models.get(e.model) ?? {
      tokens: 0,
      messages: 0,
      sessions: new Set<string>(),
      costUsd: 0
    }
    projectModel.tokens += tok
    projectModel.messages += msg
    projectModel.sessions.add(e.taskId)
    if (!isFree) projectModel.costUsd += apiCost
    p.models.set(e.model, projectModel)
    projectAgg.set(e.workspaceId, p)

    const pr = providerAgg.get(e.provider) ?? {
      tokens: 0,
      messages: 0,
      sessions: new Set<string>(),
      costUsd: 0
    }
    pr.tokens += tok
    pr.messages += msg
    pr.sessions.add(e.taskId)
    if (!isFree) pr.costUsd += apiCost
    providerAgg.set(e.provider, pr)
  }

  const perModel: ModelStat[] = [...modelAgg.entries()]
    .map(([model, v]) => ({
      model,
      tokens: v.tokens,
      messages: v.messages,
      sessions: v.sessions.size,
      share: totalTokens > 0 ? v.tokens / totalTokens : 0,
      costUsd: v.costUsd
    }))
    .sort((a, b) => b.tokens - a.tokens)

  const perProject: ProjectStat[] = [...projectAgg.entries()]
    .map(([workspaceId, v]) => {
      const modelStats = [...v.models.entries()]
        .map(([model, modelUsage]) => ({
          model,
          tokens: modelUsage.tokens,
          messages: modelUsage.messages,
          sessions: modelUsage.sessions.size,
          share: v.tokens > 0 ? modelUsage.tokens / v.tokens : 0,
          costUsd: modelUsage.costUsd
        }))
        .sort((a, b) => b.tokens - a.tokens)
      return {
        workspaceId,
        name: v.name,
        tokens: v.tokens,
        messages: v.messages,
        sessions: v.sessions.size,
        models: modelStats.map((model) => model.model),
        modelStats,
        costUsd: modelStats.reduce((s, model) => s + model.costUsd, 0)
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const perProvider: ProviderStat[] = [...providerAgg.entries()]
    .map(([provider, v]) => ({
      provider,
      tokens: v.tokens,
      messages: v.messages,
      sessions: v.sessions.size,
      share: totalTokens > 0 ? v.tokens / totalTokens : 0,
      costUsd: v.costUsd
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

  // ----- weekly model-share series (stacked by model), contiguous over the window -----
  const weeklyByWeek = new Map<string, Record<string, number>>()
  for (const e of events) {
    const key = dateKey(startOfWeek(new Date(e.ts)))
    const rec = weeklyByWeek.get(key) ?? {}
    rec[e.model] = (rec[e.model] ?? 0) + tokensOf(e)
    weeklyByWeek.set(key, rec)
  }
  const thisWeek = startOfWeek(today)
  const weekly: WeeklyBucket[] = []
  for (let i = weeklyWeeks - 1; i >= 0; i--) {
    const date = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - i * 7)
    const key = dateKey(date)
    const byModel = weeklyByWeek.get(key) ?? {}
    const total = Object.values(byModel).reduce((s, v) => s + v, 0)
    weekly.push({ week: key, date, total, byModel })
  }

  // ----- hour-of-day × weekday grid intensity levels -----
  const maxHour = Math.max(0, ...hourGrid.flat())
  const hourLevels: [number, number, number, number] =
    maxHour > 0
      ? [maxHour * 0.05, maxHour * 0.25, maxHour * 0.5, maxHour * 0.75]
      : [1, 2, 3, 4]

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
    heatLevels,
    costUsd,
    monthCostUsd,
    savedUsd,
    weekly,
    hourGrid,
    hourLevels
  }
}

export function heatLevel(count: number, levels: [number, number, number, number]): number {
  if (count <= 0) return 0
  if (count >= levels[3]) return 4
  if (count >= levels[2]) return 3
  if (count >= levels[1]) return 2
  return 1
}
