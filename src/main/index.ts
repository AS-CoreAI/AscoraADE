import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerIpc } from './ipc'
import { getStore, closeStore } from './store'
import { stopLiveServer } from './ipc/live'
import { startPresence, stopPresence } from './presence'
import { stopAllBlueprints } from './blueprint/runner'

// Single-instance lock: focus the existing window instead of opening a second.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.ascora.ade')
    getStore() // initialise persistence early
    registerIpc()
    createMainWindow()
    startPresence() // anonymous "running now" heartbeat to the website

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    stopAllBlueprints()
    stopPresence()
    stopLiveServer()
    closeStore()
  })
}
