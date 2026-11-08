// Hidden, isolated production renderer. All model and file operations are fixtures.
const { resolve, join } = require('node:path')
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { once } = require('node:events')
const assert = require('node:assert/strict')
const output = resolve(__dirname, '../../.build/external-files-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile')); app.disableHardwareAcceleration()
let win
const errors = []
const evaluate = code => win.webContents.executeJavaScript(code)
const waitFor = async condition => {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await evaluate(condition)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Timed out: ' + condition)
}
const click = async selector => {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
const general = async () => { await click('[title="Настройки языка и внешнего вида"]'); await click('[data-section="general"]') }
const reload = async () => {
  const loaded = once(win.webContents, 'did-finish-load')
  win.reload(); await loaded; await click('.ws-item')
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: {
    preload: join(__dirname, 'settings-preload.cjs'), contextIsolation: false, sandbox: false,
    backgroundThrottling: false, offscreen: true
  } })
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
  await win.webContents.session.clearStorageData()
  await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))
  await click('.ws-item'); await general()
  assert.equal(await evaluate(`document.querySelector('.agent-external-files').checked`), true)
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await new Promise(resolve => setTimeout(resolve, 150))
  writeFileSync(join(output, 'external-files-enabled.png'), (await win.webContents.capturePage()).toPNG())
  await click('.agent-external-files')
  await waitFor(`window.ascora.settings.get('agent.allowExternalFiles').then(value=>value===false)`)
  await reload(); await general()
  assert.equal(await evaluate(`document.querySelector('.agent-external-files').checked`), false)
  await click('.settings-back')
  await evaluate(`{
    const input=document.querySelector('.composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Check the selected folder');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    window.ascora.agent={ listDir:async()=>({ok:true,path:'.',entries:[]}) };
    void 0;
  }`)
  await waitFor(`document.querySelector('.send-btn')?.disabled===false`)
  await click('.send-btn')
  await waitFor(`typeof window.settingsFixture.chatFinish==='function'`)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages[0].content.includes('External file access is disabled')`))
  await general(); await click('.agent-external-files')
  await waitFor(`window.ascora.settings.get('agent.allowExternalFiles').then(value=>value===true)`)
  await click('.settings-back')
  const firstId = await evaluate('window.settingsFixture.chatId')
  await evaluate(`window.settingsFixture.chatFinish({ok:true,content:'',toolCalls:[{id:'fixture-list',name:'list_dir',arguments:'{"path":"."}'}]})`)
  await waitFor(`window.settingsFixture.chatId!==${JSON.stringify(firstId)}`)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages[0].content.includes('External file access is enabled')`))
  await evaluate(`window.settingsFixture.chatFinish({ok:true,content:'Done'})`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status==='idle'`)
  await reload(); await general()
  assert.equal(await evaluate(`document.querySelector('.agent-external-files').checked`), true)
  assert.deepEqual(errors, [])
  console.log('External files UI OK: default on, off/on persistence, live chat prompt update; no model inference')
  app.exit(0)
}).catch(error => { console.error(error, errors); app.exit(1) })
