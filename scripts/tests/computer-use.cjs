// node --test scripts/tests/computer-use.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { validateComputerAction } = loadTypeScript('src/shared/computer.ts')
const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts')
const { DEFAULT_LLM_CONFIG, IPC } = loadTypeScript('src/shared/ipc.ts')
const frame = { id: 'latest', width: 1280, height: 720, image: 'data:image/jpeg;base64,fixture' }

test('actions require a current frame, bounded coordinates/text/scroll and supported shortcuts', () => {
  assert.deepEqual(validateComputerAction({ action: 'screenshot' }), { action: 'screenshot' })
  for (const args of [
    { action: 'click', frame_id: 'old', x: 1, y: 2 },
    { action: 'click', frame_id: frame.id, x: 1280, y: 2 },
    { action: 'click', frame_id: frame.id, x: -1, y: 2 },
    { action: 'click', frame_id: frame.id, x: 1.5, y: 2 },
    { action: 'drag', frame_id: frame.id, x: 1, y: 2, to_x: 2, to_y: 999 },
    { action: 'scroll', frame_id: frame.id, x: 1, y: 2, direction: 'down', amount: 100 },
    { action: 'type', frame_id: frame.id, text: 'a'.repeat(2001) },
    { action: 'type', frame_id: frame.id, text: '\0' },
    { action: 'key', frame_id: frame.id, key: 'CTRL+;Remove-Item' },
    { action: 'launch', command: 'whatever' }
  ]) assert.throws(() => validateComputerAction(args, frame))
  assert.equal(validateComputerAction({ action: 'key', frame_id: frame.id, key: 'ctrl+shift+s' }, frame).key, 'CTRL+SHIFT+S')
  assert.equal(validateComputerAction({ action: 'type', frame_id: frame.id, text: 'Привет! "$(test)"\n你好' }, frame).text, 'Привет! "$(test)"\n你好')
  assert.equal(validateComputerAction({ action: 'move', frame_id: frame.id, x: 0, y: 0, foregroundWindow: 'injected' }, frame).foregroundWindow, undefined)
})

test('LM Studio capabilities match custom loaded instance IDs and require both vision and tools', async t => {
  let capabilities = { vision: true, trained_for_tool_use: true }
  t.mock.method(global, 'fetch', async url => {
    assert.equal(url, 'http://localhost:1234/api/v1/models')
    return new Response(JSON.stringify({ models: [{ key: 'qwen/model', type: 'llm', loaded_instances: [{ id: 'my-custom-model' }], capabilities }] }))
  })
  const client = new LmStudioClient(DEFAULT_LLM_CONFIG)
  assert.equal((await client.computerSupport('my-custom-model')).available, true)
  capabilities.vision = false
  assert.equal((await client.computerSupport('my-custom-model')).available, false)
  capabilities = { vision: true, trained_for_tool_use: false }
  assert.equal((await client.computerSupport('qwen/model')).available, false)
  assert.equal((await client.computerSupport('unknown')).reason, 'unknown')
  client.update({ provider: 'ollama' })
  assert.equal((await client.computerSupport('qwen/model')).reason, 'provider')
})

test('screenshots serialize as actual image inputs while text/tool messages stay intact', async () => {
  const undici = require('undici')
  let payload
  const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts', {
    undici: { ...undici, fetch: async (_url, options) => {
      payload = JSON.parse(options.body)
      return new Response('data: [DONE]\n\n')
    } }
  })
  const messages = [{ role: 'tool', tool_call_id: 'call', content: 'screenshot captured' },
    { role: 'user', content: 'Current screen', images: [frame.image] }]
  for await (const chunk of new LmStudioClient(DEFAULT_LLM_CONFIG).streamChat({ messages })) { /* finish */ }
  assert.deepEqual(payload.messages[0], messages[0])
  assert.deepEqual(payload.messages[1].content, [{ type: 'text', text: 'Current screen' }, { type: 'image_url', image_url: { url: frame.image } }])
  assert.equal(payload.messages[1].images, undefined)
  assert.equal(messages[1].content, 'Current screen')
})

