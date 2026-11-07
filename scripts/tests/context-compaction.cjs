const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { contextTokens, conversationTokens, planContextCompaction, compactionChunks, generationBudget, completeContextSummary } = loadTypeScript('src/shared/context-compaction.ts')
const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts')
const { DEFAULT_LLM_CONFIG } = loadTypeScript('src/shared/ipc.ts')

test('short chats stay intact; long chats compact before the window is full', () => {
  assert.equal(planContextCompaction([{ role: 'user', content: 'Hello' }], 8192, 1000), null)
  const shortMessages = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }))
  assert.equal(planContextCompaction(shortMessages, 120000, 1000), null, 'Message count alone must not force compaction')
  const messages = shortMessages.map(message => ({ ...message, content: message.content + 'abc '.repeat(75) }))
  const plan = planContextCompaction(messages, 8192, 1000)
  assert.ok(plan.history.length > 0)
  assert.deepEqual([...plan.history, ...plan.recent], messages)
  assert.equal(plan.recent.at(-1), messages.at(-1))
  assert.ok(conversationTokens(plan.recent) < plan.targetTokens)
})

test('native tool calls and results are never split across the summary boundary', () => {
  const pair = [{ role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'output'.repeat(2000) }]
  const messages = [{ role: 'user', content: 'goal'.repeat(5000) }, ...pair, { role: 'assistant', content: 'done' }]
  const plan = planContextCompaction(messages, 8192, 2000)
  for (const side of [plan.history, plan.recent]) {
    assert.equal(side.includes(pair[0]), side.includes(pair[1]))
  }
  assert.equal(planContextCompaction(messages.slice(0, 2), 8192, 1000), null)
})

test('very large and multilingual messages are summarized in bounded, lossless chunks', () => {
  const messages = [{ role: 'user', content: 'Привет 世界 😀 abc '.repeat(3000) }]
  const chunks = [...compactionChunks(messages, 500)]
  assert.ok(chunks.length > 5)
  assert.ok(chunks.every(chunk => contextTokens(chunk) <= 500 && chunk.length > 0))
  assert.equal(chunks.join(''), messages.map(m => JSON.stringify(m) + '\n').join(''))
})

test('context discovery uses the selected loaded instance window, not maximum model capacity', async t => {
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ models: [{ key: 'model', max_context_length: 131072,
    loaded_instances: [{ id: 'other', config: { context_length: 4096 } }, { id: 'custom', config: { context_length: 32768 } }] }] })))
  const client = new LmStudioClient(DEFAULT_LLM_CONFIG)
  assert.equal(await client.contextLength('custom'), 32768)
  assert.equal(await client.contextLength('missing'), null)
})

test('runtime window changes, million-token windows, unloaded and ambiguous instances', async t => {
  let length = 120000
  let instances = () => [{ id: 'loaded', config: { context_length: length } }]
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ models: [{ key: 'model', max_context_length: 2097152,
    loaded_instances: instances(), capabilities: { reasoning: { allowed_options: ['off', 'low', 'medium', 'xhigh', 'on'], default: 'xhigh' } } }] })))
  const client = new LmStudioClient(DEFAULT_LLM_CONFIG)
  assert.equal(await client.contextLength('model'), 120000)
  length = 1000000
  assert.equal(await client.contextLength('model'), 1000000)
  const prompt = [{ role: 'user', content: 'abc'.repeat(80000) }]
  assert.equal(planContextCompaction(prompt, length, 5000), null)
  assert.ok(generationBudget(prompt, length) > 800000, 'Reasoning/output must not be capped at 2048 or a fixed window')
  assert.deepEqual((await client.modelInfo('model')).reasoningOptions, ['off', 'low', 'medium', 'xhigh'])
  instances = () => [{ id: 'a', config: { context_length: 1000 } }, { id: 'b', config: { context_length: 1000000 } }]
  assert.equal(await client.contextLength('model'), null)
  assert.equal(await client.contextLength('b'), 1000000)
  instances = () => []
  assert.equal(await client.contextLength('model'), null, 'Unloaded maximum is not an active context window')
})

test('summary allows reasoning beyond 2048, continues incomplete output, never promotes reasoning to a final note', async () => {
  for (const finishReason of ['length', 'stop']) {
    const requests = []
    const result = await completeContextSummary([{ role: 'user', content: 'source transcript' }], 120000, async params => {
      requests.push(params)
      return requests.length === 1
        ? { ok: true, content: '', thinking: 'Unverified unfinished reasoning', finishReason }
        : { ok: true, content: 'Verified continuation note', finishReason: 'stop' }
    }, () => false)
    assert.equal(result, 'Verified continuation note')
    assert.equal(requests.length, 2)
    assert.ok(requests[0].maxTokens > 100000)
    assert.ok(requests[1].messages.at(-1).content.includes('Unverified unfinished reasoning'))
    assert.ok(requests[1].messages[0].content.includes('source transcript'))
  }
})

test('summary cancellation stops immediately; repeated incomplete summaries fail without replacing source', async () => {
  let calls = 0
  const source = [{ role: 'user', content: 'Original task' }]
  const snapshot = structuredClone(source)
  assert.equal(await completeContextSummary(source, 8192, async () => {
    calls++; return { ok: true, aborted: true, content: '', thinking: 'Partial reasoning' }
  }, () => false), null)
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(completeContextSummary(source, 8192, async () => {
    calls++; return { ok: true, content: 'truncated note', finishReason: 'length' }
  }, () => false), /without a complete summary/)
  assert.equal(calls, 2)
  assert.deepEqual(source, snapshot)
})
