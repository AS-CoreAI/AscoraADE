import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { getStore } from './store'

interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
}

const DEFAULT_BOUNDS: WindowBounds = { width: 1280, height: 820 }
const APP_ICON = join(__dirname, '../../ascora-ade-favicon.png')

export function createMainWindow(): BrowserWindow {
  const store = getStore()
  const saved = store.getSetting<WindowBounds>('window.bounds') ?? DEFAULT_BOUNDS

  const win = new BrowserWindow({
    ...saved,
    minWidth: 940,
    minHeight: 600,
    show: false,
    icon: APP_ICON,
    frame: false, // custom ZCode-style title bar in the renderer
    backgroundColor: '#1b1b1d',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Persist size/position on change (debounced via the store's own flush).
  const saveBounds = () => store.setSetting('window.bounds', win.getBounds())
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)

  // External links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
