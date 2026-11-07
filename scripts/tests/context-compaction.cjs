const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { contextTokens, conversationTokens, planContextCompaction, compactionChunks } = loadTypeScript('src/shared/context-compaction.ts')
const { LmStudioClient } = loadTypeScript('src/main/llm/client.ts')
const { DEFAULT_LLM_CONFIG } = loadTypeScript('src/shared/ipc.ts')

test('short chats stay intact; long chats compact before the window is full', () => {
  assert.equal(planContextCompaction([{ role: 'user', content: 'Hello' }], 8192, 1000), null)
  const messages = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }))
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
