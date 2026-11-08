// Production renderer, isolated settings and simulated providers/tools only.
const { resolve, join } = require('node:path')
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
} else if (process.type === 'renderer') {
  require('./settings-preload.cjs')
  const fixture = window.settingsFixture
  fixture.contextLength = 1000000
  fixture.stepRequests = []; fixture.toolResults = []; fixture.rounds = 70
  const chat = async (id, params) => {
    fixture.stepRequests.push({ id, params: structuredClone(params) })
    const turn = fixture.stepRequests.length
    await new Promise(resolve => setTimeout(resolve, 1))
    if (turn === fixture.holdAt) return new Promise(resolve => { fixture.releaseChat = resolve })
    if (turn > fixture.rounds) return { ok: true, content: 'All requested work completed.', finishReason: 'stop' }
    const call = { id: 'tool-' + turn, name: 'list_dir', arguments: '{"path":"."}' }
    return params.service
      ? { ok: true, content: '```tool_call\n{"name":"list_dir","arguments":{"path":"."}}\n```', finishReason: 'stop' }
      : { ok: true, content: '', toolCalls: [call], finishReason: 'tool_calls' }
  }
  const abort = async id => { fixture.abortId = id; fixture.releaseChat?.({ ok: true, content: '', aborted: true }) }
  const llm = window.ascora.llm
  window.ascora.llm = new Proxy(llm, { get: (target, method) => method === 'chat' ? chat : method === 'abort' ? abort : target[method] })
  window.ascora.wprovider = { chat, abort,
    check: async (service = 'qwen') => ({ ok: true, installed: true, loggedIn: true, service }),
    checkAll: async () => [], onCheckProgress: () => () => {}, onCheckAllProgress: () => () => {} }
  window.ascora.agent = { listDir: async () => {
    fixture.toolResults.push(fixture.toolResults.length + 1)
    return { ok: true, path: '.', entries: [{ name: 'fixture.txt', type: 'file' }] }
  } }
} else {
  const { app, BrowserWindow } = require('electron')
  const assert = require('node:assert/strict')
  const { mkdirSync, writeFileSync } = require('node:fs')
  const { once } = require('node:events')
  const output = resolve(__dirname, '../../.build/agent-steps-smoke')
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
  const reload = async () => { const ready = once(win.webContents, 'did-finish-load'); win.reload(); await ready; await waitFor(`!!document.querySelector('.ws-item')`) }
  const send = async text => {
    await evaluate(`{const input=document.querySelector('.composer-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true}));}`)
    await waitFor(`document.querySelector('.send-btn')?.disabled === false`)
    await click('.send-btn')
  }
  const general = async () => { await click('[title="Настройки языка и внешнего вида"]'); await click('[data-section="general"]') }
  const back = async () => { await click('.settings-back'); await waitFor(`!!document.querySelector('.composer-input')`) }
  app.whenReady().then(async () => {
    win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { preload: __filename,
      contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
    await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))
    for (const provider of ['lmstudio', 'ollama', 'unsloth', 'openrouter', 'omniroute', 'wprovider']) {
      await win.webContents.session.clearStorageData()
      await evaluate(`localStorage.setItem('settings-smoke-llm', JSON.stringify({provider:${JSON.stringify(provider)},
        openRouterEnabled:true,openRouterApiKey:'test-key',unslothApiKey:'test-key',model:'test-model'}))`)
      await reload(); await click('.ws-item'); await waitFor(`!!document.querySelector('.composer-input')`)
      await send('Finish 70 tool rounds')
      await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
      assert.equal(await evaluate('window.settingsFixture.toolResults.length'), 70, provider)
      assert.equal(await evaluate('window.settingsFixture.stepRequests.length'), 71, provider)
      assert.equal(await evaluate(`window.settingsFixture.savedTasks.at(-1).messages.filter(m=>m.kind==='tool').length`), 70, provider)
      assert.ok(!await evaluate(`window.settingsFixture.stepRequests.at(-1).params.messages.some(m=>m.content==='Continue')`), provider + ': no artificial continuation windows')
      console.log(provider + ': 70 tool rounds completed')
    }

    // The global opt-in is editable, persistent and enforced for a hosted backend.
    await general()
    assert.equal(await evaluate(`document.querySelector('.agent-step-limit-enabled').checked`), false)
    assert.equal(await evaluate(`document.querySelector('.agent-step-limit-count').value`), '16')
    assert.equal(await evaluate(`document.querySelector('.agent-step-limit-count').disabled`), true)
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await new Promise(resolve => setTimeout(resolve, 150))
    writeFileSync(join(output, 'step-limit-default-off.png'), (await win.webContents.capturePage()).toPNG())
    await click('.agent-step-limit-enabled')
    await waitFor(`document.querySelector('.agent-step-limit-count').disabled === false`)
    await evaluate(`{ const input=document.querySelector('.agent-step-limit-count'); input.value='3'; input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); }`)
    await waitFor(`window.ascora.settings.get('agent.stepLimit').then(v=>v.enabled&&v.maxSteps===3)`)
    await reload(); await click('.ws-item'); await general()
    assert.equal(await evaluate(`document.querySelector('.agent-step-limit-enabled').checked`), true)
    assert.equal(await evaluate(`document.querySelector('.agent-step-limit-count').value`), '3')
    await back(); await send('Run with the configured limit')
    await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
    assert.equal(await evaluate('window.settingsFixture.toolResults.length'), 3)
    assert.equal(await evaluate('window.settingsFixture.stepRequests.length'), 3)
    assert.ok(await evaluate(`window.settingsFixture.savedTasks.at(-1).messages.at(-1).text.includes('3 шагов')`))

    // Disable and reload: the next run can pass the old limit, and Stop still works.
    await general(); await click('.agent-step-limit-enabled'); await back(); await reload(); await click('.ws-item')
    assert.equal(await evaluate(`window.ascora.settings.get('agent.stepLimit').then(v=>v.enabled)`), false)
    await evaluate('window.settingsFixture.holdAt = 40')
    await send('Continue until I stop')
    await waitFor(`typeof window.settingsFixture.releaseChat === 'function'`)
    await click('.send-btn.stopping')
    await waitFor(`window.settingsFixture.savedTasks.at(-1)?.status === 'idle'`)
    assert.equal(await evaluate('window.settingsFixture.stepRequests.length'), 40)
    assert.equal(await evaluate('window.settingsFixture.toolResults.length'), 39)
    assert.equal(await evaluate('window.settingsFixture.abortId'), await evaluate('window.settingsFixture.stepRequests.at(-1).id'))
    assert.deepEqual(errors, [])
    console.log('Agent steps UI OK: all 6 chat backends pass 70 rounds; global limit defaults off, persists, stops at selected count, and manual Stop works')
    app.exit(0)
  }).catch(error => { console.error(error, errors); app.exit(1) })
}
