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

test('LM Studio per-request reasoning uses compatible values, preserves defaults and tools, and never leaks to other providers', async t => {
  const payloads = []
  const http = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    payloads.push(JSON.parse(body))
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(frame({ content: 'Done' }, 'stop') + done)
  })
  http.listen(0, '127.0.0.1'); await once(http, 'listening')
  t.after(() => { http.closeAllConnections(); http.close() })
  const baseUrl = `http://127.0.0.1:${http.address().port}/v1`
  const instance = new production.LmStudioClient({ ...DEFAULT_LLM_CONFIG, model: 'fixture', baseUrl, lmStudioReasoning: 'high' })
  const tools = [{ type: 'function', function: { name: 'list_dir', parameters: { type: 'object', properties: {} } } }]
  for (const reasoning of ['off', 'low', 'medium', 'xhigh', 'on', '']) {
    for await (const _ of instance.streamChat({ ...params, tools, reasoning, maxTokens: 900000 })) { /* consume */ }
  }
  assert.deepEqual(payloads.map(p => p.reasoning_effort), ['none', 'low', 'medium', 'xhigh', 'high', undefined])
  assert.ok(payloads.every(p => p.max_tokens === 900000))
  assert.ok(payloads.every(p => JSON.stringify(p.tools) === JSON.stringify(tools)))
  instance.update({ provider: 'ollama', ollamaBaseUrl: baseUrl, ollamaModel: 'fixture' })
  for await (const _ of instance.streamChat({ ...params, reasoning: 'low' })) { /* consume */ }
  assert.equal(payloads.at(-1).reasoning_effort, undefined)
})

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

test('local generation survives over 30 minutes of silent headers and body; hosted timeouts remain', async (t) => {
  // Advance Undici's real parser clock. A sub-second sleep is not enough to
  // exercise its coarse timeout scheduler, and can make regressions pass.
  const timers = require('undici/lib/util/timers')
  for (const provider of ['lmstudio', 'ollama', 'unsloth', 'omniroute']) {
    for (const bodyStarted of [false, true]) {
      let response, ready
      const arrived = new Promise(resolve => { ready = resolve })
      const url = await server(t, res => {
        response = res
        if (bodyStarted) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.write(frame({ reasoning_content: 'Preparing' }))
        } else ready()
      })
      const instance = new production.LmStudioClient({ ...DEFAULT_LLM_CONFIG, provider, model: 'fixture',
        baseUrl: url, ollamaBaseUrl: url, ollamaModel: 'fixture', unslothBaseUrl: url,
        unslothApiKey: 'fixture-key', unslothModel: 'fixture', omnirouteBaseUrl: url, omnirouteModel: 'fixture' })
      const pending = collect(instance, () => ready()).then(value => ({ value }), error => ({ error }))
      await arrived
      timers.tick(1000) // Arm pending parser timers before advancing their clock.
      timers.tick(31 * 60_000)
      await new Promise(resolve => setImmediate(resolve))
      if (provider !== 'omniroute') response.end(frame({ content: 'Ready' }, 'stop') + done)
      const result = await pending
      if (provider === 'omniroute') {
        assert.equal(result.error?.kind, 'timeout')
        assert.ok(result.error.message.includes(bodyStarted ? 'UND_ERR_BODY_TIMEOUT' : 'UND_ERR_HEADERS_TIMEOUT'))
      } else {
        assert.equal(result.error, undefined, provider + ': ' + result.error?.message)
        assert.equal(result.value.content, 'Ready')
      }
    }
  }
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
      '../llm/prompt-progress': { watchPromptProgress: async () => () => {} },
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
    assert.deepEqual(sent, [[IPC.llm.chunk, { id: 'test-id', delta: 'Partial answer', thinking: 'First second', promptProgress: null }]])
    assert.equal(sender.listenerCount('destroyed'), 0)
    assert.equal(result.thinking, 'First second')
    assert.equal(result.content, 'Partial answer')
    assert.equal(result.ok, ending !== 'connection')
    assert.equal(!!result.aborted, ending === 'aborted')
  }
})

test('IPC streams progress before output, clears it on every exit and ignores late log callbacks', async () => {
  for (const ending of ['success', 'abort', 'destroyed', 'failure']) {
    const handlers = new Map(), sent = []
    let release, reportProgress, stopped = 0
    const gate = new Promise(resolve => { release = resolve })
    const sender = Object.assign(new (require('node:events').EventEmitter)(), {
      isDestroyed: () => false, send: (...args) => sent.push(args)
    })
    loadTypeScript('src/main/ipc/llm.ts', {
      electron: { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } },
      '../store': { getStore: () => ({ getSetting: () => undefined }) },
      '../omniroute/runner': { getOmnirouteBaseUrl: () => '' },
      '../llm/prompt-progress': { watchPromptProgress: async (_base, _model, _count, _signal, emit) => {
        reportProgress = emit
        emit({ phase: 'processing', percent: 41.2, source: 'lmstudio-log' })
        return () => { stopped++ }
      } },
      '../llm/client': { ...production, LmStudioClient: class {
        async *streamChat(_params, signal, onThinking) {
          signal.addEventListener('abort', release, { once: true })
          await gate
          if (signal.aborted) throw new production.LmStudioError('Cancelled', 'aborted')
          if (ending === 'failure') throw new production.LmStudioError('Disconnected', 'connection')
          onThinking('Working')
          yield 'Done'
          return { toolCalls: [] }
        }
      } }
    }).registerLlmHandlers()
    const pending = handlers.get(IPC.llm.chat)({ sender }, 'progress-request', params)
    const deadline = Date.now() + 2000
    while (!sent.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(sent[0], [IPC.llm.chunk, { id: 'progress-request', delta: '',
      promptProgress: { phase: 'processing', percent: 41.2, source: 'lmstudio-log' } }])
    if (ending === 'abort') handlers.get(IPC.llm.abort)({}, 'progress-request')
    else if (ending === 'destroyed') sender.emit('destroyed')
    else release()
    const result = await pending
    assert.equal(result.ok, ending !== 'failure')
    assert.equal(Boolean(result.aborted), ending === 'abort' || ending === 'destroyed')
    assert.equal(sent.at(-1)[1].promptProgress, null)
    assert.ok(stopped > 0)
    assert.equal(sender.listenerCount('destroyed'), 0)
    const count = sent.length
    reportProgress({ phase: 'processing', percent: 99 })
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.equal(sent.length, count)
  }
})

