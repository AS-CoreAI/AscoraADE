import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import WebSocket from 'ws'
import {
  IPC,
  type OmnirouteAdminRequest,
  type OmnirouteAdminResponse,
  type OmnirouteLiveConnectRequest,
  type OmnirouteLiveEvent,
  type OmnirouteStatus
} from '../../shared/ipc'
import {
  getOmnirouteStatus,
  onOmnirouteStatusChanged,
  startOmniroute,
  stopOmniroute
} from '../omniroute/runner'
import { getStore } from '../store'

// Model calls made by the native Playground can legitimately take longer
// than ordinary management requests (cold provider/model, reasoning, etc.).
const ADMIN_TIMEOUT_MS = 120_000
const LIVE_BRIDGE_KEY_SETTING = 'omniroute.liveBridgeKey'
const LIVE_BRIDGE_KEY_NAME = '__ascora_live_bridge__'

interface LiveSocketEntry {
  ownerId: number
  socket: WebSocket
}

const liveSockets = new Map<string, LiveSocketEntry>()
const liveSocketOwners = new Set<number>()
let cachedLiveBridgeKey: string | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function liveSocketKey(ownerId: number, id: string): string {
  return `${ownerId}:${id}`
}

function closeLiveSocket(key: string): void {
  const entry = liveSockets.get(key)
  if (!entry) return
  liveSockets.delete(key)
  entry.socket.removeAllListeners()
  entry.socket.on('error', () => { /* expected when a connecting socket is cancelled */ })
  try {
    if (entry.socket.readyState === WebSocket.CONNECTING) entry.socket.terminate()
    else entry.socket.close()
  } catch { /* already closed */ }
}

function closeAllLiveSockets(): void {
  for (const key of [...liveSockets.keys()]) closeLiveSocket(key)
}

/** Proxy an admin REST call to the loopback sidecar from the main process
 *  (renderer fetch would trip over CORS/origin checks). */
