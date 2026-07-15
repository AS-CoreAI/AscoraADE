import { app, BrowserWindow, type Event } from 'electron'
import { createMainWindow } from './window'
import { registerIpc } from './ipc'
import { getStore, closeStore } from './store'
import { stopLiveServer } from './ipc/live'
import { stopOmniroute } from './omniroute/runner'
import { startPresence, stopPresence } from './presence'
import { stopAllBlueprints } from './blueprint/runner'

// WProvider sign-in pages must look like an ordinary interactive Chromium tab.
// In particular, Cloudflare Turnstile on Grok loops indefinitely when Blink
// advertises an automation-controlled environment even after a valid solve.
// This does not bypass a challenge; it lets the user's successful solve stick.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')

// Keep provider sign-in on the password/2FA path. Chromium's automatic
// passkey discovery can otherwise hand the request to Windows WebAuthn and
// open the native "Windows Security — choose a passkey" dialog without an
// explicit user action. The Windows-only flag is ignored on macOS/Linux.
app.commandLine.appendSwitch(
  'disable-features',
  [
    'WebAuthenticationUseNativeWinApi',
    'WebAuthenticationPasskeyUpgrade',
    'WebAuthenticationImmediateGet',
    'WebAuthenticationImmediateGetAutoselect'
  ].join(',')
)

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

  let quitCleanupStarted = false
  app.on('before-quit', (event: Event) => {
    // OmniRoute owns a worker process beneath its CLI process. Keep Electron
    // alive until taskkill/signals have reaped the complete tree and released
    // its port; otherwise a quick relaunch can collide with an orphan.
    if (quitCleanupStarted) return
    event.preventDefault()
    quitCleanupStarted = true
    stopAllBlueprints()
    stopPresence()
    stopLiveServer()
    void stopOmniroute().finally(() => {
      closeStore()
      app.quit()
    })
  })
}