test('GigaChat speaks the functions/function_call protocol and parses function_call deltas', async () => {
  const requests = []
  const fetchStub = async (url, init) => {
    requests.push({ url: String(url), body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null })
    if (String(url).includes('/oauth')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_at: Date.now() + 3600_000 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(
      frame({ function_call: { name: 'list_dir', arguments: { path: '.' } } }, 'function_call') + done,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts', { undici: { ...undici, fetch: fetchStub } })
  const instance = new LmStudioClient({ ...DEFAULT_LLM_CONFIG, provider: 'gigachat', gigachatAuthKey: 'auth-key', gigachatModel: 'GigaChat-2-Pro' })
  const tools = [{ type: 'function', function: { name: 'list_dir', description: 'List a directory', parameters: { type: 'object', properties: {} } } }]
  const messages = [
    { role: 'user', content: 'Look around' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'a.txt' }
  ]
  const stream = instance.streamChat({ messages, tools })
  let result
  for (;;) {
    const next = await stream.next()
    if (next.done) { result = next.value; break }
  }
  const chat = requests.find(r => r.url.endsWith('/chat/completions'))
  assert.deepEqual(chat.body.functions, [{ name: 'list_dir', description: 'List a directory', parameters: { type: 'object', properties: {} } }])
  assert.equal(chat.body.function_call, 'auto')
  assert.equal(chat.body.tools, undefined)
  assert.equal(chat.body.stream, true)
  assert.equal(chat.body.stream_options, undefined)
  assert.deepEqual(chat.body.messages, [
    { role: 'user', content: 'Look around' },
    { role: 'assistant', content: '', function_call: { name: 'list_dir', arguments: { path: '.' } } },
    { role: 'function', name: 'list_dir', content: '{"output":"a.txt"}' }
  ])
  assert.deepEqual(result.toolCalls, [{ id: '', name: 'list_dir', arguments: '{"path":"."}' }])
  assert.equal(result.finishReason, 'function_call')
})

test('GigaChat sends reasoning_effort only when a level is selected', async () => {
  const payloads = []
  const fetchStub = async (url, init) => {
    if (String(url).includes('/oauth')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_at: Date.now() + 3600_000 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    payloads.push(JSON.parse(init.body))
    return new Response(frame({ content: 'Done' }, 'stop') + done,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts', { undici: { ...undici, fetch: fetchStub } })
  // Config-level default is overridden per request; an empty selection keeps
  // reasoning off (no parameter) even when a default is configured.
  const instance = new LmStudioClient({ ...DEFAULT_LLM_CONFIG, provider: 'gigachat', gigachatAuthKey: 'auth-key', gigachatModel: 'GigaChat-3-Ultra', gigachatReasoning: 'high' })
  for (const reasoning of ['', 'low', 'medium', 'high']) {
    for await (const _ of instance.streamChat({ ...params, reasoning })) { /* consume */ }
  }
  assert.deepEqual(payloads.map(p => p.reasoning_effort), [undefined, 'low', 'medium', 'high'])
})

test('GigaChat retries without functions when the model rejects them', async () => {
  let chatTries = 0
  const payloads = []
  const fetchStub = async (url, init) => {
    if (String(url).includes('/oauth')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_at: Date.now() + 3600_000 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    payloads.push(JSON.parse(init.body))
    chatTries++
    if (chatTries === 1) {
      return new Response(JSON.stringify({ status: 422, message: 'Invalid params: requested model does not support functions' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(frame({ content: 'Работаю без функций' }, 'stop') + done,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts', { undici: { ...undici, fetch: fetchStub } })
  const instance = new LmStudioClient({ ...DEFAULT_LLM_CONFIG, provider: 'gigachat', gigachatAuthKey: 'auth-key', gigachatModel: 'GigaChat-2' })
  const tools = [{ type: 'function', function: { name: 'list_dir', description: 'List a directory', parameters: { type: 'object', properties: {} } } }]
  const stream = instance.streamChat({ messages: [{ role: 'user', content: 'hi' }], tools })
  let content = ''
  for (;;) {
    const next = await stream.next()
    if (next.done) break
    content += next.value
  }
  assert.equal(content, 'Работаю без функций')
  assert.equal(chatTries, 2)
  assert.ok(payloads[0].functions)
  assert.equal(payloads[1].functions, undefined)
  assert.equal(payloads[1].function_call, undefined)
})
