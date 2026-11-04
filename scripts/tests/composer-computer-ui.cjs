// Run after npm run build. Hidden test window; desktop input is mocked.
const { join, resolve } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const output = resolve(__dirname, '../../.build/composer-computer-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.disableHardwareAcceleration()
let win
const errors = []
const evaluate = code => win.webContents.executeJavaScript(code)
const waitFor = async condition => {
  const until = Date.now() + 10_000
  while (Date.now() < until) {
    if (await evaluate(condition)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out: ${condition}`)
}
const click = async selector => {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
const fill = async text => {
  await evaluate(`{ const input = document.querySelector('.composer-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true})); }`)
}
const snapshot = async name => {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await evaluate(`document.querySelector('.composer').scrollWidth > document.querySelector('.composer').clientWidth`), false, 'Composer must fit its width')
  const bounds = await evaluate(`{ const r = document.querySelector('.composer').getBoundingClientRect(); ({x: Math.floor(r.x)-4, y:Math.floor(r.y)-4,width:Math.ceil(r.width)+8,height:Math.ceil(r.height)+8}); }`)
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage(bounds)).toPNG())
}
const toolTurn = async args => {
  const previous = await evaluate('window.settingsFixture.chatId')
  await evaluate(`window.settingsFixture.chatFinish({ok:true,content:'',toolCalls:[{id:'computer-call',name:'computer',arguments:${JSON.stringify(JSON.stringify(args))}}]})`)
  return previous
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1250, height: 900, show: false,
    webPreferences: { preload: join(__dirname, 'settings-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await win.webContents.session.clearStorageData()
  await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))
  await click('.ws-item')
  await waitFor(`document.querySelector('.computer-toggle')?.disabled === false`)
  assert.equal(await evaluate(`document.querySelector('.computer-toggle').getAttribute('aria-pressed')`), 'false')
  await snapshot('composer-dark')
  await click('.computer-toggle')
  assert.equal(await evaluate('window.settingsFixture.computerActions.length'), 0, 'Enabling must not capture the screen before a task')
  await snapshot('computer-enabled-dark')
  win.setSize(750, 900)
  await snapshot('composer-compact-dark')
  await evaluate(`document.documentElement.dataset.theme = 'light'`)
  await snapshot('composer-compact-light')
  win.setSize(1250, 900)
  await snapshot('computer-enabled-light')
  await evaluate(`document.documentElement.dataset.theme = 'dark'`)
  await fill('Открой настройки приложения и найди язык интерфейса.')
  await click('.send-btn')
  await waitFor(`typeof window.settingsFixture.chatFinish === 'function'`)
  assert.equal(await evaluate(`window.settingsFixture.chatParams.tools.some(t => t.function.name === 'computer')`), true)
  const first = await toolTurn({ action: 'screenshot' })
  await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(first)}`)
  let messages = await evaluate('window.settingsFixture.chatParams.messages')
  assert.equal(messages.filter(m => m.images).length, 1)
  assert.match(messages.at(-1).content, /frame_id=frame-1/)
  const second = await toolTurn({ action: 'click', frame_id: 'frame-1', x: 120, y: 90 })
  await waitFor(`!!document.querySelector('.agent-tool-card.awaiting')`)
  assert.equal(await evaluate('window.settingsFixture.computerActions.length'), 1, 'Ask mode must wait for approval before input')
  await click('.tool-approve')
  await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(second)}`)
  assert.equal(await evaluate('window.settingsFixture.computerActions.length'), 2)
  messages = await evaluate('window.settingsFixture.chatParams.messages')
  assert.equal(messages.filter(m => m.images).length, 1, 'Keep only the latest image')
  assert.match(messages.at(-1).content, /frame_id=frame-2/)
  await evaluate(`window.settingsFixture.computerStopped(window.settingsFixture.computerTask)`)
  await waitFor(`document.querySelector('.computer-toggle').getAttribute('aria-pressed') === 'false'`)
  await waitFor(`document.querySelector('.send-btn').disabled === true`)
  assert.ok(await evaluate('window.settingsFixture.computerStops.length > 0'))
  assert.equal(await evaluate(`JSON.stringify(window.settingsFixture.savedTasks).includes('data:image')`), false, 'Do not persist desktop images')
  assert.equal(await evaluate(`window.settingsFixture.abortId === window.settingsFixture.chatId`), true)
  assert.deepEqual(errors, [])
  console.log('Composer UI OK: themes, compact layout, toggle, tool advertisement, screenshot, approval, fresh image, emergency stop, no persisted screenshots')
  app.exit(0)
}).catch(error => { console.error(error, errors); app.exit(1) })
