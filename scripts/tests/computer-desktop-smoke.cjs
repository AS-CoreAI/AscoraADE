// Windows-only, read-only desktop integration check. Never clicks or types.
// node scripts/tests/computer-desktop-smoke.cjs [loaded-model-id]
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}
const electron = require('electron')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { loadTypeScript } = require('./llm-fixture.cjs')
electron.app.whenReady().then(async () => {
  if (process.platform !== 'win32') { console.log('Windows desktop smoke skipped'); electron.app.exit(0); return }
  const { DEFAULT_LLM_CONFIG, IPC } = loadTypeScript('src/shared/ipc.ts')
  const config = { ...DEFAULT_LLM_CONFIG, model: process.argv[2] || 'qwen/qwen3.8-27b' }
  const handlers = new Map()
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => {} })
  const overrides = {
    electron: { ...electron, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } },
    './llm': { readConfig: () => config },
    '../llm/client': loadTypeScript('src/main/llm/client.ts'),
    '../computer/windows': loadTypeScript('src/main/computer/windows.ts')
  }
  loadTypeScript('src/main/ipc/computer.ts', overrides).registerComputerHandlers()
  const event = { sender: owner }
  const started = await handlers.get(IPC.computer.start)(event, 'desktop-smoke', config.model)
  assert.equal(started.ok, true, started.error)
  try {
    const result = await handlers.get(IPC.computer.action)(event, started.sessionId, { action: 'screenshot' })
    assert.equal(result.ok, true, result.error)
    assert.ok(result.frame.width > 0 && result.frame.height > 0)
    assert.match(result.frame.image, /^data:image\/jpeg;base64,/)
    console.log(`Desktop capture OK: ${result.frame.width} x ${result.frame.height}; native focus probe and emergency shortcut registered. No input executed or screenshot saved.`)
  } finally { await handlers.get(IPC.computer.stop)(event, started.sessionId) }
  assert.equal(electron.globalShortcut.isRegistered('CommandOrControl+Alt+Escape'), false)
  electron.app.exit(0)
}).catch(error => { console.error(error.message); electron.app.exit(1) })
