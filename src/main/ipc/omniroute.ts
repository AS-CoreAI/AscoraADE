import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  IPC,
  type OmnirouteAdminRequest,
  type OmnirouteAdminResponse,
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
    try {
      body = await res.json()
    } catch {
      /* non-JSON responses (e.g. 204) are fine */
    }
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err instanceof Error ? err.message : String(err) }
  }
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

  onOmnirouteStatusChanged((status) => {
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
