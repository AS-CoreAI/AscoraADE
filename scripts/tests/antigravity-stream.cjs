const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function fixture() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdout.setEncoding = child.stderr.setEncoding = () => {}
  const events = []
  let spawnedEnv
  let spawnedArgs
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
      if (id === 'cross-spawn') return (_file, args, options) => { spawnedEnv = options.env; spawnedArgs = args; return child }
      if (id === 'node:fs') return { existsSync: () => true }
      if (id === '@shared/ipc') return { IPC: { antigravity: { event: 'antigravity:event' } } }
      return require(id)
    }
  })
  const sender = { isDestroyed: () => false, once() {}, send: (_channel, payload) => events.push(payload.event) }
  const promise = exports.runAntigravity('test', sender, { prompt: 'hello', cwd: '.', model: 'flash_lite', reasoning: 'low' }, { antigravityPath: 'C:\\custom\\agentapi.bat' })
  return { child, events, promise, get spawnedEnv() { return spawnedEnv }, get spawnedArgs() { return spawnedArgs } }
}

test('Antigravity parses NDJSON chunks, UUID sessions and token usage', async () => {
  const { child, events, promise, spawnedEnv, spawnedArgs } = fixture()
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
  assert.equal(spawnedArgs[spawnedArgs.indexOf('--reasoning') + 1], 'low')
  assert.equal(spawnedArgs[spawnedArgs.indexOf('--model') + 1], 'flash_lite')
  const messages = events.filter((event) => event.kind === 'item' && event.item.type === 'agent_message')
  assert.deepEqual(messages.map((event) => event.item.text), ['Hello', 'Hello world', 'Hello world'])
  assert.equal(new Set(messages.map((event) => event.item.id)).size, 1)
  assert.equal(messages.at(-1).phase, 'completed')
})

test('Rewritten snapshots replace earlier text and reasoning before process exit', async () => {
  const { child, events, promise } = fixture()
  const send = (type, text) => child.stdout.emit('data', JSON.stringify({ type, text, snapshot: true }) + '\n')
  send('reasoning', 'Thinking about a long answer')
  send('reasoning', 'Ready')
  send('text', 'A long preliminary answer')
  send('text', 'Да, я здесь!')
  assert.equal(events.at(-1).item.text, 'Да, я здесь!')
  assert.equal(events.at(-1).phase, 'started')
  child.emit('close', 0)
  assert.equal((await promise).ok, true)
  const thoughts = events.filter((event) => event.item?.type === 'reasoning')
  assert.deepEqual(thoughts.map((event) => event.item.text), ['Thinking about a long answer', 'Ready', 'Ready'])
  assert.equal(new Set(thoughts.map((event) => event.item.id)).size, 1)
  assert.equal(events.filter((event) => event.item?.type === 'agent_message').at(-1).item.text, 'Да, я здесь!')
})

test('A reasoning-only response cannot silently complete successfully', async () => {
  const { child, events, promise } = fixture()
  child.stdout.emit('data', JSON.stringify({ type: 'reasoning', text: 'Thinking' }) + '\n')
  child.emit('close', 0)
  const result = await promise
  assert.equal(result.ok, false)
  assert.match(result.error, /without an answer/)
  assert.equal(events.some((event) => event.kind === 'turn-completed'), false)
  assert.equal(events.some((event) => event.item?.type === 'agent_message'), false)
})
