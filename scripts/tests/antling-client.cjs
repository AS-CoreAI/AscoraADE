// node --test scripts/tests/antling-client.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const undici = require('undici')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { DEFAULT_LLM_CONFIG, ANT_LING_BASE_URL, ANT_LING_MODELS, IPC } = loadTypeScript('src/shared/ipc.ts')
const key = 'antling-fixture-key'
const frame = json => `data:${JSON.stringify(json)}\r\n\r\n`

function fixture(handler, config = {}) {
  const requests = []
  const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts', {
    undici: { ...undici, fetch: async (url, init) => {
      const request = { url, ...init, body: JSON.parse(init.body) }
      requests.push(request)
      return handler(request)
    } }
  })
  return { requests, LmStudioClient, client: new LmStudioClient({ ...DEFAULT_LLM_CONFIG, provider: 'antling',
    antlingApiKey: `Authorization: Bearer ${key}`, ...config }) }
}

async function collect(client, params = { messages: [{ role: 'user', content: 'Hello' }] }, signal) {
  let content = '', thinking = ''
  const stream = client.streamChat(params, signal, delta => { thinking += delta })
  for (;;) {
    const next = await stream.next()
    if (next.done) return { content, streamedThinking: thinking, ...next.value }
    content += next.value
  }
}

test('Ant Ling presets require a key but never call the undocumented discovery endpoint', async t => {
  t.mock.method(global, 'fetch', () => { throw Error('Discovery must not make an HTTP request') })
  const { client, requests } = fixture(() => { throw Error('Unexpected chat') }, { antlingModel: 'custom-model' })
  assert.deepEqual((await client.listModels()).map(m => m.id), [...ANT_LING_MODELS, 'custom-model'])
  client.update({ antlingModel: '' })
  assert.deepEqual((await client.listModels()).map(m => m.id), ANT_LING_MODELS)
  client.update({ antlingApiKey: '' })
  await assert.rejects(client.listModels(), /requires an API key/)
  await assert.rejects(collect(client), /requires an API key/)
  assert.equal(requests.length, 0)
})

test('Ant Ling uses its own model, Bearer auth, documented limits and preserves tool/image messages', async () => {
  const { client, requests } = fixture(() => new Response(frame({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] })), {
    model: 'lmstudio-model-must-not-leak', antlingModel: '', lmStudioReasoning: 'high'
  })
  const messages = [
    { role: 'user', content: 'Inspect this', images: ['data:image/png;base64,fixture'] },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'file content' }
  ]
  const tools = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }]
  await collect(client, { messages, tools, temperature: 1.8, maxTokens: 128 })
  const request = requests[0]
  assert.equal(request.url, `${ANT_LING_BASE_URL}/chat/completions`)
  assert.equal(request.headers.Authorization, `Bearer ${key}`)
  assert.equal(request.headers['HTTP-Referer'], undefined)
  assert.equal(request.body.model, 'Ling-3.2-flash')
  assert.equal(request.body.temperature, 1)
  assert.equal(request.body.max_completion_tokens, 128)
  assert.equal(request.body.max_tokens, undefined)
  assert.equal(request.body.stream, true)
  assert.equal(request.body.stream_options, undefined)
  assert.equal(request.body.reasoning_effort, undefined)
  assert.equal(request.body.thinking, undefined)
  assert.deepEqual(request.body.tools, tools)
  assert.deepEqual(request.body.messages[0].content, [{ type: 'text', text: 'Inspect this' }, { type: 'image_url', image_url: { url: messages[0].images[0] } }])
  assert.deepEqual(request.body.messages.slice(1), messages.slice(1))
  await collect(client, { messages: [], model: 'Ling-3.1-flash', reasoning: 'off', temperature: -1 })
  assert.equal(requests[1].body.model, 'Ling-3.1-flash')
  assert.equal(requests[1].body.temperature, 0)
  assert.deepEqual(requests[1].body.thinking, { type: 'disabled' })
})

