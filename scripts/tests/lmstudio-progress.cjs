const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const { join, resolve, dirname } = require('node:path')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { PromptProgressParser } = loadTypeScript('src/main/llm/prompt-progress.ts')
const line = (text, model = 'qwen/fixture') => `[2026-11-08 22:08:55][INFO][${model}] ${text}\r\n`
const start = line('Running chat completion on conversation with 43 messages.')
const progress = value => line(`Prompt processing progress: ${value}%`)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check) {
  const deadline = Date.now() + 4000
  while (!check()) { if (Date.now() > deadline) throw new Error('Progress did not arrive'); await delay(25) }
}

test('parser uses matching new model starts, finite monotonic percentages and rejects overlaps', () => {
  const events = []
  const parser = new PromptProgressParser('qwen/fixture', 43, value => events.push(value))
  for (const record of [progress(80), line('Running chat completion on conversation with 43 messages.', 'other')]) parser.push(record.trim())
  assert.equal(events.length, 0)
  parser.push(start.trim())
  for (const percent of [0, 41.2, 41.2, 14, 101, 'NaN', 'Infinity', -1]) parser.push(progress(percent).trim())
  assert.deepEqual(events.map(event => event.percent), [0, 41.2])
  assert.equal(events[1].source, 'lmstudio-log')
  parser.push(start.trim())
  parser.push(progress(75).trim())
  assert.deepEqual(events.at(-1), { phase: 'waiting' })
  assert.equal(events.length, 3)
  const mismatch = new PromptProgressParser('qwen/fixture', 42, value => events.push(value))
  mismatch.push(start.trim()); mismatch.push(progress(90).trim())
  assert.equal(events.at(-1).percent, undefined)
})

async function fixture(t) {
  const home = await fs.mkdtemp(join(os.tmpdir(), 'ascora-prompt-progress-'))
  const directory = join(home, '.lmstudio', 'server-logs', '2026-11')
  await fs.mkdir(directory, { recursive: true })
  const path = join(directory, '2026-11-08.1.log')
  await fs.writeFile(path, start + progress(88))
  const stops = []
  t.after(async () => {
    stops.forEach(stop => stop())
    await delay(30)
    assert.equal(dirname(resolve(home)), resolve(os.tmpdir()))
    assert.ok(home.includes('ascora-prompt-progress-'))
    await fs.rm(home, { recursive: true, force: true })
  })
  const { watchPromptProgress } = loadTypeScript('src/main/llm/prompt-progress.ts', { 'node:os': { homedir: () => home } })
  const watch = async (events, base = 'http://127.0.0.1:1234/v1', signal = new AbortController().signal) => {
    const stop = await watchPromptProgress(base, 'qwen/fixture', 43, signal, value => events.push(value))
    stops.push(stop)
    return stop
  }
  return { path, directory, watch }
}

test('watcher skips old data, handles split lines and stops immediately on abort', async t => {
  const { path, watch } = await fixture(t)
  const events = [], controller = new AbortController()
  await watch(events, undefined, controller.signal)
  await fs.appendFile(path, progress(99) + start + progress(0) + progress(41.2).slice(0, -4))
  await waitFor(() => events.length > 0)
  assert.deepEqual(events.map(event => event.percent), [0])
  await fs.appendFile(path, progress(41.2).slice(-4))
  await waitFor(() => events.at(-1)?.percent === 41.2)
  controller.abort()
  const count = events.length
  await fs.appendFile(path, progress(60))
  await delay(650)
  assert.equal(events.length, count)
})

test('remote URLs never use local model percentages', async t => {
  const { path, watch } = await fixture(t)
  const events = []
  await watch(events, 'http://192.0.2.1:1234/v1')
  await fs.appendFile(path, start + progress(41.2))
  await delay(650)
  assert.deepEqual(events, [])
})

test('concurrent local requests suppress shared model percentages for both requests', async t => {
  const { path, watch } = await fixture(t)
  const first = [], second = []
  await watch(first)
  await fs.appendFile(path, start + progress(41.2))
  await waitFor(() => first.at(-1)?.percent === 41.2)
  await watch(second, 'http://localhost:1234/v1')
  assert.deepEqual(first.at(-1), { phase: 'waiting' })
  assert.deepEqual(second.at(-1), { phase: 'waiting' })
  await fs.appendFile(path, start + progress(50))
  await delay(650)
  assert.deepEqual(first.at(-1), { phase: 'waiting' })
  assert.deepEqual(second.at(-1), { phase: 'waiting' })
})

test('truncation, rotation and oversized log bursts discard ambiguous percentages', async t => {
  for (const mode of ['truncate', 'rotate', 'oversize']) {
    const { path, directory, watch } = await fixture(t)
    const events = []
    await watch(events)
    await fs.appendFile(path, start + progress(41.2))
    await waitFor(() => events.at(-1)?.percent === 41.2)
    if (mode === 'truncate') await fs.truncate(path, 0)
    if (mode === 'rotate') await fs.writeFile(join(directory, '2026-11-08.2.log'), start + progress(70))
    if (mode === 'oversize') await fs.appendFile(path, 'x'.repeat(70 * 1024) + '\n' + progress(70))
    await waitFor(() => events.at(-1)?.phase === 'waiting')
    assert.equal(events.at(-1).percent, undefined)
  }
})