async function adminRequest(req: OmnirouteAdminRequest): Promise<OmnirouteAdminResponse> {
  const status = getOmnirouteStatus()
  if (status.state !== 'ready' || !status.port) {
    return { ok: false, status: 0, body: null, error: 'OmniRoute is not running' }
  }
  if (typeof req.path !== 'string' || !req.path.startsWith('/api/')) {
    return { ok: false, status: 0, body: null, error: 'admin paths must start with /api/' }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${status.port}${req.path}`, {
      method: req.method,
      headers: req.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS)
    })
    let body: unknown = null
    const responseText = await res.text()
    if (responseText) {
      try {
        body = JSON.parse(responseText)
      } catch {
        // Replay and export endpoints may legitimately return SSE/plain text.
        // Preserve it instead of silently turning a successful response into null.
        body = responseText
      }
    }
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function getLiveBridgeKey(): Promise<string> {
  const stored = cachedLiveBridgeKey ?? getStore().getSetting<string>(LIVE_BRIDGE_KEY_SETTING) ?? ''
  if (stored) {
    const keyId = /^sk-([^-]+)-/.exec(stored)?.[1]
    if (keyId) {
      const response = await adminRequest({ method: 'GET', path: '/api/keys' })
      const root = isRecord(response.body) ? response.body : {}
      const keys = Array.isArray(root.keys) ? root.keys.filter(isRecord) : []
      if (response.ok && keys.some((key) => key.id === keyId && key.isActive !== false)) {
        cachedLiveBridgeKey = stored
        return stored
      }
    }
  }

  const response = await adminRequest({
    method: 'POST',
    path: '/api/keys',
    body: { name: LIVE_BRIDGE_KEY_NAME, label: LIVE_BRIDGE_KEY_NAME }
  })
  const body = isRecord(response.body) ? response.body : {}
  const key = typeof body.key === 'string' ? body.key : ''
  if (!response.ok || !key) throw new Error(response.error || 'Failed to create the Ascora live bridge key')
  cachedLiveBridgeKey = key
  getStore().setSetting(LIVE_BRIDGE_KEY_SETTING, key)
  return key
}

async function liveWebSocketUrl(): Promise<string> {
  const status = getOmnirouteStatus()
  if (status.state !== 'ready' || !status.port) throw new Error('OmniRoute is not running')
  const response = await adminRequest({ method: 'GET', path: '/api/v1/ws?handshake=1' })
  if (!response.ok) throw new Error(response.error || `Live handshake failed (${response.status})`)
  const root = isRecord(response.body) ? response.body : {}
  const protocol = isRecord(root.protocol) ? root.protocol : {}
  const live = isRecord(root.live) ? root.live : isRecord(protocol.live) ? protocol.live : {}
  const publicUrl = typeof live.publicUrl === 'string' ? live.publicUrl : ''
  if (publicUrl.startsWith('ws://') || publicUrl.startsWith('wss://')) {
    const parsed = new URL(publicUrl)
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('OmniRoute live bridge refused a non-loopback WebSocket URL')
    }
    parsed.hostname = '127.0.0.1'
    return parsed.toString()
  }
  const livePort = typeof live.port === 'number' && Number.isInteger(live.port) && live.port > 0 && live.port <= 65_535 ? live.port : status.port
  const path = typeof live.path === 'string' && live.path.startsWith('/') ? live.path : '/live-ws'
  return `ws://127.0.0.1:${livePort}${path}`
}

export function registerOmnirouteHandlers(): void {
  ipcMain.handle(IPC.omniroute.status, (): OmnirouteStatus => getOmnirouteStatus())
  ipcMain.handle(IPC.omniroute.start, (): Promise<OmnirouteStatus> => startOmniroute())
  ipcMain.handle(IPC.omniroute.stop, async (): Promise<OmnirouteStatus> => {
    await stopOmniroute()
    return getOmnirouteStatus()
  })
  ipcMain.handle(
    IPC.omniroute.admin,
    (_event: IpcMainInvokeEvent, req: OmnirouteAdminRequest): Promise<OmnirouteAdminResponse> => adminRequest(req)
  )
  ipcMain.handle(IPC.omniroute.liveConnect, async (event: IpcMainInvokeEvent, req: OmnirouteLiveConnectRequest): Promise<void> => {
    if (!req || typeof req.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(req.id) || req.channel !== 'combo') {
      throw new Error('Invalid OmniRoute live subscription')
    }
    const ownerId = event.sender.id
    const mapKey = liveSocketKey(ownerId, req.id)
    closeLiveSocket(mapKey)
    const [url, apiKey] = await Promise.all([liveWebSocketUrl(), getLiveBridgeKey()])
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    liveSockets.set(mapKey, { ownerId, socket })
    const send = (payload: Omit<OmnirouteLiveEvent, 'id'>): void => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.omniroute.liveEvent, { id: req.id, ...payload } satisfies OmnirouteLiveEvent)
    }
    socket.on('open', () => {
      send({ state: 'open' })
      socket.send(JSON.stringify({ type: 'subscribe', channels: [req.channel] }))
    })
    socket.on('message', (raw) => {
      const text = raw.toString()
      try { send({ state: 'message', data: JSON.parse(text) as unknown }) }
      catch { send({ state: 'message', data: text }) }
    })
    socket.on('error', (error) => send({ state: 'error', error: error.message }))
    socket.on('close', (_code, reason) => {
      if (liveSockets.get(mapKey)?.socket === socket) liveSockets.delete(mapKey)
      send({ state: 'closed', error: reason.toString() || undefined })
    })
    if (!liveSocketOwners.has(ownerId)) {
      liveSocketOwners.add(ownerId)
      event.sender.once('destroyed', () => {
        liveSocketOwners.delete(ownerId)
        for (const [key, entry] of liveSockets) if (entry.ownerId === ownerId) closeLiveSocket(key)
      })
    }
  })
  ipcMain.handle(IPC.omniroute.liveDisconnect, (event: IpcMainInvokeEvent, id: string): void => {
    if (typeof id === 'string') closeLiveSocket(liveSocketKey(event.sender.id, id))
  })

  onOmnirouteStatusChanged((status) => {
    if (status.state !== 'ready') closeAllLiveSockets()
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(IPC.omniroute.statusChanged, status)
      } catch {
        // A window may disappear between getAllWindows() and send().
      }
    }
  })

  // Warm start: if OmniRoute was the active provider last session, bring the
  // sidecar up in the background so the first chat doesn't wait for boot.
  if (getStore().getSetting<string>('llm.provider') === 'omniroute') {
    void startOmniroute().catch(() => {
      /* surfaced via status */
    })
  }
}
