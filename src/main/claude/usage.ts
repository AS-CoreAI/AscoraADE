import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeUsageResult, ClaudeUsageWindow } from '@shared/ipc'

/**
 * Reports the user's Claude subscription usage limits, the same data Claude
 * Code's IDE extension shows ("You've used 85% of your weekly limit · resets…").
 *
 * Claude Code stores an OAuth access token from the user's Claude.ai login; we
 * read it from disk and call the same endpoint the CLI/extension use
 * (`GET /api/oauth/usage`). No token is ever sent anywhere but Anthropic's API,
 * and the call is read-only.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
/** Don't let a slow/unreachable feed hang the status indicator. */
const FETCH_TIMEOUT_MS = 8000

/** Files Claude Code may keep its OAuth credentials in (mirrors `looksLoggedIn`). */
const CRED_PATHS = [
  join(homedir(), '.claude', '.credentials.json'),
  join(homedir(), '.config', 'claude', '.credentials.json'),
  join(homedir(), '.claude.json')
]

interface OAuthCreds {
  accessToken?: string
}

/** Pull the OAuth access token out of the first readable credentials file. */
function readAccessToken(): string | null {
  for (const p of CRED_PATHS) {
    try {
      if (!existsSync(p)) continue
      const json = JSON.parse(readFileSync(p, 'utf8')) as { claudeAiOauth?: OAuthCreds }
      const token = json.claudeAiOauth?.accessToken
      if (typeof token === 'string' && token) return token
    } catch {
      /* unreadable / not JSON — try the next location */
    }
  }
  return null
}

// ---------- response shapes (only the fields we read) ----------

interface RawWindow {
  utilization?: number | null
  resets_at?: string | null
}

interface RawLimit {
  kind?: string
  group?: string
  percent?: number
  severity?: string
  resets_at?: string | null
}

interface UsagePayload {
  five_hour?: RawWindow | null
  seven_day?: RawWindow | null
  seven_day_opus?: RawWindow | null
  seven_day_sonnet?: RawWindow | null
  /** Pre-computed, cross-version list of active limit windows. */
  limits?: RawLimit[]
}

/** Friendly label for a limit window, matching the extension's vocabulary. */
function labelForKind(kind: string, group: string): string {
  const k = kind.toLowerCase()
  const g = group.toLowerCase()
  if (k.includes('opus')) return 'weekly Opus limit'
  if (k.includes('sonnet')) return 'weekly Sonnet limit'
  if (g === 'session' || k === 'session' || k.includes('5h') || k.includes('five')) return 'session limit'
  if (g === 'weekly' || k.includes('week') || k.includes('7d') || k.includes('seven')) return 'weekly limit'
  return 'usage limit'
}

/**
 * Normalize the raw usage payload into display windows, most-consumed first.
 * Prefers the server's pre-computed `limits[]` (it carries `percent`/`severity`
 * already), falling back to the named windows for older CLI versions.
 */
function normalize(data: UsagePayload): ClaudeUsageWindow[] {
  const out: ClaudeUsageWindow[] = []

  if (Array.isArray(data.limits) && data.limits.length) {
    for (const l of data.limits) {
      if (typeof l.percent !== 'number') continue
      out.push({
        label: labelForKind(l.kind ?? '', l.group ?? ''),
        percent: Math.round(l.percent),
        severity: l.severity ?? 'normal',
        resetsAt: l.resets_at ?? undefined
      })
    }
  } else {
    const named: [string, RawWindow | null | undefined][] = [
      ['session limit', data.five_hour],
      ['weekly limit', data.seven_day],
      ['weekly Opus limit', data.seven_day_opus],
      ['weekly Sonnet limit', data.seven_day_sonnet]
    ]
    for (const [label, w] of named) {
      if (!w || typeof w.utilization !== 'number') continue
      out.push({
        label,
        percent: Math.round(w.utilization),
        severity: w.utilization >= 80 ? 'warning' : 'normal',
        resetsAt: w.resets_at ?? undefined
      })
    }
  }

  // Highest utilization first → the binding constraint headlines.
  out.sort((a, b) => b.percent - a.percent)
  return out
}

export async function fetchClaudeUsage(): Promise<ClaudeUsageResult> {
  const token = readAccessToken()
  if (!token) {
    return { ok: false, loggedIn: false, windows: [], error: 'Not signed in to Claude Code.' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(USAGE_URL, {
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        // Same OAuth beta + version the CLI/extension send for this endpoint.
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        accept: 'application/json'
      }
    })
    if (!res.ok) {
      return { ok: false, loggedIn: true, windows: [], error: `Usage request failed (${res.status})` }
    }
    const data = (await res.json()) as UsagePayload
    const windows = normalize(data)
    return { ok: true, loggedIn: true, windows, headline: windows[0] }
  } catch (err) {
    return {
      ok: false,
      loggedIn: true,
      windows: [],
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    clearTimeout(timer)
  }
}
