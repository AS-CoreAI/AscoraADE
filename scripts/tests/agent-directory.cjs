// node --test scripts/tests/agent-directory.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { formatAgentDirectory } = loadTypeScript('src/shared/agent-directory.ts')

test('3286 entries are bounded and every filename remains reachable through pagination', () => {
  const entries = Array.from({ length: 3286 }, (_, i) => ({ name: `asset-${String(i).padStart(4, '0')}.dat`, type: 'file' }))
  const seen = []
  let offset = 0
  do {
    const result = formatAgentDirectory({ ok: true, path: '.', entries }, { offset })
    assert.ok(result.content.length < 13_000)
    const names = result.content.split('\n').filter(line => line.startsWith('asset-'))
    assert.ok(names.length <= 100)
    seen.push(...names)
    const continuation = result.content.match(/offset=(\d+)/)
    offset = continuation ? Number(continuation[1]) : 0
  } while (offset)
  assert.deepEqual(seen, entries.map(entry => entry.name))
})

test('character budget can shorten pages without losing or splitting long filenames', () => {
  const entries = Array.from({ length: 200 }, (_, i) => ({ name: `${i}-${'a'.repeat(245)}.log`, type: 'file' }))
  const first = formatAgentDirectory({ ok: true, entries }, { limit: 10_000 })
  const next = Number(first.content.match(/offset=(\d+)/)[1])
  assert.ok(next > 0 && next < 100)
  assert.ok(first.content.length < 13_000)
  assert.equal(first.content.split('\n').filter(line => line.endsWith('.log')).length, next)
})

test('filtering, folder ordering, limits, empty pages and errors remain explicit', () => {
  const result = { ok: true, path: '.', entries: [
    { name: 'game.LOG', type: 'file' }, { name: 'debug.log', type: 'file' },
    { name: 'zlogs', type: 'directory' }, { name: 'image.png', type: 'file' }
  ] }
  const filtered = formatAgentDirectory(result, { filter: 'LoG', limit: 1 })
  assert.match(filtered.content, /3 entries matching "LoG" \(4 total\)/)
  assert.match(filtered.content, /\nzlogs\/\n/)
  assert.match(filtered.content, /same path and filter and offset=1/)
  assert.match(formatAgentDirectory(result, { filter: '.cfg' }).content, /no matching entries/)
  assert.match(formatAgentDirectory(result, { offset: 99 }).content, /no entries at this offset/)
  assert.match(formatAgentDirectory({ ok: true, entries: [] }).content, /\(empty\)/)
  assert.equal(formatAgentDirectory({ ok: false, error: 'Access denied' }).content, 'Error: Access denied')
  assert.match(formatAgentDirectory(result, { offset: -1, limit: NaN }).content, /showing 1-4/)
})
