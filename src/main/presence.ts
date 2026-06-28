import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { getStore } from './store'

/**
 * Anonymous presence heartbeat. While the app is open it periodically pings the
 * marketing site so it can show a live "running now" count
 * (https://ade.ascoreai.com). The payload is a random, per-install id plus the
 * version and OS family — no path, workspace, account, or content data.
 *
 * Best-effort by design: every failure is swallowed so an offline or air-gapped
 * user never sees an error or a hang. The server expires stale instances on its
 * own, so simply stopping the heartbeat on quit is enough.
 */

const PRESENCE_URL = 'https://ade.ascoreai.com/api/presence/heartbeat'
/** Beat once a minute; the server treats an instance as live for ~2.5x this. */
const HEARTBEAT_MS = 60_000
/** Give up on a slow/unreachable endpoint rather than pile up requests. */
const FETCH_TIMEOUT_MS = 8000

const INSTANCE_ID_KEY = 'presence.instanceId'

let timer: NodeJS.Timeout | null = null

/** Stable anonymous id for this install, created once and persisted. */
function instanceId(): string {
  const store = getStore()
  let id = store.getSetting<string>(INSTANCE_ID_KEY)
  if (!id) {
    id = randomUUID()
    store.setSetting(INSTANCE_ID_KEY, id)
  }
  return id
}

async function sendHeartbeat(): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    await fetch(PRESENCE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: instanceId(),
        version: app.getVersion(),
        platform: process.platform
      })
    })
  } catch {
    // Offline / unreachable — ignore until the next beat.
  } finally {
    clearTimeout(timeout)
  }
}

/** Begin heartbeating: once immediately, then on an interval. */
export function startPresence(): void {
  if (timer) return
  void sendHeartbeat()
  timer = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS)
  // Don't let the heartbeat keep the process alive on its own.
  timer.unref?.()
}

/** Stop heartbeating (on quit). The server expires this instance shortly after. */
export function stopPresence(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
