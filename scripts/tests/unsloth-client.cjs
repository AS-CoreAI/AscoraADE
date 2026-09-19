// node --test scripts/tests/unsloth-client.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { DEFAULT_LLM_CONFIG, IPC } = loadTypeScript('src/shared/ipc.ts')
const { normalizeUnslothBaseUrl, normalizeUnslothApiKey } = loadTypeScript('src/shared/unsloth.ts')
const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts')
const key = 'sk-unsloth-test-fixture'

async function server(t, handler) {
  const requests = []
  const http = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null })
    handler(requests.at(-1), res)
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  t.after(() => { http.closeAllConnections(); http.close() })
  const url = `http://127.0.0.1:${http.address().port}`
  const client = new LmStudioClient({ ...DEFAULT_LLM_CONFIG, provider: 'unsloth', unslothBaseUrl: url, unslothApiKey: key, unslothModel: 'loaded-model' })
  return { client, requests, url }
}

async function collect(client, params = { messages: [{ role: 'user', content: 'Hello' }] }, signal) {
  const stream = client.streamChat(params, signal)
  let content = ''
  for (;;) {
    const next = await stream.next()
    if (next.done) return { content, ...next.value }
    content += next.value
  }
}

test('Unsloth accepts Studio roots, API bases and proxy paths, rejects non-HTTP/credential URLs', () => {
  for (const suffix of ['', '/', '/v1', '/v1/']) assert.equal(normalizeUnslothBaseUrl(`http://localhost:8000${suffix}`), 'http://localhost:8000/v1')
  assert.equal(normalizeUnslothBaseUrl(' https://example.test/studio/ '), 'https://example.test/studio/v1')
  assert.equal(normalizeUnslothBaseUrl(''), DEFAULT_LLM_CONFIG.unslothBaseUrl)
  assert.equal(normalizeUnslothApiKey(` Bearer ${key} `), key)
  for (const url of ['invalid', 'file:///tmp/model', 'http://user:secret@localhost', 'http://localhost?key=secret']) assert.throws(() => normalizeUnslothBaseUrl(url), /Unsloth/)
})

test('Model discovery authenticates and uses exact loaded model IDs', async (t) => {
  const { client, requests } = await server(t, (_, res) => res.end(JSON.stringify({ data: [{ id: 'gemma-4-GGUF' }] })))
  assert.deepEqual(await client.listModels(), [{ id: 'gemma-4-GGUF' }])
  assert.equal(requests[0].url, '/v1/models')
  assert.equal(requests[0].headers.authorization, `Bearer ${key}`)
})

test('Streaming text, fragmented tool calls, tool results and token usage use Unsloth', async (t) => {
  const frames = [
    { choices: [{ delta: { content: 'Привет! ' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'probe', arguments: '{"sta' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tus":"ok"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } }
  ]
  const { client, requests } = await server(t, (_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const data = Buffer.from(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n')
    // Split within a UTF-8 character and a JSON frame.
    const split = data.indexOf(Buffer.from('Привет')) + 1
    res.write(data.subarray(0, split))
    setTimeout(() => res.end(data.subarray(split)), 10)
  })
  const tools = [{ type: 'function', function: { name: 'probe', description: 'Test tool', parameters: { type: 'object', properties: { status: { type: 'string' } } } } }]
  const messages = [{ role: 'user', content: 'Hello' }]
  const result = await collect(client, { messages, tools })
  assert.equal(result.content, 'Привет! ')
  assert.deepEqual(result.toolCalls, [{ id: 'call_probe', name: 'probe', arguments: '{"status":"ok"}' }])
  assert.equal(result.finishReason, 'tool_calls')
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 })
  assert.equal(requests[0].headers.authorization, `Bearer ${key}`)
  assert.equal(requests[0].url, '/v1/chat/completions')
  assert.equal(requests[0].body.model, 'loaded-model')
  assert.equal(requests[0].body.stream, true)
  assert.deepEqual(requests[0].body.tools, tools)
  messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'call_probe', type: 'function', function: { name: 'probe', arguments: '{"status":"ok"}' } }] }, { role: 'tool', tool_call_id: 'call_probe', content: 'ok' })
  await collect(client, { messages, model: 'another-loaded-model' })
  assert.equal(requests[1].body.model, 'another-loaded-model')
  assert.deepEqual(requests[1].body.messages, messages)
})

test('Missing/revoked keys and empty loaded model lists have actionable errors', async (t) => {
  const { client, requests } = await server(t, (_, res) => { res.writeHead(401); res.end('{}') })
  client.update({ unslothApiKey: '' })
  await assert.rejects(client.listModels(), /requires an API key/)
  await assert.rejects(collect(client), /requires an API key/)
  assert.equal(requests.length, 0)
  client.update({ unslothApiKey: key })
  await assert.rejects(client.listModels(), error => error.status === 401 && /Settings → API/.test(error.message) && !error.message.includes(key))
  client.update({ unslothModel: '' })
  await assert.rejects(collect(client), /Load a model in Unsloth/)
  const empty = await server(t, (_, res) => res.end('{"data":[]}'))
  assert.deepEqual(await empty.client.listModels(), [])
})

