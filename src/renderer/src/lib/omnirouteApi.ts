import type { OmnirouteAdminRequest } from '@shared/ipc'
import { api } from '@/lib/api'

export type OmniRecord = Record<string, unknown>

export function isRecord(value: unknown): value is OmniRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function omniList(value: unknown, ...keys: string[]): OmniRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []
  for (const key of keys) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate.filter(isRecord)
  }
  return []
}

export function omniText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export function omniNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function omniBool(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 'active' || value === 'healthy'
}

function responseError(body: unknown, status: number, fallback?: string): string {
  if (isRecord(body)) {
    for (const key of ['error', 'message', 'detail']) {
      const value = body[key]
      if (typeof value === 'string' && value.trim()) return value
      if (isRecord(value) && typeof value.message === 'string') return value.message
    }
  }
  return fallback || `OmniRoute API returned ${status || 'a network error'}`
}

export async function omniRequest<T = unknown>(
  method: OmnirouteAdminRequest['method'],
  path: string,
  body?: unknown
): Promise<T> {
  const response = await api.omniroute.admin({ method, path, ...(body === undefined ? {} : { body }) })
  if (!response.ok) throw new Error(responseError(response.body, response.status, response.error))
  return response.body as T
}

export function omniId(record: OmniRecord): string {
  return omniText(record.id ?? record.connectionId ?? record.keyId ?? record.poolId ?? record.toolId)
}

export function omniLabel(record: OmniRecord, fallback = '—'): string {
  return omniText(
    record.name ?? record.label ?? record.provider ?? record.model ?? record.id ?? record.toolId,
    fallback
  )
}

export function formatOmniDate(value: unknown, locale: string): string {
  const raw = omniText(value)
  if (!raw) return '—'
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatOmniJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
