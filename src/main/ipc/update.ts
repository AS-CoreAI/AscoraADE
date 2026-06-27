import { app, ipcMain, shell } from 'electron'
import { IPC, type UpdateInfo } from '@shared/ipc'

/**
 * Update checker. Probes the marketing site's release feed
 * (https://ade.ascoreai.com/api/releases/latest) and compares the published
 * version to this build's own. The renderer drives the title-bar "Update" badge
 * from the result and opens the download page on click.
 *
 * The site is the single source of truth: builds are published from its /control
 * panel into Vercel KV, and the public `latest` endpoint serves them here.
 */

/** Base URL of the website that publishes releases. */
const UPDATE_HOST = 'https://ade.ascoreai.com'
const LATEST_URL = `${UPDATE_HOST}/api/releases/latest`
/** Where the badge sends the user — the site's download section. */
const DOWNLOAD_PAGE = `${UPDATE_HOST}/#download`
/** Give up on a slow/unreachable feed rather than hang the badge. */
const FETCH_TIMEOUT_MS = 8000

/** Shape of the public `/api/releases/latest` payload we depend on. */
interface LatestPayload {
  version?: string
  notes?: string
  url?: string
}

/**
 * Compare two dotted version strings (e.g. "0.2.0" vs "0.10.1"). Returns a
 * positive number when `a` is newer, negative when older, 0 when equal. Numeric
 * components are compared as integers so 0.10 > 0.9; a non-numeric suffix on the
 * patch (e.g. "1.2.0-beta.1") sorts before its release ("1.2.0").
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2)
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0)
    return { nums, pre }
  }
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (diff !== 0) return diff
  }
  // Equal core: a prerelease (non-empty `pre`) is older than the release.
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

async function fetchLatest(): Promise<LatestPayload | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(LATEST_URL, {
      signal: controller.signal,
      // `cache-control` (plus the endpoint's own no-store headers) keeps a
      // just-published build from being masked by a stale cached response.
      headers: { accept: 'application/json', 'cache-control': 'no-cache' }
    })
    if (!res.ok) return null
    const data = (await res.json()) as LatestPayload
    return data && typeof data.version === 'string' ? data : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const latest = await fetchLatest()
  if (!latest?.version) {
    return { ok: false, current, updateAvailable: false, error: 'Could not reach the update server.' }
  }
  return {
    ok: true,
    current,
    latest: latest.version,
    updateAvailable: compareVersions(latest.version, current) > 0,
    notes: latest.notes,
    url: latest.url || DOWNLOAD_PAGE
  }
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.update.check, (): Promise<UpdateInfo> => checkForUpdate())
  ipcMain.handle(IPC.update.openDownload, async (_e, url?: string): Promise<void> => {
    await shell.openExternal(url || DOWNLOAD_PAGE)
  })
}
