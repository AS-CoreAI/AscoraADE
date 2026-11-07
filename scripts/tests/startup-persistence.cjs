// Run after npm run build: node scripts/tests/startup-persistence.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../../.build')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  fs.mkdirSync(root, { recursive: true })
  const profile = fs.mkdtempSync(path.join(root, 'startup-persistence-'))
  const env = { ...process.env, ASCORA_STARTUP_TEST_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    fs.writeFileSync(path.join(profile, 'ascora-store.json'), JSON.stringify({ settings: { fixture: true }, workspaces: [], tasks: [], usage: [] }))
    const child = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true, timeout: 15000 })
    assert.equal(child.status, 0)
    assert.ok(fs.existsSync(path.join(profile, 'ascora-store.db')))
    assert.ok(fs.existsSync(path.join(profile, 'ascora-store.json')))
  } finally {
    assert.equal(path.dirname(path.resolve(profile)), root)
    fs.rmSync(profile, { recursive: true, force: true })
  }
  process.exit(0)
}
const { app } = require('electron')
app.setName('Ascora startup persistence fixture')
app.setPath('userData', process.env.ASCORA_STARTUP_TEST_PROFILE)
app.disableHardwareAcceleration()
// Exercise the real bundled main process without renderer/account/network activity.
global.fetch = async () => { throw new Error('Network disabled in startup fixture') }
let warning
process.on('warning', value => { if (value.name === 'MaxListenersExceededWarning') warning = value })
app.on('browser-window-created', (_event, win) => {
  win.show = () => {}
  win.loadFile = () => win.loadURL('about:blank')
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      try {
        assert.equal(warning, undefined)
        assert.ok(app.listenerCount('before-quit') < 10)
        console.log(`Production startup OK: built-in SQLite, ${app.listenerCount('before-quit')} quit listeners, clean shutdown`)
        app.quit()
      } catch (error) { console.error(error); app.exit(1) }
    }, 50)
  })
})
setTimeout(() => { console.error('Startup fixture timed out'); app.exit(1) }, 10000).unref()
require('../../out/main/index.js')
