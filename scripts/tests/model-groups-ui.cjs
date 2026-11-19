// Run after npm run build: node scripts/tests/model-groups-ui.cjs
// Production renderer with isolated settings and fixture model catalogs only.
const { resolve, join } = require('node:path')
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
} else if (process.type === 'renderer') {
  require('./settings-preload.cjs')
  const catalogs = {
    openrouter: ['openai/gpt-6-astra', 'nvidia/nemotron-3.5-lightning:free', 'anthropic/claude-sonnet-5.5', 'openrouter/free', 'google/gemma-4-31b-it:free'],
    omniroute: ['cfp/zai-org/glm-5.2', 'ddgw/gpt-5.4-mini', 'auto', 'auto/best-coding', 'ddgw/claude-haiku-4-5', 'unc/turboderp/Qwen3.8-27B-exl3']
  }
  const llm = window.ascora.llm
  const listModels = async (provider) => {
    const id = provider || (await llm.config()).provider
    return catalogs[id] ? { ok: true, models: catalogs[id].map(model => ({ id: model })) } : llm.listModels(provider)
  }
  window.ascora.llm = new Proxy(llm, { get: (target, method) => method === 'listModels' ? listModels : target[method] })
} else {
  const { app, BrowserWindow } = require('electron')
  const assert = require('node:assert/strict')
  const { mkdirSync, writeFileSync } = require('node:fs')
  const { once } = require('node:events')
  const output = resolve(__dirname, '../../.build/model-groups-smoke')
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
  // Pick the backend in the composer, as a user does.
  const open = async (label) => {
    await win.webContents.session.clearStorageData()
    await evaluate(`localStorage.setItem('settings-smoke-llm', JSON.stringify({
      openRouterEnabled:true,openRouterApiKey:'test-key',openRouterModel:'openai/gpt-6-astra',omnirouteModel:'auto'}))`)
    const ready = once(win.webContents, 'did-finish-load'); win.reload(); await ready
    await waitFor(`!!document.querySelector('.ws-item')`)
    await click('.ws-item'); await waitFor(`!!document.querySelector('.composer-input')`)
    await click('.provider-select-button')
    const option = `Array.from(document.querySelectorAll('.provider-dropdown-option')).find(el => el.textContent.trim().startsWith(${JSON.stringify(label)}))`
    await waitFor(`!!(${option})`)
    await evaluate(`(${option}).click()`)
  }
  const capture = async name => {
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    writeFileSync(join(output, name), (await win.webContents.capturePage()).toPNG())
  }

  app.whenReady().then(async () => {
    win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { preload: __filename,
      contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
    await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))

    // OpenRouter: free variants (and the free router) get their own group first.
    await open('OpenRouter')
    const select = `[title="${'Модель (OpenRouter)'}"]`
    await waitFor(`document.querySelectorAll('${select} optgroup').length === 2`).catch(async (error) => {
      console.error(await evaluate(`JSON.stringify({ providers: Array.from(document.querySelectorAll('.provider-select-label')).map(e => e.textContent), selects: Array.from(document.querySelectorAll('select')).map(s => ({ title: s.title, options: Array.from(s.options).map(o => o.value).slice(0, 8), groups: s.querySelectorAll('optgroup').length })) })`))
      throw error
    })
    const groups = await evaluate(`Array.from(document.querySelectorAll('${select} optgroup')).map(g => ({ label: g.label, ids: Array.from(g.children).map(o => o.value) }))`)
    assert.deepEqual(groups, [
      { label: 'Бесплатные модели', ids: ['openrouter/free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-lightning:free'] },
      { label: 'Все модели', ids: ['openai/gpt-6-astra', 'anthropic/claude-sonnet-5.5'] }
    ])
    // Choosing a model inside a group still saves it.
    await evaluate(`{ const s = document.querySelector('${select}'); s.value = 'google/gemma-4-31b-it:free'; s.dispatchEvent(new Event('change', { bubbles: true })) }`)
    await waitFor(`window.ascora.llm.config().then(c => c.openRouterModel === 'google/gemma-4-31b-it:free')`)
    console.log('openrouter: free models grouped first')

    // OmniRoute: auto first, then models that work without an account.
    await open('OmniRoute')
    await click('.omni-model-picker .provider-select-button')
    await waitFor(`document.querySelectorAll('.omni-model-group-head').length >= 3`)
    const omni = await evaluate(`Array.from(document.querySelectorAll('.omni-model-group')).map(g => ({
      head: g.querySelector('.omni-model-group-head').textContent,
      ids: Array.from(g.querySelectorAll('.omni-model-option')).map(o => o.title) }))`)
    assert.deepEqual(omni.slice(0, 2), [
      { head: 'auto', ids: ['auto', 'auto/best-coding'] },
      { head: 'Без аккаунта', ids: ['ddgw/claude-haiku-4-5', 'ddgw/gpt-5.4-mini'] }
    ])
    assert.ok(!omni.slice(2).some(group => group.ids.some(id => id.startsWith('ddgw/'))), 'DuckDuckGo models are not repeated')
    assert.ok(omni.slice(2).some(group => group.ids.includes('cfp/zai-org/glm-5.2')), 'other providers keep their own groups')
    await capture('omniroute-groups.png')
    await click('.omni-model-option[title="ddgw/gpt-5.4-mini"]')
    await waitFor(`window.ascora.llm.config().then(c => c.omnirouteModel === 'ddgw/gpt-5.4-mini')`)
    console.log('omniroute: no-account group pinned after auto')

    assert.deepEqual(errors, [])
    console.log('Model groups UI OK')
    app.exit(0)
  }).catch(error => { console.error(error, errors); app.exit(1) })
}