test('Unsloth templates without native tools still answer using the existing text protocol', async (t) => {
  const { client, requests } = await server(t, (request, res) => {
    if (request.body.tools) {
      res.writeHead(400)
      res.end('{"error":{"message":"Client-supplied tools or tool-call history require a GGUF chat template with tool-call support; the current model/template does not advertise tools."}}')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"Hello from Unsloth"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  })
  const messages = [{ role: 'user', content: 'Hello' }]
  const tools = [{ type: 'function', function: { name: 'probe', parameters: { type: 'object', properties: {} } } }]
  const result = await collect(client, { messages, tools })
  assert.equal(result.content, 'Hello from Unsloth')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].body.tools, undefined)
  assert.deepEqual(requests[1].body.messages, messages)
  assert.equal(requests[1].headers.authorization, `Bearer ${key}`)
  // A rejected native tool history cannot be quietly rewritten or dropped.
  await assert.rejects(collect(client, { tools, messages: [...messages, { role: 'tool', tool_call_id: 'existing', content: 'result' }] }), /does not advertise tools/)
  assert.equal(requests.length, 3)
})

test('Unsloth does not retry unrelated validation errors or the same rejection twice', async (t) => {
  const tools = [{ type: 'function', function: { name: 'probe' } }]
  const unavailable = await server(t, (_, res) => { res.writeHead(400); res.end('{"error":{"message":"No model loaded"}}') })
  await assert.rejects(collect(unavailable.client, { messages: [], tools }), /No model loaded/)
  assert.equal(unavailable.requests.length, 1)
  const rejected = await server(t, (_, res) => { res.writeHead(400); res.end('{"error":{"message":"The template does not advertise tools"}}') })
  await assert.rejects(collect(rejected.client, { messages: [], tools }), /does not advertise tools/)
  assert.equal(rejected.requests.length, 2)
})

test('Server failures and cancellation propagate instead of silently returning an empty answer', async (t) => {
  const failed = await server(t, (_, res) => { res.writeHead(503); res.end('{"error":{"message":"Model is loading"}}') })
  await assert.rejects(collect(failed.client), /Unsloth responded 503.*Model is loading/)
  const invalid = await server(t, (_, res) => res.end('not json'))
  await assert.rejects(invalid.client.listModels(), error => error.kind === 'parse')
  const pending = await server(t, (_, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': waiting\n\n') })
  const controller = new AbortController()
  const result = collect(pending.client, undefined, controller.signal)
  setTimeout(() => controller.abort(), 50)
  await assert.rejects(result, error => error.kind === 'aborted')
})

test('Unsloth key never leaks to LM Studio, Ollama or OpenRouter', async (t) => {
  const { client, requests, url } = await server(t, (_, res) => res.end('{"data":[]}'))
  for (const provider of ['lmstudio', 'ollama']) {
    client.update({ provider, baseUrl: url, ollamaBaseUrl: url })
    await client.listModels()
    assert.equal(requests.at(-1).headers.authorization, undefined)
  }
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/models')
    assert.equal(options.headers.Authorization, 'Bearer router-fixture-key')
    return new Response('{"data":[]}')
  })
  client.update({ provider: 'openrouter', openRouterEnabled: true, openRouterApiKey: 'router-fixture-key' })
  await client.listModels()
})

test('IPC persists normalized Unsloth settings and probes independently of the selected provider', async () => {
  const settings = new Map()
  const handlers = new Map()
  const probes = []
  const overrides = {
    electron: { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } },
    '../store': { getStore: () => ({ getSetting: key => settings.get(key), setSetting: (key, value) => settings.set(key, value) }) },
    '../llm/client': { LmStudioError: Error, LmStudioClient: class { constructor(config) { this.config = config } update(patch) { Object.assign(this.config, patch) } async listModels() { probes.push(this.config); return [{ id: 'loaded' }] } } },
    '../omniroute/runner': { getOmnirouteBaseUrl: () => '', startOmniroute: async () => {} }
  }
  loadTypeScript('src/main/ipc/llm.ts', overrides).registerLlmHandlers()
  handlers.get(IPC.llm.setConfig)(null, { unslothBaseUrl: 'http://localhost:8000/', unslothApiKey: `Bearer ${key}`, unslothModel: 'loaded' })
  const config = handlers.get(IPC.llm.config)()
  assert.equal(config.unslothBaseUrl, 'http://localhost:8000/v1')
  assert.equal(config.unslothApiKey, key)
  assert.equal(config.unslothModel, 'loaded')
  assert.equal(config.provider, 'lmstudio')
  assert.equal((await handlers.get(IPC.llm.listModels)(null, 'unsloth')).ok, true)
  assert.equal(probes.at(-1).provider, 'unsloth')
  assert.equal(handlers.get(IPC.llm.config)().provider, 'lmstudio')
  assert.throws(() => handlers.get(IPC.llm.setConfig)(null, { unslothBaseUrl: 'file:///tmp', unslothApiKey: 'changed' }), /Unsloth/)
  assert.equal(handlers.get(IPC.llm.config)().unslothApiKey, key)
})
