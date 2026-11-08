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
const clickText = async (selector, value) => {
  const expr = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.trim() === ${JSON.stringify(value)})`
  await waitFor(`!!(${expr})`)
  await evaluate(`(${expr}).click()`)
}
const setAutoCompact = async (enabled, capture = false) => {
  await click('[title="Настройки языка и внешнего вида"]')
  await clickText('.settings-nav nav > button', 'Провайдеры агентов')
  await clickText('.settings-provider-nav button', 'LM Studio')
  await waitFor(`!!document.querySelector('.lmstudio-auto-compact')`)
  if (await evaluate(`document.querySelector('.lmstudio-auto-compact').checked`) !== enabled) await click('.lmstudio-auto-compact')
  assert.equal(await evaluate(`window.ascora.llm.config().then(c => c.lmStudioAutoCompact)`), enabled)
  if (capture) {
    await evaluate(`document.querySelector('.lmstudio-auto-compact').scrollIntoView({block:'center'}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    writeFileSync(join(output, 'compaction-setting-off.png'), (await win.webContents.capturePage()).toPNG())
  }
  await click('.settings-back')
  await waitFor(`!!document.querySelector('.composer-input')`)
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
  assert.equal(await evaluate(`window.ascora.llm.config().then(c => c.lmStudioAutoCompact)`), false)
  await setAutoCompact(false, true)
  await waitFor(`document.querySelector('.lmstudio-reasoning')?.disabled === false`)
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('.lmstudio-reasoning').options).map(o => o.value)`), ['', 'off', 'low', 'medium', 'xhigh'])
  await evaluate(`{ const select = document.querySelector('.lmstudio-reasoning'); select.value = 'low'; select.dispatchEvent(new Event('change', { bubbles: true })); }`)
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
  assert.equal(await evaluate(`window.settingsFixture.chatParams.reasoning`), 'low')
  const firstRequest = await evaluate('window.settingsFixture.chatParams')
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
  assert.equal(await evaluate(`document.querySelector('.lmstudio-reasoning').value`), 'low', 'Chat reasoning choice survives reload')
  await evaluate(`document.querySelectorAll('.reasoning-head').forEach(button => button.click())`)
  await waitFor(`document.querySelector('.chat-full-scroll')?.textContent.includes('Размышление до сбоя.')`)

  async function seedCompaction(id, contextLength, expectCompaction = true) {
    await evaluate(`window.ascora.workspace.saveTask({ id: ${JSON.stringify(id)}, workspaceId: 'settings-test',
      title: ${JSON.stringify(id)}, status: 'idle', updatedAt: Date.now(),
      messages: [{ id: 'original', role: 'user', kind: 'text', text: 'Original goal stays visible' }],
      convo: Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Step ' + i + ': ' + 'verified progress '.repeat(100) }))
    })`)
    await reload()
    await evaluate(`document.querySelector('.task-show-more')?.click()`)
    await waitFor(`Array.from(document.querySelectorAll('.task-item')).some(el => el.textContent.includes(${JSON.stringify(id)}))`)
    await evaluate(`Array.from(document.querySelectorAll('.task-item')).find(el => el.textContent.includes(${JSON.stringify(id)})).click()`)
    await waitFor(`!!document.querySelector('.composer-input')`)
    if (contextLength) await evaluate(`window.settingsFixture.contextLength = ${contextLength}; window.dispatchEvent(new Event('focus'));`)
    await send('Continue from saved progress')
    if (expectCompaction) await waitFor(`window.settingsFixture.chatParams?.messages[0].content.startsWith('Write a compact continuation note')`)
    else await waitFor(`window.settingsFixture.chatParams?.messages.at(-1)?.content === 'Continue from saved progress'`)
  }

  const { loadTypeScript } = require('./llm-fixture.cjs')
  const { contextTokens, conversationTokens } = loadTypeScript('src/shared/context-compaction.ts')
  const source = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Step ' + i + ': ' + 'verified progress '.repeat(100) }))
  const used = conversationTokens([...source, { role: 'user', content: 'Continue from saved progress' }]) + contextTokens(firstRequest.messages[0].content + JSON.stringify(firstRequest.tools)) + 256
  const fittingWindow = Math.ceil(used / 0.8)
  // This restored history is above the compaction threshold, but the default is off.
  await seedCompaction('compaction-default-off', fittingWindow, false)
  assert.equal(await evaluate(`window.settingsFixture.checkpoints.length`), 0)
  assert.equal(await evaluate(`window.ascora.llm.config().then(c => c.lmStudioAutoCompact)`), false)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages.length >= 26`))
  assert.ok(!await evaluate(`window.settingsFixture.chatParams.messages[0].content.startsWith('Write a compact continuation note')`))
  await evaluate(`window.settingsFixture.chatDelta('Answer without compaction', 'Reasoning still saved while compaction is off')`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.messages.some(m => m.reasoning && m.text.includes('compaction is off'))`)
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Answer without compaction' })`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
  await setAutoCompact(true)

  await seedCompaction('compaction-success')
  assert.equal(await evaluate(`window.settingsFixture.checkpoints.length`), 1)
  const unfinishedId = await evaluate('window.settingsFixture.chatId')
  assert.ok(await evaluate('window.settingsFixture.chatParams.maxTokens > 2048'))
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: '', thinking: 'Saved summary reasoning at length limit', finishReason: 'length' })`)
  await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(unfinishedId)}`)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages.at(-1).content.includes('Saved summary reasoning at length limit')`))
  assert.ok(await evaluate(`window.settingsFixture.savedTasks.at(-1).messages.some(m => m.reasoning && m.text.includes('Saved summary reasoning'))`))
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

  // Reloaded model window changes are read on the next turn, not frozen at submit/startup.
  await evaluate(`window.settingsFixture.contextLength = 1000000; window.dispatchEvent(new Event('focus'));`)
  await waitFor(`document.querySelector('.lmstudio-context').textContent.replace(/[^0-9]/g, '') === '1000000'`)
  await send('Continue with the million-token window')
  await waitFor(`window.settingsFixture.chatParams.messages.at(-1)?.content === 'Continue with the million-token window'`)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.maxTokens > 900000`))
  const incompleteId = await evaluate('window.settingsFixture.chatId')
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: '', thinking: 'Unfinished agent reasoning', finishReason: 'length' })`)
  await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(incompleteId)}`)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages.at(-1).content.includes('Unfinished agent reasoning')`))
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Continued the actual task.' })`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)

  await evaluate(`window.settingsFixture.contextLength = null; window.dispatchEvent(new Event('focus'));`)
  await waitFor(`document.querySelector('.lmstudio-context').textContent.includes('не сообщил')`)
  await send('Use the server when context is unknown')
  await waitFor(`window.settingsFixture.chatParams.messages.at(-1)?.content === 'Use the server when context is unknown'`)
  assert.equal(await evaluate(`window.settingsFixture.chatParams.maxTokens`), undefined)
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Server chooses the limit.' })`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)

  // A summary failure at ~80% usage must retain the original and resume work.
  await seedCompaction('compaction-deferred', fittingWindow)
  const failingId = await evaluate('window.settingsFixture.chatId')
  await evaluate(`window.settingsFixture.chatFinish({ ok: false, content: '', error: 'Summary server failure' })`)
  await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(failingId)}`)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages.length >= 26`))
  assert.ok(!await evaluate(`window.settingsFixture.chatParams.messages.some(m => m.content.startsWith('[Saved context summary]'))`))
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Continued with original context.' })`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
  await evaluate(`document.querySelectorAll('.reasoning-head').forEach(button => button.click())`)
  assert.ok(await evaluate(`document.querySelector('.chat-full-scroll').textContent.includes('Продолжаю с сохранённым')`))
  writeFileSync(join(output, 'reasoning-control-context.png'), (await win.webContents.capturePage()).toPNG())

  // Disable during the second segment: never replace the source with a partial summary.
  await seedCompaction('compaction-disabled-during-summary', fittingWindow)
  const firstSegmentId = await evaluate('window.settingsFixture.chatId')
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Only the first segment was summarized', finishReason: 'stop' })`)
  await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(firstSegmentId)}`)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages[0].content.startsWith('Write a compact continuation note')`))
  const cancelledSummaryId = await evaluate('window.settingsFixture.chatId')
  await setAutoCompact(false)
  await waitFor(`window.settingsFixture.chatId !== ${JSON.stringify(cancelledSummaryId)}`)
  assert.equal(await evaluate('window.settingsFixture.abortId'), cancelledSummaryId)
  assert.ok(await evaluate(`window.settingsFixture.chatParams.messages.length >= 26`))
  assert.ok(!await evaluate(`window.settingsFixture.chatParams.messages.some(m => m.content.startsWith('[Saved context summary]'))`))
  await evaluate(`window.settingsFixture.chatFinish({ ok: true, content: 'Continued after disabling compaction' })`)
  await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
  await reload()
  assert.equal(await evaluate(`window.ascora.llm.config().then(c => c.lmStudioAutoCompact)`), false, 'Global opt-out survives restart')
  assert.deepEqual(errors, [])
  console.log('LM Studio chat UI OK: compaction defaults off, global checkbox persists, disabling cancels only summaries and preserves full source, autosave/recovery, context/reasoning controls, compaction retry/defer/cancel')
  app.exit(0)
}).catch(error => { console.error(error, errors); app.exit(1) })
