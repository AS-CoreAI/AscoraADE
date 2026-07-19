import { isIP } from 'node:net'
import { BrowserWindow } from 'electron'
import { IPC, type PublicIpStatus } from '../../shared/ipc'

const CACHE_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 6_000
const RESTRICTED_COUNTRIES = new Set(['BY', 'RU'])

let status: PublicIpStatus = {
  state: 'checking',
  ip: null,
  countryCode: null,
  vpnRecommended: false,
  checkedAt: null
}
let pending: Promise<PublicIpStatus> | null = null

function publish(next: PublicIpStatus): PublicIpStatus {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.network.statusChanged, next)
  }
  return next
}

function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) && normalized !== 'XX' ? normalized : null
}

function result(ip: unknown, country: unknown): PublicIpStatus {
  const normalizedIp = typeof ip === 'string' ? ip.trim() : ''
  if (!isIP(normalizedIp)) throw new Error('The public IP service returned an invalid address.')
  const normalizedCountry = countryCode(country)
  return {
    state: 'ready',
    ip: normalizedIp,
    countryCode: normalizedCountry,
    vpnRecommended: normalizedCountry ? RESTRICTED_COUNTRIES.has(normalizedCountry) : false,
    checkedAt: Date.now()
  }
}

async function fetchCloudflareTrace(): Promise<PublicIpStatus> {
  const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Cloudflare trace returned HTTP ${response.status}.`)
  const fields = Object.fromEntries(
    (await response.text())
      .split(/\r?\n/)
      .map((line) => line.split('=', 2))
      .filter((pair): pair is [string, string] => pair.length === 2)
  )
  return result(fields.ip, fields.loc)
}

async function fetchCountryIs(): Promise<PublicIpStatus> {
  const response = await fetch('https://api.country.is/', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Country.is returned HTTP ${response.status}.`)
  const body = (await response.json()) as { ip?: unknown; country?: unknown }
  return result(body.ip, body.country)
}

async function refresh(): Promise<PublicIpStatus> {
  publish({ ...status, state: 'checking', error: undefined })
  const errors: string[] = []
  for (const source of [fetchCloudflareTrace, fetchCountryIs]) {
    try {
      return publish(await source())
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return publish({
    state: 'error',
    ip: status.ip,
    countryCode: status.countryCode,
    vpnRecommended: status.vpnRecommended,
    checkedAt: Date.now(),
    error: errors.join(' ')
  })
}

/** Cached public egress lookup. A forced refresh is used after VPN state changes. */
export function getPublicIpStatus(force = false): Promise<PublicIpStatus> {
  const fresh = status.checkedAt !== null && Date.now() - status.checkedAt < CACHE_MS
  if (!force && fresh && status.state !== 'checking') return Promise.resolve(status)
  if (pending) return pending
  pending = refresh().finally(() => {
    pending = null
  })
  return pending
}

