// Run after npm run build: node scripts/tests/lmstudio-chat-ui.cjs
// Isolated, hidden Electron window with fixture data; no real model or project.
const { join, resolve } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const output = resolve(__dirname, '../../.build/lmstudio-chat-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.disableHardwareAcceleration()
let win
const errors = []
const evaluate = code => win.webContents.executeJavaScript(code)
const waitFor = async condition => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await evaluate(condition)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out: ${condition}`)
}
const click = async selector => {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1200, height: 900, show: false,
    webPreferences: { preload: join(__dirname, 'settings-preload.cjs'), contextIsolation: false,
      sandbox: false, backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
  await win.webContents.session.clearStorageData()
  await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))
  await click('.ws-item')
  await waitFor(`!!document.querySelector('.composer-input')`)
  await evaluate(`{
    const input = document.querySelector('.composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Проверь журналы игры');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.ascora.agent = { listDir: async () => ({ ok: true, path: '.', entries:
      Array.from({ length: 3286 }, (_, i) => ({ name: 'asset-' + i + '.dat', type: 'file' })) }) };
    void 0;
  }`)
  await waitFor(`document.querySelector('.send-btn')?.disabled === false`)
  await click('.send-btn')
  await waitFor(`typeof window.settingsFixture.chatDelta === 'function'`)
  assert.equal(await evaluate(`window.ascora.llm.config().then(c => c.provider)`), 'lmstudio')
  await evaluate(`window.settingsFixture.chatDelta('', 'Сначала посмотрю содержимое папки.')`)
  await click('.reasoning-head')
  await waitFor(`document.querySelector('.reasoning-body')?.textContent === 'Сначала посмотрю содержимое папки.'`)
  await evaluate(`window.settingsFixture.chatDelta('', 'Сначала посмотрю содержимое папки. Затем найду журнал ошибок.')`)
  await waitFor(`document.querySelector('.reasoning-body')?.textContent.includes('журнал ошибок')`)
  assert.equal(await evaluate(`document.querySelectorAll('.reasoning-block').length`), 1)
  await evaluate(`{
    window.settingsFixture.firstChatId = window.settingsFixture.chatId;
    window.settingsFixture.chatFinish({ ok: true, content: '', thinking: 'Сначала посмотрю содержимое папки. Затем найду журнал ошибок.', thinkingMs: 2300,
      toolCalls: [{ id: 'list-1', name: 'list_dir', arguments: '{"path":"."}' }] });
  }`)
  await waitFor(`window.settingsFixture.chatId !== window.settingsFixture.firstChatId`)
  await waitFor(`document.querySelector('.tool-note')?.textContent.includes('showing 1-100')`)
  const messages = await evaluate(`window.settingsFixture.chatParams.messages`)
  assert.ok(messages.find(message => message.role === 'tool').content.length < 13_000)
  assert.ok(!messages.some(message => message.content.includes('Сначала посмотрю')), 'Reasoning must not leak into the next prompt')
  await evaluate(`window.settingsFixture.chatDelta('', 'Список получен. Проверю подходящие файлы.'); window.settingsFixture.chatDelta('Найдены файлы игры.');`)
  await waitFor(`document.querySelectorAll('.reasoning-block').length === 2`)
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Найдены файлы игры.', thinking: 'Список получен. Проверю подходящие файлы.', thinkingMs: 1200 })`)
  await waitFor(`document.querySelector('.send-btn')?.disabled === true`)
  assert.equal(await evaluate(`document.querySelectorAll('.msg.assistant .bubble').length`), 1)
  assert.equal(await evaluate(`document.querySelector('.msg.assistant .bubble').textContent`), 'Найдены файлы игры.')
  await evaluate(`document.querySelectorAll('.reasoning-head')[1].click()`)
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync(join(output, 'reasoning-and-pagination.png'), (await win.webContents.capturePage()).toPNG())
  assert.deepEqual(errors, [])
  console.log('LM Studio chat UI OK: live reasoning, tool call, bounded 3286-entry listing, separate final answer')
  app.exit(0)
}).catch(error => { console.error(error, errors); app.exit(1) })
