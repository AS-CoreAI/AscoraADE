// Run after npm run build. Isolated profile and mocked IPC; no live VPN changes.
const { join, resolve } = require('node:path')
const { mkdirSync } = require('node:fs')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const output = resolve(__dirname, '../../.build/vpn-auth-ui')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.disableHardwareAcceleration()
let win
const evaluate = code => win.webContents.executeJavaScript(code)
const waitFor = async condition => {
  const until = Date.now() + 10_000
  while (Date.now() < until) {
    if (await evaluate(condition)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw Error(`Timed out: ${condition}`)
}
const click = async selector => {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
const fill = async (selector, value) => {
  await evaluate(`{ const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', {bubbles:true})); }`)
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1250, height: 900, show: false,
    webPreferences: { preload: join(__dirname, 'settings-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
  await win.webContents.session.clearStorageData()
  await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))
  await click('.rail-settings[title="VPN"]')
  await click('.vpn-account-action')
  await fill('.vpn-auth-form input[type="email"]', 'test@example.invalid')
  await fill('.vpn-auth-form input[type="password"]', 'test-password')
  await click('.vpn-auth-form button[type="submit"]')
  await waitFor(`typeof window.settingsFixture.vpnAuthFinish === 'function'`)
  assert.equal(await evaluate(`document.querySelector('.vpn-auth-form').getAttribute('aria-busy')`), 'true')
  assert.equal(await evaluate(`document.querySelector('.vpn-auth-form button[type="submit"]').textContent`), 'Проверка…')
  assert.equal(await evaluate(`document.querySelector('.vpn-master-switch input').disabled`), true)
  await evaluate(`window.settingsFixture.vpnAuthFinish({ok:false,status:window.settingsFixture.vpnStatus,error:'Invalid credentials'})`)
  await waitFor(`document.querySelector('.vpn-auth-form [role="alert"]')?.textContent === 'Invalid credentials'`)
  assert.equal(await evaluate(`document.querySelector('.vpn-auth-form button[type="submit"]').disabled`), false)
  await fill('.vpn-auth-form input[type="password"]', 'correct-test-password')
  await click('.vpn-auth-form button[type="submit"]')
  await waitFor(`window.settingsFixture.vpnAuthRequest.password === 'correct-test-password'`)
  assert.equal(await evaluate(`document.querySelector('.vpn-auth-form [role="alert"]') === null`), true)
  await evaluate(`window.settingsFixture.vpnAuthFinish({ok:true,status:{...window.settingsFixture.vpnStatus,account:{authenticated:true,email:'test@example.invalid',tier:'paid'}}})`)
  await waitFor(`!document.querySelector('.vpn-auth-form') && document.querySelector('.vpn-page')?.textContent.includes('test@example.invalid')`)
  assert.equal(await evaluate(`document.querySelector('.vpn-master-switch input').disabled`), false)
  console.log('VPN auth UI passed: progress, blocked concurrent connection, inline failure, retry and successful account display.')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
