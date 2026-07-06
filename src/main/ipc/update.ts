import { app, ipcMain, shell } from 'electron'
import { IPC, type ChangelogInfo, type ReleaseEntry, type UpdateInfo } from '@shared/ipc'

/**
 * Update checker. Probes the marketing site's release feed first
 * (https://ade.ascoreai.com/api/releases/latest), falls back to GitHub
 * Releases when the site is unreachable, and compares the published version to
 * this build's own. The renderer drives the title-bar "Update" badge from the
 * result; clicking it opens a modal listing the changelog of newer releases
 * (see `fetchChangelog`) with a button to the download/release page.
 *
 * The site remains the primary source of truth: builds are published from its
 * /control panel into Vercel KV, and the public `latest` endpoint serves them
 * here. GitHub is a resilience fallback for outages.
 */

/** Base URL of the website that publishes releases. */
const UPDATE_HOST = 'https://ade.ascoreai.com'
const LATEST_URL = `${UPDATE_HOST}/api/releases/latest`
/** Full release list backing the site's /changelog page. */
const RELEASES_URL = `${UPDATE_HOST}/api/releases`
/** Where the badge sends the user — the site's download section. */
const DOWNLOAD_PAGE = `${UPDATE_HOST}/#download`
/** Public GitHub releases feed used only when the site feed cannot be reached. */
const GITHUB_RELEASES_PAGE = 'https://github.com/AS-CoreAI/Ascora-ADE/releases'
const GITHUB_LATEST_URL = 'https://api.github.com/repos/AS-CoreAI/Ascora-ADE/releases/latest'
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/AS-CoreAI/Ascora-ADE/releases?per_page=20'
/** Give up on a slow/unreachable feed rather than hang the badge. */
const FETCH_TIMEOUT_MS = 8000

/** Shape of the public `/api/releases/latest` payload we depend on. */
interface LatestPayload {
  version?: string
  notes?: string
  url?: string
}

/** Shape of the GitHub `releases/latest` payload we depend on. */
interface GitHubLatestPayload {
  tag_name?: string
  body?: string
  html_url?: string
}

/** Shape of one entry in the site's `/api/releases` list we depend on. */
interface ReleasesPayload {
  releases?: { version?: string; date?: string; notes?: string }[]
}

/** Shape of one entry in GitHub's `releases` list we depend on. */
interface GitHubReleaseItem {
  tag_name?: string
  published_at?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
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

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // `cache-control` (plus the endpoint's own no-store headers) keeps a
      // just-published build from being masked by a stale cached response.
      headers
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchLatestFromWebsite(): Promise<LatestPayload | null> {
  const data = await fetchJson<LatestPayload>(LATEST_URL, {
    accept: 'application/json',
    'cache-control': 'no-cache'
  })
  if (!data || typeof data.version !== 'string' || !data.version.trim()) return null
  return { ...data, version: data.version.trim() }
}

async function fetchLatestFromGitHub(): Promise<LatestPayload | null> {
  const data = await fetchJson<GitHubLatestPayload>(GITHUB_LATEST_URL, {
    accept: 'application/vnd.github+json',
    'cache-control': 'no-cache',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Ascora-ADE'
  })
  if (!data || typeof data.tag_name !== 'string' || !data.tag_name.trim()) return null
  return {
    version: data.tag_name.trim(),
    notes: typeof data.body === 'string' ? data.body : undefined,
    url: typeof data.html_url === 'string' ? data.html_url : GITHUB_RELEASES_PAGE
  }
}

async function fetchLatest(): Promise<LatestPayload | null> {
  return (await fetchLatestFromWebsite()) ?? (await fetchLatestFromGitHub())
}

async function fetchReleasesFromWebsite(): Promise<ReleaseEntry[] | null> {
  const data = await fetchJson<ReleasesPayload>(RELEASES_URL, {
    accept: 'application/json',
    'cache-control': 'no-cache'
  })
  if (!data || !Array.isArray(data.releases)) return null
  const releases = data.releases
    .filter((r) => typeof r.version === 'string' && r.version.trim())
    .map((r) => ({
      version: r.version!.trim(),
      date: typeof r.date === 'string' ? r.date : undefined,
      notes: typeof r.notes === 'string' ? r.notes : undefined
    }))
  return releases.length > 0 ? releases : null
}

async function fetchReleasesFromGitHub(): Promise<ReleaseEntry[] | null> {
  const data = await fetchJson<GitHubReleaseItem[]>(GITHUB_RELEASES_URL, {
    accept: 'application/vnd.github+json',
    'cache-control': 'no-cache',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Ascora-ADE'
  })
  if (!Array.isArray(data)) return null
  const releases = data
    .filter((r) => !r.draft && !r.prerelease && typeof r.tag_name === 'string' && r.tag_name.trim())
    .map((r) => ({
      // Tags are "v1.2.0"; show the bare version like the site feed does.
      version: r.tag_name!.trim().replace(/^v/i, ''),
      date: typeof r.published_at === 'string' ? r.published_at : undefined,
      notes: typeof r.body === 'string' ? r.body : undefined
    }))
  return releases.length > 0 ? releases : null
}

/**
 * Fetch the changelog shown in the update modal: every published release newer
 * than the running build, newest first. Uses the site's release list first and
 * GitHub's when the site is unreachable; `url` points at the matching page so
 * the modal's "Update" button follows whichever source actually answered.
 */
async function fetchChangelog(): Promise<ChangelogInfo> {
  const current = app.getVersion()
  const site = await fetchReleasesFromWebsite()
  const all = site ?? (await fetchReleasesFromGitHub())
  if (!all) {
    return {
      ok: false,
      releases: [],
      error: 'Could not reach the update server or GitHub releases.'
    }
  }
  const releases = all
    .filter((r) => compareVersions(r.version, current) > 0)
    .sort((a, b) => compareVersions(b.version, a.version))
  return {
    ok: true,
    source: site ? 'website' : 'github',
    releases,
    url: site ? DOWNLOAD_PAGE : GITHUB_RELEASES_PAGE
  }
}

async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const latest = await fetchLatest()
  if (!latest?.version) {
    return {
      ok: false,
      current,
      updateAvailable: false,
      error: 'Could not reach the update server or GitHub releases.'
    }
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
  ipcMain.handle(IPC.update.changelog, (): Promise<ChangelogInfo> => fetchChangelog())
  ipcMain.handle(IPC.update.openDownload, async (_e, url?: string): Promise<void> => {
    await shell.openExternal(url || DOWNLOAD_PAGE)
  })
}
