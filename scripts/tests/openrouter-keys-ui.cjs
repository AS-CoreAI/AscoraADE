// Run after npm run build: node scripts/tests/openrouter-keys-ui.cjs
// Production renderer with isolated settings and a scripted OpenRouter backend only.
const { resolve, join } = require('node:path')
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
} else if (process.type === 'renderer') {
  require('./settings-preload.cjs')
  const fixture = window.settingsFixture
  fixture.chatRequests = []
  const llm = window.ascora.llm
  const chat = async (id, params) => {
    fixture.chatRequests.push(structuredClone(params))
    return { ok: true, content: 'Done.', finishReason: 'stop' }
  }
  const listModels = async () => ({ ok: true, models: [{ id: 'openrouter/free' }, { id: 'openai/gpt-6-astra' }] })
  window.ascora.llm = new Proxy(llm, { get: (target, method) =>
    method === 'chat' ? chat : method === 'listModels' ? listModels : target[method] })
} else {
  const { app, BrowserWindow } = require('electron')
  const assert = require('node:assert/strict')
  const { mkdirSync, writeFileSync } = require('node:fs')
  const { once } = require('node:events')
  const output = resolve(__dirname, '../../.build/openrouter-keys-smoke')
  mkdirSync(output, { recursive: true })
  app.setPath('userData', join(output, 'profile')); app.disableHardwareAcceleration()
  let win
  const errors = []
  const evaluate = code => win.webContents.executeJavaScript(code)
  const waitFor = async condition => {
    const deadline = Date.now() + 15000
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
  const clickText = async (selector, text) => {
    const find = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.trim().startsWith(${JSON.stringify(text)}))`
    await waitFor(`!!(${find})`)
    await evaluate(`(${find}).click()`)
  }
  // React tracks input values itself; set through the native setter and notify it.
  const type = async (selector, index, value) => {
    await waitFor(`document.querySelectorAll(${JSON.stringify(selector)}).length > ${index}`)
    await evaluate(`{ const input = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true })) }`)
  }
  const capture = async name => {
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    writeFileSync(join(output, name), (await win.webContents.capturePage()).toPNG())
  }
  const openOpenRouterSettings = async () => {
    await click('[title="Настройки языка и внешнего вида"]')
    await clickText('.settings-nav nav > button', 'Провайдеры агентов')
    await clickText('.settings-provider-nav button', 'OpenRouter')
  }
  const NAME = 'input[aria-label="Название ключа"]'
  const KEY = 'input[aria-label="Ключ OpenRouter"]'
  const KEY_PICKER = 'select[aria-label="Ключ OpenRouter"]'
  const config = () => evaluate('window.ascora.llm.config()')

  app.whenReady().then(async () => {
    win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { preload: __filename,
      contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
    await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))
    await win.webContents.session.clearStorageData()
    await evaluate(`localStorage.setItem('settings-smoke-llm', JSON.stringify({ openRouterEnabled: true }))`)
    const ready = once(win.webContents, 'did-finish-load'); win.reload(); await ready
    await waitFor(`!!document.querySelector('.ws-item')`)
    await click('.ws-item'); await waitFor(`!!document.querySelector('.composer-input')`)

    // Settings: an empty draft row is ready before any key exists; two labelled keys are saved.
    await openOpenRouterSettings()
    await waitFor(`document.querySelectorAll('${NAME}').length === 1 && document.querySelectorAll('${KEY}').length === 1`)
    await type(NAME, 0, 'Работа')
    await type(KEY, 0, ' sk-or-v1-work ')
    await clickText('button', 'Добавить ключ')
    await type(NAME, 1, 'Дом')
    await type(KEY, 1, 'sk-or-v1-home')
    await clickText('button', 'Сохранить')
    await waitFor(`window.ascora.llm.config().then(c => c.openRouterApiKeys?.length === 2)`)
    const saved = await config()
    assert.deepEqual(saved.openRouterApiKeys.map(({ label, apiKey }) => ({ label, apiKey })),
      [{ label: 'Работа', apiKey: 'sk-or-v1-work' }, { label: 'Дом', apiKey: 'sk-or-v1-home' }])
    const [work, home] = saved.openRouterApiKeys
    assert.equal(saved.openRouterActiveKeyId, work.id, 'the first key starts active')
    await capture('settings-keys.png')
    console.log('settings: two labelled keys saved')

    // Composer: with two keys, a key picker sits next to the model picker.
    await click('.settings-back')
    await click('.provider-select-button')
    await clickText('.provider-dropdown-option', 'OpenRouter')
    await waitFor(`!!document.querySelector('${KEY_PICKER}')`)
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('${KEY_PICKER}').options).map(o => o.textContent)`), ['Работа', 'Дом'])
    assert.equal(await evaluate(`document.querySelector('${KEY_PICKER}').value`), work.id)
    assert.equal(await evaluate(`!!document.querySelector('[title="Модель (OpenRouter)"]')`), true, 'the model picker stays')
    await evaluate(`{ const s = document.querySelector('${KEY_PICKER}'); s.value = ${JSON.stringify(home.id)}; s.dispatchEvent(new Event('change', { bubbles: true })) }`)
    await waitFor(`window.ascora.llm.config().then(c => c.openRouterActiveKeyId === ${JSON.stringify(home.id)})`)
    await capture('composer-key-picker.png')

    // The chat request names the key the chat started with.
    await evaluate(`{ const input = document.querySelector('.composer-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Hello');
      input.dispatchEvent(new Event('input', { bubbles: true })) }`)
    await waitFor(`document.querySelector('.send-btn')?.disabled === false`)
    await click('.send-btn')
    await waitFor(`window.settingsFixture.chatRequests.length === 1`)
    const request = (await evaluate('window.settingsFixture.chatRequests'))[0]
    assert.equal(request.provider, 'openrouter')
    assert.equal(request.openRouterKeyId, home.id)
    console.log('composer: key picker switches the chat key')

    // With a single key left, the picker disappears again.
    await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
    await openOpenRouterSettings()
    await waitFor(`document.querySelectorAll('${NAME}').length === 2`)
    await click(`button[aria-label="Удалить: Дом"]`)
    await clickText('button', 'Сохранить')
    await waitFor(`window.ascora.llm.config().then(c => c.openRouterApiKeys?.length === 1)`)
    assert.equal((await config()).openRouterActiveKeyId, work.id, 'removing the active key falls back to the remaining one')
    await click('.settings-back')
    await waitFor(`!!document.querySelector('[title="Модель (OpenRouter)"]')`)
    assert.equal(await evaluate(`!!document.querySelector('${KEY_PICKER}')`), false)
    console.log('composer: no key picker with one key')

    assert.deepEqual(errors, [])
    console.log('OpenRouter keys UI OK')
    app.exit(0)
  }).catch(error => { console.error(error, errors); app.exit(1) })
}
