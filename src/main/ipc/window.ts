import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'

/** Window controls for the custom (frameless) title bar. */
export function registerWindowHandlers(): void {
  const wc = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender)

  ipcMain.handle(IPC.window.minimize, (e) => wc(e)?.minimize())
  ipcMain.handle(IPC.window.maximizeToggle, (e) => {
    const win = wc(e)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.window.close, (e) => wc(e)?.close())
  ipcMain.handle(IPC.window.isMaximized, (e) => wc(e)?.isMaximized() ?? false)
}
