import { createServer, type Server, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC, EXCLUDED_DIRS, type LiveServerResult } from '@shared/ipc'

/**
 * A tiny static file server with live reload, the engine behind the editor's
 * "Go Live" button (a built-in Live Server for HTML preview). It serves the
 * active workspace folder over http://127.0.0.1, injects an EventSource snippet
 * into every HTML response, and pushes a "reload" event whenever a watched file
 * under the root changes. SSE keeps this dependency-free (no `ws`).
 */

const HOST = '127.0.0.1'
/** Preferred ports (VS Code's Live Server default first); 0 = let the OS pick. */
const PORTS = [5500, 5501, 5502, 5503, 5504, 0]
const RELOAD_PATH = '/__ascora_livereload'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg'
}

const RELOAD_SNIPPET =
  `<script>(function(){try{var s=new EventSource(${JSON.stringify(RELOAD_PATH)});` +
  `s.onmessage=function(e){if(e.data==="reload")location.reload();};}catch(_){}})();</script>`

interface LiveInstance {
  root: string
  port: number
  server: Server
  watcher: FSWatcher | null
  clients: Set<ServerResponse>
}

let live: LiveInstance | null = null

function contentType(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function decodePath(url: string): string {
  const noQuery = url.split('?')[0].split('#')[0]
  try {
    return decodeURIComponent(noQuery)
  } catch {
    return noQuery
  }
}

/** Resolve a request path to a real file under `root`, or null (404 / unsafe). */
async function resolveFile(root: string, urlPath: string): Promise<string | null> {
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  const target = resolve(root, rel)
  // Never serve anything outside the workspace root.
  if (target !== root && !target.startsWith(root + sep)) return null
  try {
    const info = await stat(target)
    if (!info.isDirectory()) return target
    const index = join(target, 'index.html')
    const idx = await stat(index).catch(() => null)
    return idx?.isFile() ? index : null
  } catch {
    return null
  }
}

function broadcastReload(instance: LiveInstance): void {
  for (const client of instance.clients) {
    try {
      client.write('data: reload\n\n')
    } catch {
      instance.clients.delete(client)
    }
  }
}

function startWatcher(root: string, onChange: () => void): FSWatcher | null {
  const ignored = [...EXCLUDED_DIRS]
  try {
    let timer: NodeJS.Timeout | null = null
    return watch(root, { recursive: true }, (_event, filename) => {
      const name = filename?.toString() ?? ''
      // Skip churn from dependency/build/VCS directories.
      if (ignored.some((dir) => name === dir || name.startsWith(dir + sep) || name.includes(sep + dir + sep))) {
        return
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 120)
    })
  } catch {
    // Recursive watch can be unsupported on some platforms — preview still works
    // without auto-reload.
    return null
  }
}

function createLiveServer(root: string): Server {
  return createServer(async (req, res) => {
    const url = req.url ?? '/'
    if (url.split('?')[0] === RELOAD_PATH) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      })
      res.write('retry: 1000\n\n')
      if (live) {
        live.clients.add(res)
        req.on('close', () => live?.clients.delete(res))
      }
      return
    }

    const filePath = await resolveFile(root, decodePath(url))
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found')
      return
    }

    const type = contentType(filePath)
    try {
      if (type.startsWith('text/html')) {
        const html = await readFile(filePath, 'utf8')
        const withReload = html.includes('</body>')
          ? html.replace('</body>', `${RELOAD_SNIPPET}</body>`)
          : html + RELOAD_SNIPPET
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
        res.end(withReload)
        return
      }
      const buffer = await readFile(filePath)
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
      res.end(buffer)
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500 Internal Server Error')
    }
  })
}

/** Listen on the first free port from `PORTS` (the trailing 0 always succeeds). */
function listenOnFreePort(server: Server, ports: number[]): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    let i = 0
    const attempt = (): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code === 'EADDRINUSE' && i < ports.length - 1) {
          i += 1
          attempt()
        } else {
          rejectListen(err)
        }
      }
      server.once('error', onError)
      server.listen(ports[i], HOST, () => {
        server.removeListener('error', onError)
        resolveListen((server.address() as AddressInfo).port)
      })
    }
    attempt()
  })
}

export function stopLiveServer(): void {
  const instance = live
  if (!instance) return
  live = null
  instance.watcher?.close()
  for (const client of instance.clients) {
    try {
      client.end()
    } catch {
      /* already closed */
    }
  }
  instance.clients.clear()
  instance.server.close()
}

async function startLiveServer(root: string): Promise<LiveServerResult> {
  try {
    const normalizedRoot = resolve(root)
    const info = await stat(normalizedRoot).catch(() => null)
    if (!info?.isDirectory()) return { ok: false, error: 'Workspace folder not found.' }

    if (live && live.root === normalizedRoot) {
      return { ok: true, url: `http://${HOST}:${live.port}`, port: live.port, root: live.root }
    }
    stopLiveServer()

    const server = createLiveServer(normalizedRoot)
    const port = await listenOnFreePort(server, PORTS)
    const instance: LiveInstance = {
      root: normalizedRoot,
      port,
      server,
      watcher: null,
      clients: new Set()
    }
    live = instance
    instance.watcher = startWatcher(normalizedRoot, () => broadcastReload(instance))
    return { ok: true, url: `http://${HOST}:${port}`, port, root: normalizedRoot }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---- Detached preview window (the "pop out into a separate window" mode) ----

let previewWindow: BrowserWindow | null = null

/** Notify every app window (except the preview itself) that detach mode ended. */
function notifyPreviewWindowClosed(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== previewWindow && !win.isDestroyed()) {
      win.webContents.send(IPC.live.windowClosed)
    }
  }
}

function openPreviewWindow(url: string): void {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.loadURL(url)
    previewWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    title: 'Live Preview',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  previewWindow = win
  win.on('closed', () => {
    previewWindow = null
    notifyPreviewWindowClosed()
  })
  win.loadURL(url)
}

export function closePreviewWindow(): void {
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close()
  previewWindow = null
}

export function registerLiveHandlers(): void {
  ipcMain.handle(IPC.live.start, (_e, root: string): Promise<LiveServerResult> =>
    startLiveServer(root)
  )
  ipcMain.handle(IPC.live.stop, (): { ok: boolean } => {
    stopLiveServer()
    closePreviewWindow()
    return { ok: true }
  })
  ipcMain.handle(IPC.live.openExternal, async (_e, url: string): Promise<void> => {
    await shell.openExternal(url)
  })
  ipcMain.handle(IPC.live.openWindow, (_e, url: string): void => openPreviewWindow(url))
  ipcMain.handle(IPC.live.closeWindow, (): void => closePreviewWindow())
}
