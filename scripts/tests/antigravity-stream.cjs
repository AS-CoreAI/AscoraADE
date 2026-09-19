const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

test('Antigravity parses NDJSON chunks, UUID sessions and token usage', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdout.setEncoding = child.stderr.setEncoding = () => {}
  const events = []
  let spawnedEnv
  const exports = {}
  const filename = join(__dirname, '../../src/main/antigravity/runner.ts')
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  runInNewContext(source, {
    exports, process: { platform: 'win32', env: { PATH: 'C:\\Python' }, resourcesPath: 'C:\\App' },
    __dirname, setTimeout, clearTimeout,
    require: (id) => {
      if (id === 'electron') return { app: { on() {}, getAppPath: () => 'C:\\App' } }
      if (id === 'cross-spawn') return (_file, _args, options) => { spawnedEnv = options.env; return child }
      if (id === 'node:fs') return { existsSync: () => true }
      if (id === '@shared/ipc') return { IPC: { antigravity: { event: 'antigravity:event' } } }
      return require(id)
    }
  })
  const sender = { isDestroyed: () => false, once() {}, send: (_channel, payload) => events.push(payload.event) }
  const promise = exports.runAntigravity('test', sender, { prompt: 'hello', cwd: '.' }, { antigravityPath: 'C:\\custom\\agentapi.bat' })
  const session = '1da98561-19ca-49d2-b65a-0c037df6bf4f'
  const lines = [
    { type: 'session', sessionID: session },
    { type: 'text', text: 'Hello' },
    { type: 'text', text: 'Hello world' },
    { type: 'step-finish', tokens: { input: 10, output: 20 } }
  ].map((event) => JSON.stringify(event)).join('\r\n') + '\r\n'
  child.stdout.emit('data', lines.slice(0, 37))
  child.stdout.emit('data', lines.slice(37))
  child.emit('close', 0)
  const result = await promise
  assert.equal(result.ok, true)
  assert.equal(result.threadId, session)
  assert.equal(result.usage.inputTokens, 10)
  assert.equal(result.usage.outputTokens, 20)
  assert.equal(spawnedEnv.ANTIGRAVITY_AGENTAPI, 'C:\\custom\\agentapi.bat')
  assert.equal(events.find((event) => event.kind === 'item' && event.item.type === 'agent_message').item.text, 'Hello world')
})
