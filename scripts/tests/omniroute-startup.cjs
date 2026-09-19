// node --test scripts/tests/omniroute-startup.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createServer } = require('node:net')
const { once } = require('node:events')
const { spawnSync } = require('node:child_process')
const { runInNewContext, Script } = require('node:vm')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { omnirouteStartupFailure } = loadTypeScript('src/shared/omniroute-startup.ts')
const buildRoot = path.resolve(__dirname, '../../.build')

function temporary(t) {
  fs.mkdirSync(buildRoot, { recursive: true })
  const dir = fs.mkdtempSync(path.join(buildRoot, 'omni-test-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), buildRoot)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

test('Startup recognizes fatal instrumentation errors across output chunks, ignores normal fallback notices', () => {
  const first = '\u001b[31mError: An error occurred while loading instrumen'
  assert.equal(omnirouteStartupFailure(first), undefined)
  const error = omnirouteStartupFailure(first + 'tation hook: Failed to load external module better-sqlite3\u001b[0m\n')
  assert.match(error, /better-sqlite3/)
  assert.equal(error.includes('\u001b'), false)
  assert.equal(omnirouteStartupFailure('SQLite fallback selected: node:sqlite\nReady in 200ms'), undefined)
  assert.match(omnirouteStartupFailure("Error: Cannot find module 'next'"), /Cannot find module/)
})

test('The pinned OMP shim is valid JS, preserves SQLite reads/writes and respects readonly', async (t) => {
  const { BUILTIN_PATCHES, applyBuiltinPatches } = await import('../omniroute/vendor-patches.mjs')
  const patch = BUILTIN_PATCHES.find(item => item.id === 'omp-credentials-node-sqlite')
  const root = temporary(t)
  const chunks = path.join(root, patch.root)
  fs.mkdirSync(chunks, { recursive: true })
  const source = 'const n=e.i(785148);let a=()=>r.default.join(r.default.join(t.default.homedir(),".omp","agent"),"agent.db");globalThis.Database=n.default;'
  for (let i = 0; i < patch.expected; i++) fs.writeFileSync(path.join(chunks, `${i}.js`), source)
  applyBuiltinPatches(root, [patch])
  const patched = fs.readFileSync(path.join(chunks, '0.js'), 'utf8')
  new Script(patched)
  const context = { process, e: { i: () => { throw new Error('Native module must not be imported') } } }
  runInNewContext(patched, context)
  const file = path.join(root, 'credentials.sqlite')
  const db = new context.Database(file)
  db.exec('CREATE TABLE credentials (provider TEXT, value TEXT)')
  db.prepare('INSERT INTO credentials VALUES (?, ?)').run('fixture', 'test-value')
  db.close()
  const readonly = new context.Database(file, { readonly: true })
  assert.equal(readonly.prepare('SELECT value FROM credentials WHERE provider = ?').get('fixture').value, 'test-value')
  assert.throws(() => readonly.prepare('DELETE FROM credentials').run(), /readonly/i)
  readonly.close()
  const writable = new context.Database(file)
  writable.prepare('DELETE FROM credentials WHERE provider = ?').run('fixture')
  assert.equal(writable.prepare('SELECT COUNT(*) AS count FROM credentials').get().count, 0)
  writable.close()
  assert.throws(() => applyBuiltinPatches(root, [patch]), /expected 8 exact occurrences, found 0/)
})

test('Patch-count mismatch leaves all chunks untouched', async (t) => {
  const { BUILTIN_PATCHES, applyBuiltinPatches } = await import('../omniroute/vendor-patches.mjs')
  const patch = BUILTIN_PATCHES.find(item => item.id === 'omp-credentials-node-sqlite')
  const root = temporary(t)
  const file = path.join(root, patch.root, 'only-one.js')
  const source = 'n=e.i(785148);let a=()=>r.default.join(r.default.join(t.default.homedir(),".omp","agent"),"agent.db");'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source)
  assert.throws(() => applyBuiltinPatches(root, [patch]), /found 1/)
  assert.equal(fs.readFileSync(file, 'utf8'), source)
})

test('Packaged smoke cannot borrow dependencies from the development workspace', (t) => {
  const root = temporary(t)
  const vendor = path.join(root, 'vendor')
  fs.mkdirSync(vendor)
  fs.writeFileSync(path.join(root, 'outside.cjs'), 'throw new Error("Outside dependency executed")')
  fs.writeFileSync(path.join(vendor, 'entry.cjs'), 'require("../outside.cjs")')
  const result = spawnSync(process.execPath, ['--require', path.resolve(__dirname, '../omniroute/smoke-isolation.cjs'), path.join(vendor, 'entry.cjs')], {
    env: { ...process.env, ASCORA_OMNIROUTE_SMOKE_ROOT: vendor }, encoding: 'utf8', windowsHide: true
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Dependency outside bundled OmniRoute/)
  assert.doesNotMatch(result.stderr, /Outside dependency executed/)
})

test('Production supervisor fails promptly, kills the failed process, and can retry successfully', async (t) => {
  const root = temporary(t)
  const vendor = path.join(root, '.build/omniroute')
  const pkg = path.join(vendor, 'node_modules/omniroute')
  const entry = 'node_modules/omniroute/bin/omniroute.mjs'
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(vendor, 'VENDOR_MANIFEST.json'), JSON.stringify({ version: '3.8.48', entry }))
  fs.writeFileSync(path.join(vendor, entry), '')
  const server = path.join(pkg, 'dist/server.js')
  fs.writeFileSync(server, `process.stderr.write('Error: An error occurred while loading instrumen');
    setTimeout(() => process.stderr.write("tation hook: Failed to load external module better-sqlite3\\n"), 25);
    setInterval(() => {}, 1000);`)
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const settings = new Map([['omniroute.port', port]])
  const runner = loadTypeScript('src/main/omniroute/runner.ts', {
    electron: { app: { isPackaged: false, getAppPath: () => root, getPath: () => path.join(root, 'profile') } },
    '../store': { getStore: () => ({ getSetting: key => settings.get(key), setSetting: (key, value) => settings.set(key, value) }) }
  })
  try {
    const start = Date.now()
    const result = await runner.startOmniroute()
    assert.equal(result.state, 'error')
    assert.match(result.error, /better-sqlite3/)
    assert.doesNotMatch(result.error, /180s/)
    assert.ok(Date.now() - start < 10_000, 'A fatal startup must not exhaust the 180-second health budget')
    fs.writeFileSync(server, `require('node:http').createServer((_req, res) => { res.setHeader('content-type','application/json'); res.end('{}'); }).listen(Number(process.env.PORT),'127.0.0.1');`)
    const retry = await runner.startOmniroute()
    assert.equal(retry.state, 'ready', retry.error)
    assert.equal(retry.error, undefined)
    assert.equal(retry.port, port)
  } finally { await runner.stopOmniroute() }
  assert.equal(runner.getOmnirouteStatus().state, 'stopped')
})
