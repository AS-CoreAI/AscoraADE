// node --test scripts/tests/omniroute-chat.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { once, EventEmitter } = require('node:events')
const { loadTypeScript } = require('./llm-fixture.cjs')
const production = loadTypeScript('src/main/llm/client.ts')
const { DEFAULT_LLM_CONFIG, IPC } = loadTypeScript('src/shared/ipc.ts')
const params = { messages: [{ role: 'user', content: 'Inspect the logs' }] }
const done = 'data: [DONE]\n\n'

async function gateway(t, handler) {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push(body ? JSON.parse(body) : { path: req.url })
    handler(requests.at(-1), res, requests.length)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const client = new production.LmStudioClient({ ...DEFAULT_LLM_CONFIG, provider: 'omniroute', omnirouteBaseUrl: baseUrl, omnirouteModel: 'test/model' })
  return { client, requests, baseUrl }
}

async function collect(client, signal, request = params) {
  const stream = client.streamChat(request, signal)
  let content = ''
  for (;;) {
    const next = await stream.next()
    if (next.done) return { ...next.value, content }
    content += next.value
  }
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

test('OmniRoute consumes JSON replies to stream:true without issuing a duplicate request', async t => {
  const { client, requests } = await gateway(t, (_req, res) => json(res, {
    choices: [{ message: { content: [{ type: 'text', text: '<think>Check</think>Answer' }] }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 4 }
  }))
  const result = await collect(client)
  assert.equal(result.content, 'Answer')
  assert.equal(result.thinking, 'Check')
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 })
  assert.equal(requests.length, 1)
})

test('empty-stream fallback preserves native tools, reasoning, usage and the request payload', async t => {
  const { client, requests } = await gateway(t, (req, res) => {
    if (req.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(done); return }
    json(res, { choices: [{ message: { content: null, reasoning_content: 'Read the log',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"log.txt"}' } }]
    }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 8, completion_tokens: 3 } })
  })
  const result = await collect(client, undefined, { ...params,
    tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }] })
  assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'read_file', arguments: '{"path":"log.txt"}' }])
  assert.equal(result.thinking, 'Read the log')
  assert.equal(result.finishReason, 'tool_calls')
  assert.deepEqual(result.usage, { inputTokens: 8, outputTokens: 3 })
  assert.equal(requests.length, 2)
  const { stream_options, ...initial } = requests[0]
  assert.deepEqual(requests[1], { ...initial, stream: false })
})

test('OmniRoute model discovery bypasses the Electron global fetch transport', async t => {
  const { client } = await gateway(t, (_req, res) => json(res, { data: [{ id: 'test/model' }] }))
  const previous = global.fetch
  global.fetch = () => { throw new Error('Electron fetch must not handle loopback discovery') }
  try { assert.deepEqual(await client.listModels(), [{ id: 'test/model' }]) }
  finally { global.fetch = previous }
})

test('fallback failures and empty replies are errors instead of successful silent turns', async t => {
  for (const ending of ['http', 'json-error', 'invalid-json', 'empty', 'disconnect']) {
    const { client, requests } = await gateway(t, (req, res) => {
      if (req.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(done); return }
      if (ending === 'http') json(res, { error: { message: 'Provider rejected authentication' } }, 403)
      else if (ending === 'json-error') json(res, { error: { message: 'Provider unavailable' } })
      else if (ending === 'invalid-json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{') }
      else if (ending === 'disconnect') res.destroy()
      else json(res, { choices: [{ message: { content: '' }, finish_reason: 'stop' }] })
    })
    await assert.rejects(collect(client), error => {
      assert.equal(error.kind, ['http', 'json-error'].includes(ending) ? 'http' : ending === 'disconnect' ? 'connection' : 'parse')
      if (ending === 'http') assert.match(error.message, /403.*Provider rejected authentication/)
      return true
    })
    assert.equal(requests.length, 2)
  }
})

test('Stop interrupts a silent fallback; valid SSE is not retried', async t => {
  let fallbackStarted
  const started = new Promise(resolve => { fallbackStarted = resolve })
  const { client, requests } = await gateway(t, (req, res) => {
    if (req.stream) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(done) }
    else fallbackStarted()
  })
  const controller = new AbortController()
  const pending = collect(client, controller.signal)
  await started
  controller.abort()
  await assert.rejects(pending, error => error.kind === 'aborted')
  assert.equal(requests.length, 2)
  const valid = await gateway(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"Ready"},"finish_reason":"stop"}]}\n\n' + done)
  })
  assert.equal((await collect(valid.client)).content, 'Ready')
  assert.equal(valid.requests.length, 1)
})

function ipcFixture(startOmniroute, seen) {
  const handlers = new Map()
  loadTypeScript('src/main/ipc/llm.ts', {
    electron: { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } },
    '../store': { getStore: () => ({ getSetting: () => undefined }) },
    '../llm/prompt-progress': { watchPromptProgress: async () => () => {} },
    '../omniroute/runner': { getOmnirouteBaseUrl: () => '', startOmniroute },
    '../llm/client': { ...production, LmStudioClient: class {
      constructor(config) { this.config = config }
      async listModels() { seen.push(this.config); return [{ id: 'test/model' }] }
      async *streamChat() { seen.push(this.config); yield 'Ready'; return { toolCalls: [] } }
    } }
  }).registerLlmHandlers()
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => {} })
  return { handlers, sender }
}

test('model discovery and chat wait for startup and use its current URL', async () => {
  let ready
  const startup = new Promise(resolve => { ready = resolve })
  const seen = []
  const { handlers, sender } = ipcFixture(() => startup, seen)
  const chat = handlers.get(IPC.llm.chat)({ sender }, 'boot-chat', { ...params, provider: 'omniroute' })
  const models = handlers.get(IPC.llm.listModels)({}, 'omniroute')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(seen.length, 0)
  ready({ state: 'ready', baseUrl: 'http://127.0.0.1:20130/v1' })
  assert.equal((await chat).content, 'Ready')
  assert.equal((await models).ok, true)
  assert.equal(seen.length, 2)
  assert.ok(seen.every(config => config.omnirouteBaseUrl === 'http://127.0.0.1:20130/v1'))
  assert.equal(sender.listenerCount('destroyed'), 0)
})

test('startup failure is surfaced and Stop cancels only the waiting chat', async () => {
  const failed = ipcFixture(async () => ({ state: 'error', error: 'Sidecar instrumentation failed' }), [])
  const failure = await failed.handlers.get(IPC.llm.chat)({ sender: failed.sender }, 'failed', { ...params, provider: 'omniroute' })
  assert.equal(failure.ok, false)
  assert.match(failure.error, /Sidecar instrumentation failed/)
  let ready
  const startup = new Promise(resolve => { ready = resolve })
  const seen = []
  const { handlers, sender } = ipcFixture(() => startup, seen)
  const cancelled = handlers.get(IPC.llm.chat)({ sender }, 'cancelled', { ...params, provider: 'omniroute' })
  const active = handlers.get(IPC.llm.chat)({ sender }, 'active', { ...params, provider: 'omniroute' })
  handlers.get(IPC.llm.abort)({}, 'cancelled')
  assert.equal((await cancelled).aborted, true)
  assert.equal(seen.length, 0)
  ready({ state: 'ready', baseUrl: 'http://127.0.0.1:20131/v1' })
  assert.equal((await active).content, 'Ready')
  assert.equal(seen.length, 1)
  assert.equal(sender.listenerCount('destroyed'), 0)
})
