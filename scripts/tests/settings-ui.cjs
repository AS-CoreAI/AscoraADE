// Run after npm run build: node scripts/tests/settings-ui.cjs
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
const output = resolve(__dirname, '../../.build/settings-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.disableHardwareAcceleration()
const errors = []
let win
const evaluate = (code) => win.webContents.executeJavaScript(code)
const waitFor = async (condition) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await evaluate(condition)) return
    await new Promise((done) => setTimeout(done, 50))
  }
  throw new Error(`Timed out: ${condition}`)
}
const click = async (selector) => {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
const clickText = async (selector, text) => {
  const expr = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)})`
  await waitFor(`!!(${expr})`)
  await evaluate(`(${expr}).click()`)
}
const screenshot = async (name) => {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await new Promise((done) => setTimeout(done, 200))
  writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG())
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1440, height: 1000, show: false,
    webPreferences: { preload: join(__dirname, 'settings-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message)
  })
  await win.webContents.session.clearStorageData()
  await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))
  await waitFor(`!!document.querySelector('[title="Настройки языка и внешнего вида"]')`)
  await evaluate(`localStorage.removeItem('settings-smoke')`)
  await click('[title="Настройки языка и внешнего вида"]')
  await waitFor(`!!document.querySelector('.settings-theme-options')`)
  assert.equal(await evaluate(`document.querySelectorAll('.modal-backdrop').length`), 0)
  assert.equal(await evaluate(`!!document.querySelector('.rail-settings[title="Инструменты разработчика"]')`), false)
  await screenshot('appearance-dark')
  await clickText('.settings-nav nav > button', 'Провайдеры агентов')
  await clickText('.settings-provider-nav button', 'Codex')
  await waitFor(`document.querySelector('.settings-content').textContent.includes('68%')`)
  assert.equal(await evaluate(`window.ascora.llm.config().then(c => c.provider)`), 'lmstudio', 'Opening provider settings must not select it in chat')
  await screenshot('codex')
  for (const name of ['GitHub Copilot', 'Claude', 'Grok CLI', 'GLM (ZCode)', 'Antigravity']) {
    await clickText('.settings-provider-nav button', name)
    await waitFor(`document.querySelector('.settings-content h1')?.textContent === ${JSON.stringify(name)}`)
  }
  await clickText('.settings-provider-nav button', 'Gemini CLI')
  await clickText('.settings-install button', 'Установить автоматически')
  await waitFor(`document.querySelector('.settings-status-grid').textContent.includes('Установлено')`)
  await clickText('.settings-provider-nav button', 'OpenRouter')
  await click('.settings-toggle-row input')
  assert.equal(await evaluate(`window.ascora.settings.get('providers.visibility').then(v => v.openrouter)`), false)
  await click('.settings-back')
  await click('.provider-select-button')
  assert.equal(await evaluate(`[...document.querySelectorAll('.provider-dropdown-option')].some(el => el.textContent.includes('OpenRouter'))`), false)
  win.webContents.reload()
  await waitFor(`!!document.querySelector('[title="Настройки языка и внешнего вида"]')`)
  await click('.provider-select-button')
  assert.equal(await evaluate(`[...document.querySelectorAll('.provider-dropdown-option')].some(el => el.textContent.includes('OpenRouter'))`), false, 'Visibility must survive a reload')
  await click('[title="Настройки языка и внешнего вида"]')
  await clickText('.settings-nav nav > button', 'Провайдеры агентов')
  await clickText('.settings-provider-nav button', 'OpenRouter')
  await click('.settings-toggle-row input')
  await click('.settings-back')
  await click('.provider-select-button')
  await clickText('.provider-dropdown-option', 'OpenRouter')
  await waitFor(`document.querySelector('.settings-content h1')?.textContent === 'OpenRouter'`)
  await clickText('.settings-nav nav > button', 'Инструменты разработчика')
  await waitFor(`!!document.querySelector('.tool-card')`)
  assert.equal(await evaluate(`document.querySelectorAll('.modal-backdrop').length`), 0)
  await screenshot('tools')
  await clickText('.settings-nav nav > button', 'Язык и внешний вид')
  await clickText('.settings-theme', 'Светлая')
  await waitFor(`document.documentElement.dataset.theme === 'light'`)
  await screenshot('appearance-light')
  win.setSize(1000, 800)
  await screenshot('appearance-compact')
  assert.equal(await evaluate(`document.querySelector('.settings-content').scrollWidth > document.querySelector('.settings-content').clientWidth`), false, 'Settings must not overflow horizontally')
  assert.deepEqual(errors, [])
  console.log('Settings UI OK: full-page navigation, independent provider pages, limits, installation, visibility, unconfigured OpenRouter, themes and compact layout')
  app.exit(0)
}).catch((error) => { console.error(error, errors); app.exit(1) })
