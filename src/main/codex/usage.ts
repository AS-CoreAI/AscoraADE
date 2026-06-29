import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CodexUsageResult, UsageLimitWindow } from '@shared/ipc'
import { resolveCodexPath } from './runner'

/**
 * Reads Codex account rate limits through the CLI app-server protocol.
 *
 * The interactive Codex TUI exposes this as `/usage`, but there is no top-level
 * `codex usage` command. `codex app-server --stdio` provides a JSONL method
 * (`account/rateLimits/read`) that returns the same account windows.
 */

const FETCH_TIMEOUT_MS = 12000

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  const rec = asRecord(error)
  if (!rec) return 'Codex usage request failed.'
  return asStr(rec.message) ?? asStr(rec.code) ?? JSON.stringify(rec)
}

function send(child: ChildProcessWithoutNullStreams, payload: JsonRecord): void {
  child.stdin.write(`${JSON.stringify(payload)}\n`)
}

function readRateLimits(path: string): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(path, ['app-server', '--stdio'], { windowsHide: true, env: process.env })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    let settled = false
    let stdoutBuf = ''
    let stderr = ''

    const cleanup = (): void => {
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const done = (result: JsonRecord): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const timer = setTimeout(() => fail(new Error('Codex usage request timed out.')), FETCH_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue

        let obj: JsonRecord
        try {
          obj = JSON.parse(line) as JsonRecord
        } catch {
          continue
        }

        if (obj.id === 1) {
          if ('error' in obj) {
            fail(new Error(errorMessage(obj.error)))
          } else {
            send(child, { id: 2, method: 'account/rateLimits/read' })
          }
        } else if (obj.id === 2) {
          if ('error' in obj) fail(new Error(errorMessage(obj.error)))
          else done(asRecord(obj.result) ?? {})
        }
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (err) => fail(err))
    child.on('close', (code) => {
      if (settled) return
      const detail = stripAnsi(stderr).trim()
      fail(new Error(detail || `codex app-server exited with code ${code}`))
    })

    send(child, {
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'ascora-ade', title: 'Ascora ADE', version: app.getVersion() },
        capabilities: null
      }
    })
  })
}

function severity(percent: number): UsageLimitWindow['severity'] {
  if (percent >= 95) return 'critical'
  if (percent >= 80) return 'warning'
  return 'normal'
}

function formatLimitName(snapshot: JsonRecord): string {
  const name = asStr(snapshot.limitName)
  if (name) return name
  const id = asStr(snapshot.limitId)
  if (!id || id.toLowerCase() === 'codex') return ''
  return id.replace(/[_-]+/g, ' ')
}

function windowKindLabel(durationMins: number | null, fallback: 'primary' | 'secondary'): string {
  if (durationMins != null) {
    if (durationMins <= 6 * 60) return 'session limit'
    if (durationMins <= 36 * 60) return 'daily limit'
    if (durationMins >= 6 * 24 * 60 && durationMins <= 8 * 24 * 60) return 'weekly limit'
    if (durationMins >= 27 * 24 * 60 && durationMins <= 32 * 24 * 60) return 'monthly limit'
    if (durationMins < 24 * 60) return `${Math.round(durationMins / 60)}h limit`
    return `${Math.round(durationMins / (24 * 60))}d limit`
  }
  return fallback === 'primary' ? 'session limit' : 'weekly limit'
}

function resetIso(value: unknown): string | undefined {
  const raw = asNum(value)
  if (raw == null || raw <= 0) return undefined
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function normalizeWindow(
  snapshot: JsonRecord,
  key: 'primary' | 'secondary'
): UsageLimitWindow | null {
  const win = asRecord(snapshot[key])
  if (!win) return null
  const percent = asNum(win.usedPercent)
  if (percent == null) return null

  const limitName = formatLimitName(snapshot)
  const label = windowKindLabel(asNum(win.windowDurationMins), key)
  return {
    label: limitName ? `${limitName} ${label}` : label,
    percent: Math.round(percent),
    severity: severity(percent),
    resetsAt: resetIso(win.resetsAt)
  }
}

function snapshotsFrom(result: JsonRecord): JsonRecord[] {
  const byId = asRecord(result.rateLimitsByLimitId)
  if (byId) {
    const snapshots = Object.values(byId).map(asRecord).filter((v): v is JsonRecord => !!v)
    if (snapshots.length) return snapshots
  }
  const single = asRecord(result.rateLimits)
  return single ? [single] : []
}

function normalize(result: JsonRecord): UsageLimitWindow[] {
  const windows: UsageLimitWindow[] = []
  for (const snapshot of snapshotsFrom(result)) {
    const primary = normalizeWindow(snapshot, 'primary')
    const secondary = normalizeWindow(snapshot, 'secondary')
    if (primary) windows.push(primary)
    if (secondary) windows.push(secondary)
  }
  windows.sort((a, b) => b.percent - a.percent)
  return windows
}

export async function fetchCodexUsage(configured?: string): Promise<CodexUsageResult> {
  const { path, found } = resolveCodexPath(configured)
  if (!found) {
    return { ok: false, loggedIn: false, windows: [], error: 'Codex CLI not found.' }
  }

  try {
    const data = await readRateLimits(path)
    const windows = normalize(data)
    return { ok: true, loggedIn: true, windows, headline: windows[0] }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      loggedIn: !/unauthori[sz]ed|not logged in|authentication/i.test(error),
      windows: [],
      error
    }
  }
}
