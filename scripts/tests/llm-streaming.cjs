// node --test scripts/tests/llm-streaming.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { once } = require('node:events')
const undici = require('undici')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { DEFAULT_LLM_CONFIG, IPC } = loadTypeScript('src/shared/ipc.ts')
const production = loadTypeScript('src/main/llm/client.ts')
const params = { messages: [{ role: 'user', content: 'Inspect the logs' }] }
const frame = (delta, finish_reason) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`
const done = 'data: [DONE]\n\n'

async function server(t, handler) {
  const http = createServer(async (req, res) => {
    for await (const chunk of req) { /* drain the request */ }
    handler(res)
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  t.after(() => { http.closeAllConnections(); http.close() })
  return `http://127.0.0.1:${http.address().port}/v1`
}

function client(baseUrl, Client = production.LmStudioClient) {
  return new Client({ ...DEFAULT_LLM_CONFIG, provider: 'lmstudio', baseUrl, model: 'fixture' })
}

async function collect(instance, onThinking, signal, onContent) {
  const stream = instance.streamChat(params, signal, onThinking)
  let content = ''
  for (;;) {
    const result = await stream.next()
    if (result.done) return { content, ...result.value }
    content += result.value
    onContent?.(result.value)
  }
}

test('long prefill and gaps survive the old timeout (time scaled by 10,000)', async (t) => {
  const agents = []
  const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts', {
    undici: { ...undici, Agent: class extends undici.Agent {
      constructor(options) {
        // Preserve relative timings: the old 300s becomes 30ms, new 1800s 180ms.
        super({ ...options, headersTimeout: (options.headersTimeout ?? 300_000) / 10_000,
          bodyTimeout: (options.bodyTimeout ?? 300_000) / 10_000 })
        agents.push(this)
      }
    } }
  })
  t.after(async () => { await Promise.all(agents.map(agent => agent.destroy())) })
  const url = await server(t, res => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': processing prompt\n\n')
      setTimeout(() => res.end(frame({ content: 'Ready' }, 'stop') + done), 80)
    }, 80)
  })
  assert.equal((await collect(client(url, LmStudioClient))).content, 'Ready')
})

test('reasoning_content and reasoning arrive before the answer and preserve native tool calls', async (t) => {
  let response
  let reasoningReady
  const ready = new Promise(resolve => { reasoningReady = resolve })
  const url = await server(t, res => {
    response = res
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(frame({ reasoning_content: 'Проверю ' }))
  })
  const thoughts = []
  const answers = []
  const resultPromise = collect(client(url), delta => { thoughts.push(delta); reasoningReady() }, undefined, delta => answers.push(delta))
  await ready
  assert.deepEqual(thoughts, ['Проверю '], 'Reasoning must be visible while generation is still running')
  assert.deepEqual(answers, [])
  response.end(frame({ reasoning: 'журнал.' }) + frame({ content: 'Checking logs.' }) +
    frame({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'list_dir', arguments: '{"pa' } }] }) +
    frame({ tool_calls: [{ index: 0, function: { arguments: 'th":"."}' } }] }, 'tool_calls') + done)
  const result = await resultPromise
  assert.equal(result.content, 'Checking logs.')
  assert.equal(result.thinking, 'Проверю журнал.')
  assert.ok(result.thinkingMs >= 0)
  assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'list_dir', arguments: '{"path":"."}' }])
})

test('inline thinking markers may span arbitrary content chunks; literal answer tags survive', async (t) => {
  for (const [input, thought, answer] of [
    [' \n<think>Проверю журнал.</think>Готово', 'Проверю журнал.', 'Готово'],
    ['<analysis>Working</analysis>Done', 'Working', 'Done'],
    ['Example: <think>literal</think>', undefined, 'Example: <think>literal</think>'],
    ['<thin', undefined, '<thin'],
    ['<think>unfinished reasoning', 'unfinished reasoning', '']
  ]) {
    const url = await server(t, res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end([...input].map(content => frame({ content })).join('') + done)
    })
    const result = await collect(client(url))
    assert.equal(result.thinking, thought)
    assert.equal(result.content, answer)
  }
})

test('Stop cancels both silent prompt processing and an active reasoning stream', async (t) => {
  for (const started of [false, true]) {
    const url = await server(t, res => {
      if (started) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(frame({ reasoning_content: 'Still working' }))
      }
    })
    const controller = new AbortController()
    const pending = collect(client(url), undefined, controller.signal)
    setTimeout(() => controller.abort(), 35)
    await assert.rejects(pending, error => error.kind === 'aborted')
  }
})

test('body/header timeouts and stream disconnects have actionable errors', async () => {
  for (const code of ['UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']) {
    const failure = new TypeError('terminated', { cause: Object.assign(new Error(code), { code }) })
    const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts', {
      undici: { ...undici, fetch: async () => {
        if (code === 'UND_ERR_HEADERS_TIMEOUT') throw failure
        return new Response(new ReadableStream({ start(controller) { controller.error(failure) } }))
      } }
    })
    await assert.rejects(collect(client('http://localhost/v1', LmStudioClient)), error =>
      error.kind === (code === 'UND_ERR_SOCKET' ? 'connection' : 'timeout') &&
      error.message.includes('LM Studio') && error.message.includes(code) && error.message !== 'terminated')
  }
})

test('IPC forwards accumulated reasoning and retains it on cancellation/failure', async () => {
  for (const ending of ['success', 'aborted', 'connection']) {
    const handlers = new Map()
    const sent = []
    const overrides = {
      electron: { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } },
      '../store': { getStore: () => ({ getSetting: () => undefined }) },
      '../omniroute/runner': { getOmnirouteBaseUrl: () => '', startOmniroute: async () => {} },
      '../llm/client': { ...production, LmStudioClient: class {
        async *streamChat(_params, _signal, onThinking) {
          onThinking('First ')
          onThinking('second')
          yield 'Partial answer'
          if (ending !== 'success') throw new production.LmStudioError('Fixture interruption', ending)
          return { toolCalls: [], thinking: 'First second', thinkingMs: 10 }
        }
      } }
    }
    loadTypeScript('src/main/ipc/llm.ts', overrides).registerLlmHandlers()
    const sender = Object.assign(new (require('node:events').EventEmitter)(), { isDestroyed: () => false, send: (...args) => sent.push(args) })
    const result = await handlers.get(IPC.llm.chat)({ sender }, 'test-id', params)
    assert.deepEqual(sent, [[IPC.llm.chunk, { id: 'test-id', delta: 'Partial answer', thinking: 'First second' }]])
    assert.equal(sender.listenerCount('destroyed'), 0)
    assert.equal(result.thinking, 'First second')
    assert.equal(result.content, 'Partial answer')
    assert.equal(result.ok, ending !== 'connection')
    assert.equal(!!result.aborted, ending === 'aborted')
  }
})
