// Run after npm run build: node scripts/tests/openrouter-incomplete-ui.cjs
// Production renderer, isolated settings and a scripted OpenRouter backend only.
const { resolve, join } = require('node:path')
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
} else if (process.type === 'renderer') {
  require('./settings-preload.cjs')
  const fixture = window.settingsFixture
  fixture.stepRequests = []; fixture.toolResults = []; fixture.script = []
  const chat = async (id, params) => {
    fixture.stepRequests.push({ id, params: structuredClone(params) })
    await new Promise(resolve => setTimeout(resolve, 1))
    const turn = fixture.script.shift() ?? { kind: 'final' }
    if (turn.kind === 'tool') {
      const call = { id: 'tool-' + fixture.stepRequests.length, name: 'list_dir', arguments: '{"path":"."}' }
      return { ok: true, content: '', toolCalls: [call], finishReason: 'tool_calls' }
    }
    if (turn.kind === 'final') return { ok: true, content: 'All requested work completed.', finishReason: 'stop' }
    return { ok: true, content: turn.content ?? '', ...(turn.thinking ? { thinking: turn.thinking } : {}), finishReason: turn.finishReason }
  }
  const llm = window.ascora.llm
  window.ascora.llm = new Proxy(llm, { get: (target, method) => method === 'chat' ? chat : method === 'abort' ? async () => {} : target[method] })
  window.ascora.agent = { listDir: async () => {
    fixture.toolResults.push(fixture.toolResults.length + 1)
    return { ok: true, path: '.', entries: [{ name: 'fixture.txt', type: 'file' }] }
  } }
} else {
  const { app, BrowserWindow } = require('electron')
  const assert = require('node:assert/strict')
  const { mkdirSync } = require('node:fs')
  const { once } = require('node:events')
  const output = resolve(__dirname, '../../.build/openrouter-incomplete-smoke')
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
  const send = async text => {
    await evaluate(`{const input=document.querySelector('.composer-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true}));}`)
    await waitFor(`document.querySelector('.send-btn')?.disabled === false`)
    await click('.send-btn')
  }
  /** Fresh profile, OpenRouter selected, scripted turns, one user request. */
  const run = async (script, text) => {
    await win.webContents.session.clearStorageData()
    await evaluate(`localStorage.setItem('settings-smoke-llm', JSON.stringify({provider:'openrouter',
      openRouterEnabled:true,openRouterApiKey:'test-key',openRouterModel:'openrouter/free'}))`)
    const ready = once(win.webContents, 'did-finish-load'); win.reload(); await ready
    await waitFor(`!!document.querySelector('.ws-item')`)
    await evaluate(`window.settingsFixture.script = ${JSON.stringify(script)}`)
    await click('.ws-item'); await waitFor(`!!document.querySelector('.composer-input')`)
    await send(text)
    await waitFor(`['idle','error'].includes(window.settingsFixture.savedTasks.at(-1)?.status)`)
    return evaluate(`({ requests: window.settingsFixture.stepRequests.map(r => r.params.messages),
      tools: window.settingsFixture.toolResults.length,
      messages: window.settingsFixture.savedTasks.at(-1).messages.map(m => ({ kind: m.kind, reasoning: !!m.reasoning, text: m.text })) })`)
  }
  const resumed = messages => messages.at(-1)?.role === 'user' && messages.at(-1).content.startsWith('Your previous response ended before a complete answer')
  const visible = state => state.messages.filter(m => m.kind === 'text' && !m.reasoning).map(m => m.text)

  app.whenReady().then(async () => {
    win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { preload: __filename,
      contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
    await win.loadFile(resolve(__dirname, '../../out/renderer/index.html'))

    // An empty stream and a reasoning-only truncated turn mid-task are resumed.
    let state = await run([
      { kind: 'tool' },
      { kind: 'empty', finishReason: 'stop' },
      { kind: 'empty', thinking: 'Planning the next listing', finishReason: 'length' },
      { kind: 'tool' },
      { kind: 'final' }
    ], 'List the project twice')
    assert.equal(state.requests.length, 5)
    assert.equal(state.tools, 2)
    assert.ok(resumed(state.requests[2]) && resumed(state.requests[3]), 'blank and truncated turns ask the model to continue')
    assert.ok(state.requests[3].at(-1).content.includes('Planning the next listing'), 'reasoning-only draft travels with the continuation')
    assert.ok(!visible(state).some(text => text.includes('no content returned')), 'no blank reply is shown')
    assert.equal(visible(state).at(-1), 'All requested work completed.')
    console.log('openrouter: blank and truncated turns resumed until the final answer')

    // A truncated visible answer is kept on screen but is not the final turn.
    state = await run([{ kind: 'empty', content: 'Half of the ans', finishReason: 'length' }, { kind: 'final' }], 'Explain the project')
    assert.equal(state.requests.length, 2)
    assert.ok(resumed(state.requests[1]) && state.requests[1].at(-1).content.includes('Half of the ans'))
    assert.deepEqual(visible(state).slice(-2), ['Half of the ans', 'All requested work completed.'])
    console.log('openrouter: truncated answer continued')

    // Recovery is bounded: three consecutive empty turns stop with an explanation.
    const empty = { kind: 'empty', finishReason: 'stop' }
    state = await run([empty, empty, empty, { kind: 'final' }], 'Keep going')
    assert.equal(state.requests.length, 3)
    assert.equal(await evaluate('window.settingsFixture.savedTasks.at(-1).status'), 'error')
    assert.ok(visible(state).at(-1).includes('Модель остановилась без полного ответа'))
    console.log('openrouter: recovery stops after three empty turns')

    // A content-filter result is a real outcome, not an interruption.
    state = await run([{ kind: 'empty', finishReason: 'content_filter' }, { kind: 'final' }], 'Filtered request')
    assert.equal(state.requests.length, 1)
    assert.ok(visible(state).at(-1).includes('no content returned'))
    console.log('openrouter: content filter is not retried')

    assert.deepEqual(errors, [])
    console.log('OpenRouter incomplete-turn UI OK')
    app.exit(0)
  }).catch(error => { console.error(error, errors); app.exit(1) })
}
