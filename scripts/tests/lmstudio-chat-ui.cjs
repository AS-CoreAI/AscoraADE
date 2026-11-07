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
const { once } = require('node:events')
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
const send = async text => {
  await evaluate(`{
    const input = document.querySelector('.composer-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`)
  await waitFor(`document.querySelector('.send-btn')?.disabled === false`)
  await click('.send-btn')
}
const reload = async () => {
  const ready = once(win.webContents, 'did-finish-load')
  win.reload()
  await ready
  await waitFor(`!!document.querySelector('.ws-item')`)
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
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.messages.some(m => m.reasoning && m.text.includes('журнал ошибок'))`)
  assert.equal(await evaluate(`window.settingsFixture.savedTasks.at(-1).status`), 'running')
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
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.convo.at(-1)?.content === 'Найдены файлы игры.'`)
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Найдены файлы игры.', thinking: 'Список получен. Проверю подходящие файлы.', thinkingMs: 1200 })`)
  await waitFor(`document.querySelector('.send-btn')?.disabled === true`)
  assert.equal(await evaluate(`document.querySelectorAll('.msg.assistant .bubble').length`), 1)
  assert.equal(await evaluate(`document.querySelector('.msg.assistant .bubble').textContent`), 'Найдены файлы игры.')
  await evaluate(`document.querySelectorAll('.reasoning-head')[1].click()`)
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync(join(output, 'reasoning-and-pagination.png'), (await win.webContents.capturePage()).toPNG())

  // Destroy the renderer during generation: reload must show the checkpoint,
  // including reasoning and partial prose, without waiting for chatFinish.
  await send('Продолжай проверку')
  await waitFor(`window.settingsFixture.chatParams.messages.at(-1).content === 'Продолжай проверку'`)
  await evaluate(`window.settingsFixture.chatDelta('Ответ до сбоя.', 'Размышление до сбоя.');`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.messages.some(m => m.text === 'Ответ до сбоя.')`)
  await reload()
  await click('.task-item')
  await waitFor(`document.querySelector('.chat-full-scroll')?.textContent.includes('Ответ до сбоя.')`)
  await evaluate(`document.querySelectorAll('.reasoning-head').forEach(button => button.click())`)
  await waitFor(`document.querySelector('.chat-full-scroll')?.textContent.includes('Размышление до сбоя.')`)

  async function seedCompaction(id) {
    await evaluate(`window.ascora.workspace.saveTask({ id: ${JSON.stringify(id)}, workspaceId: 'settings-test',
      title: ${JSON.stringify(id)}, status: 'idle', updatedAt: Date.now(),
      messages: [{ id: 'original', role: 'user', kind: 'text', text: 'Original goal stays visible' }],
      convo: Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Step ' + i + ': ' + 'verified progress '.repeat(100) }))
    })`)
    await reload()
    await waitFor(`Array.from(document.querySelectorAll('.task-item')).some(el => el.textContent.includes(${JSON.stringify(id)}))`)
    await evaluate(`Array.from(document.querySelectorAll('.task-item')).find(el => el.textContent.includes(${JSON.stringify(id)})).click()`)
    await waitFor(`!!document.querySelector('.composer-input')`)
    await send('Continue from saved progress')
    await waitFor(`window.settingsFixture.chatParams?.messages[0].content.startsWith('Write a compact continuation note')`)
  }

  await seedCompaction('compaction-success')
  assert.equal(await evaluate(`window.settingsFixture.checkpoints.length`), 1)
  let summaryCalls = 0
  for (; summaryCalls < 30; summaryCalls++) {
    if (!await evaluate(`window.settingsFixture.chatParams.messages[0].content.startsWith('Write a compact continuation note')`)) break
    const id = await evaluate('window.settingsFixture.chatId')
    await evaluate(`window.settingsFixture.chatDelta('Goal: finish the fix. Completed: inspected files. Next: verify startup.', 'Checking the saved steps.');
      window.settingsFixture.chatFinish({ ok: true, content: 'Goal: finish the fix. Completed: inspected files. Next: verify startup.', finishReason: 'stop' });`)
    await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(id)}`)
  }
  assert.ok(summaryCalls > 1 && summaryCalls < 30, 'Long history must be summarized in bounded chunks')
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages.some(m => m.content.startsWith('[Saved context summary]'))`))
  assert.ok(await evaluate(`window.settingsFixture.checkpoints[0].convo.length > window.settingsFixture.chatParams.messages.length`))
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Continued after compaction.' })`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
  assert.ok(await evaluate(`document.querySelector('.chat-full-scroll').textContent.includes('Original goal stays visible')`))
  assert.ok(await evaluate(`document.querySelector('.chat-full-scroll').textContent.includes('Сводка контекста')`))
  await reload()
  await evaluate(`Array.from(document.querySelectorAll('.task-item')).find(el => el.textContent.includes('compaction-success')).click()`)
  await waitFor(`document.querySelector('.chat-full-scroll')?.textContent.includes('Continued after compaction.')`)
  assert.ok(await evaluate(`document.querySelector('.chat-full-scroll').textContent.includes('Сводка контекста')`))

  await seedCompaction('compaction-cancelled')
  await evaluate(`window.settingsFixture.chatDelta('Incomplete summary', 'Reasoning during compaction')`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.messages.some(m => m.text === 'Reasoning during compaction')`)
  await click('.send-btn.stopping')
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
  assert.ok(await evaluate(`window.settingsFixture.savedTasks.at(-1).convo.length >= 25`))
  assert.ok(!await evaluate(`window.settingsFixture.savedTasks.at(-1).convo.some(m => m.content.startsWith('[Saved context summary]'))`))
  assert.deepEqual(errors, [])
  console.log('LM Studio chat UI OK: live checkpoints, reasoning/prose after renderer restart, bounded tool results, context compaction, archived source, summary after restart, cancellation retains original context')
  app.exit(0)
}).catch(error => { console.error(error, errors); app.exit(1) })