function fixture() {
  const handlers = new Map()
  const config = { ...DEFAULT_LLM_CONFIG, model: 'vision-model' }
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (...args) => notifications.push(args) })
  const notifications = [], actions = []
  let available = true, shortcut, display = { id: 42, size: { width: 1920, height: 1080 }, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 }
  const overrides = {
    electron: {
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      globalShortcut: { register: (_key, fn) => { shortcut = fn; return true }, unregister: () => { shortcut = undefined } },
      desktopCapturer: { getSources: async () => [{ display_id: '42', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 1280, height: 720 }), toJPEG: () => Buffer.from('fake-screenshot') } }] },
      screen: { getPrimaryDisplay: () => display, dipToScreenPoint: point => ({ x: point.x * 1.5, y: point.y * 1.5 }) }
    },
    './llm': { readConfig: () => config },
    '../llm/client': { LmStudioClient: class { async computerSupport() { return { available } } } },
    '../computer/windows': { runWindowsInput: async (action, signal, foregroundWindow) => {
      assert.equal(signal.aborted, false)
      if (action.action !== 'probe') actions.push({ action, foregroundWindow })
      return '12345'
    } },
    'node:timers/promises': { setTimeout: async () => {} }
  }
  loadTypeScript('src/main/ipc/computer.ts', overrides).registerComputerHandlers()
  const call = (name, ...args) => handlers.get(IPC.computer[name])({ sender: owner }, ...args)
  return { call, handlers, owner, actions, notifications, config,
    hotkey: () => shortcut(), setAvailable: value => { available = value },
    changeDisplay: () => { display = { ...display, scaleFactor: 2 } } }
}

test('desktop sessions are exclusive, owner-bound, scale coordinates and restore the observed window', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture()
  const start = await f.call('start', 'task', 'vision-model')
  assert.equal(start.ok, true)
  assert.equal((await f.call('start', 'other', 'vision-model')).ok, false)
  const snap = await f.call('action', start.sessionId, { action: 'screenshot' })
  const click = await f.call('action', start.sessionId, { action: 'click', frame_id: snap.frame.id, x: 640, y: 360 })
  assert.equal(click.ok, true)
  assert.deepEqual(f.actions[0].action, { action: 'click', frame_id: snap.frame.id, x: -1440, y: 810, button: 'left' })
  assert.equal(f.actions[0].foregroundWindow, '12345')
  assert.equal((await f.call('action', start.sessionId, { action: 'click', frame_id: snap.frame.id, x: 1, y: 1 })).ok, false)
  assert.equal((await f.handlers.get(IPC.computer.action)({ sender: {} }, start.sessionId, { action: 'screenshot' })).ok, false)
  f.changeDisplay()
  assert.match((await f.call('action', start.sessionId, { action: 'key', frame_id: click.frame.id, key: 'ENTER' })).error, /layout changed/)
  f.hotkey()
  assert.deepEqual(f.notifications, [[IPC.computer.stopped, 'task']])
  assert.equal((await f.call('action', start.sessionId, { action: 'screenshot' })).ok, false)
  assert.equal(f.owner.listenerCount('destroyed'), 0)
})

test('unsupported models, renderer reloads, Stop and provider changes revoke desktop access', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture()
  f.setAvailable(false)
  assert.equal((await f.call('start', 'task', 'vision-model')).ok, false)
  f.setAvailable(true)
  for (const ending of ['stop', 'reload', 'provider']) {
    f.config.provider = 'lmstudio'
    const start = await f.call('start', 'task', 'vision-model')
    assert.equal(start.ok, true)
    if (ending === 'stop') await f.call('stop', start.sessionId)
    if (ending === 'reload') f.owner.emit('did-start-loading')
    if (ending === 'provider') f.config.provider = 'ollama'
    assert.equal((await f.call('action', start.sessionId, { action: 'screenshot' })).ok, false)
    assert.equal(f.owner.listenerCount('destroyed'), 0)
  }
})