test('Ant Ling assembles fragmented UTF-8, reasoning, native tool calls and final usage without DONE or LF', async () => {
  const data = Buffer.from([
    frame({ choices: [{ delta: { reasoning_content: 'Check the file.' } }] }),
    frame({ choices: [{ delta: { content: 'Привет' } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"pa' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] }, finish_reason: 'tool_calls' }] }),
    'data:' + JSON.stringify({ choices: [], usage: { prompt_tokens: 31, completion_tokens: 12 } })
  ].join(''))
  const { client } = fixture(() => new Response(new ReadableStream({ start(controller) {
    // Force boundaries within both UTF-8 characters and JSON values.
    for (let i = 0; i < data.length; i += 7) controller.enqueue(data.subarray(i, i + 7))
    controller.close()
  } })))
  const result = await collect(client)
  assert.equal(result.content, 'Привет')
  assert.equal(result.thinking, 'Check the file.')
  assert.equal(result.streamedThinking, result.thinking)
  assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}' }])
  assert.equal(result.finishReason, 'tool_calls')
  assert.deepEqual(result.usage, { inputTokens: 31, outputTokens: 12 })
})

test('Ant Ling saves independent reasoning and temperature controls, with explicit auto and off overrides', async () => {
  const { client, requests } = fixture(() => new Response(frame({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] })), {
    antlingReasoning: 'on', antlingTemperature: 0.35, lmStudioReasoning: 'high'
  })
  await collect(client)
  assert.deepEqual(requests.at(-1).body.thinking, { type: 'enabled' })
  assert.equal(requests.at(-1).body.temperature, 0.35)
  await collect(client, { messages: [], reasoning: 'off', temperature: 0 })
  assert.deepEqual(requests.at(-1).body.thinking, { type: 'disabled' })
  assert.equal(requests.at(-1).body.temperature, 0)
  await collect(client, { messages: [], reasoning: '', temperature: null })
  assert.equal(requests.at(-1).body.thinking, undefined)
  assert.equal(requests.at(-1).body.temperature, undefined)
  await collect(client, { messages: [], reasoning: 'high' })
  assert.deepEqual(requests.at(-1).body.thinking, { type: 'enabled' }, 'Never send an effort name as thinking.type')
  client.update({ antlingReasoning: 'off', antlingTemperature: null })
  await collect(client)
  assert.deepEqual(requests.at(-1).body.thinking, { type: 'disabled' })
  assert.equal(requests.at(-1).body.temperature, undefined)
})

test('Second turn content streams without reasoning and without importing the previous thinking state', async () => {
  let turn = 0
  const { client, requests } = fixture(() => new Response(++turn === 1
    ? frame({ choices: [{ delta: { reasoning_content: 'Private reasoning.' } }] }) + frame({ choices: [{ delta: { content: 'Four.' }, finish_reason: 'stop' }] }) + 'data:[DONE]\n\n'
    : frame({ choices: [{ delta: { content: 'Six.' }, finish_reason: 'stop' }] }) + 'data:[DONE]\n\n'))
  const messages = [{ role: 'user', content: 'Two plus two?' }]
  const first = await collect(client, { messages })
  assert.equal(first.content, 'Four.')
  assert.equal(first.thinking, 'Private reasoning.')
  messages.push({ role: 'assistant', content: first.content }, { role: 'user', content: 'Three plus three?' })
  const second = await collect(client, { messages })
  assert.equal(second.content, 'Six.')
  assert.equal(second.thinking, undefined)
  assert.equal(second.streamedThinking, '')
  assert.deepEqual(requests[1].body.messages, messages)
})

test('HTTP gateway blocks, auth/quota errors, stream errors and empty responses stay actionable', async () => {
  const blocked = fixture(() => new Response('<!DOCTYPE html><html>blocked</html>', { status: 403 }))
  await assert.rejects(collect(blocked.client), e => e.status === 403 && /HTML gateway/.test(e.message) && !e.message.includes('<html>'))
  for (const status of [401, 402, 429, 503]) {
    const failed = fixture(() => new Response(JSON.stringify({ message: 'Provider error detail' }), { status }))
    await assert.rejects(collect(failed.client), e => e.status === status && /Provider error detail/.test(e.message))
    assert.equal(failed.requests.length, 1, 'Do not retry authentication or quota failures')
  }
  const failedStream = fixture(() => new Response(frame({ error: { message: 'Token quota exceeded' } })))
  await assert.rejects(collect(failedStream.client), /Ant Ling stream error: Token quota exceeded/)
  const empty = fixture(() => new Response('data:[DONE]\n\n'))
  await assert.rejects(collect(empty.client), e => e.kind === 'parse' && /no chat content/.test(e.message))
  const thinkingOnly = fixture(() => new Response(frame({ choices: [{ delta: { reasoning_content: 'Still thinking.' }, finish_reason: 'length' }] }) + 'data:[DONE]\n\n'))
  await assert.rejects(collect(thinkingOnly.client), e => e.kind === 'parse' && /no final answer/.test(e.message))
  const filteredEmpty = fixture(() => new Response(frame({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })))
  assert.equal((await collect(filteredEmpty.client)).finishReason, 'content_filter', 'Keep filter diagnostics even without a refusal body')
})

test('cancelling a pending Ant Ling stream aborts and releases its reader', async () => {
  let released = false
  const { client } = fixture(request => new Response(new ReadableStream({
    start(controller) { request.signal.addEventListener('abort', () => { released = true; controller.error(new DOMException('Aborted', 'AbortError')) }) }
  })))
  const controller = new AbortController()
  const pending = collect(client, undefined, controller.signal)
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(pending, e => e.kind === 'aborted')
  assert.equal(released, true)
})

test('IPC accepts Ant Ling probes, labels presets, normalizes credentials and restores blank models', async () => {
  const settings = new Map([['antling.model', '']]), handlers = new Map(), probes = []
  const overrides = {
    electron: { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } },
    '../llm/prompt-progress': { watchPromptProgress: async () => () => {} },
    '../store': { getStore: () => ({ getSetting: key => settings.get(key), setSetting: (key, value) => settings.set(key, value) }) },
    '../llm/client': { LmStudioError: Error, LmStudioClient: class {
      constructor(config) { this.config = config }
      update(patch) { Object.assign(this.config, patch) }
      async listModels() { probes.push(this.config); return [{ id: this.config.antlingModel }] }
    } },
    '../omniroute/runner': { getOmnirouteBaseUrl: () => '', startOmniroute: async () => {} }
  }
  loadTypeScript('src/main/ipc/llm.ts', overrides).registerLlmHandlers()
  const config = () => handlers.get(IPC.llm.config)()
  assert.equal(config().antlingModel, 'Ling-3.2-flash')
  handlers.get(IPC.llm.setConfig)(null, { antlingApiKey: `Authorization: Bearer ${key}`, antlingModel: ' Ling-3.1-flash ' })
  assert.equal(config().antlingApiKey, key)
  assert.equal(config().antlingModel, 'Ling-3.1-flash')
  const result = await handlers.get(IPC.llm.listModels)(null, 'antling')
  assert.equal(result.ok, true)
  assert.equal(result.source, 'preset')
  assert.equal(probes.at(-1).provider, 'antling')
  assert.equal(config().provider, 'lmstudio', 'Probing must not change the active provider')
  handlers.get(IPC.llm.setConfig)(null, { provider: 'antling', antlingModel: ' ' })
  assert.equal(config().antlingModel, 'Ling-3.2-flash')
  assert.equal((await handlers.get(IPC.llm.listModels)(null)).source, 'preset')
  assert.equal(config().antlingReasoning, '')
  assert.equal(config().antlingTemperature, null)
  handlers.get(IPC.llm.setConfig)(null, { antlingReasoning: 'off', antlingTemperature: 0 })
  assert.equal(config().antlingReasoning, 'off')
  assert.equal(config().antlingTemperature, 0)
  handlers.get(IPC.llm.setConfig)(null, { antlingReasoning: 'high', antlingTemperature: 2 })
  assert.equal(config().antlingReasoning, 'off')
  assert.equal(config().antlingTemperature, 0)
  handlers.get(IPC.llm.setConfig)(null, { antlingReasoning: 'on', antlingTemperature: 0.7 })
  assert.equal(config().antlingReasoning, 'on')
  assert.equal(config().antlingTemperature, 0.7)
  handlers.get(IPC.llm.setConfig)(null, { antlingReasoning: '', antlingTemperature: null })
  assert.equal(config().antlingReasoning, '')
  assert.equal(config().antlingTemperature, null)
})

test('Ant Ling content_filter is reported across IPC without retrying or marking the refusal as success', async () => {
  const refusal = '作为一个人工智能语言模型，这个问题超出我目前的学习范围了，您可以尝试问我其他问题，我将尽力为您解答。'
  const { LmStudioClient, requests } = fixture(() => new Response(
    frame({ choices: [{ delta: { content: refusal } }] }) +
    frame({ choices: [{ delta: {}, finish_reason: 'content_filter' }], usage: { prompt_tokens: 0, completion_tokens: 0 } }) + 'data:[DONE]\n\n'))
  const settings = new Map([['antling.apiKey', key]]), handlers = new Map(), chunks = []
  loadTypeScript('src/main/ipc/llm.ts', {
    electron: { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } },
    '../llm/prompt-progress': { watchPromptProgress: async () => () => {} },
    '../store': { getStore: () => ({ getSetting: key => settings.get(key), setSetting: (key, value) => settings.set(key, value) }) },
    '../llm/client': { LmStudioError: Error, LmStudioClient },
    '../omniroute/runner': { getOmnirouteBaseUrl: () => '', startOmniroute: async () => {} }
  }).registerLlmHandlers()
  const sender = { once() {}, removeListener() {}, isDestroyed: () => false, send: (channel, chunk) => chunks.push(chunk) }
  const result = await handlers.get(IPC.llm.chat)({ sender }, 'filtered-turn', { provider: 'antling', messages: [{ role: 'user', content: 'Hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.finishReason, 'content_filter')
  assert.match(result.error, /content filter/)
  assert.equal(result.content, refusal)
  assert.equal(chunks.map(chunk => chunk.delta).join(''), refusal)
  assert.equal(requests.length, 1)
})
