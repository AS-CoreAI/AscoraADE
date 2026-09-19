// Isolated UI fixture: no real account, installer or provider is contacted.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const filename = join(__dirname, '../../src/shared/ipc.ts')
const contract = new Module(filename)
contract._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const config = { ...contract.exports.DEFAULT_LLM_CONFIG }
const status = { state: 'ready', port: 20128, version: '3.8.48', baseUrl: 'http://127.0.0.1:20128/v1', logsPath: '' }
const values = JSON.parse(localStorage.getItem('settings-smoke') || '{"appearance.language":"ru"}')
const save = () => localStorage.setItem('settings-smoke', JSON.stringify(values))
const usage = { ok: true, loggedIn: true, windows: [{ label: '5 часов', percent: 32, severity: 'normal', resetsAt: '2026-09-19T18:00:00Z' }] }
const missing = new Set(['gemini'])
const group = (name) => new Proxy({}, { get: (_, method) => {
  if (String(method).startsWith('on')) return () => () => {}
  return async (...args) => {
    if (name === 'settings') {
      if (method === 'get') return values[args[0]]
      if (method === 'set') { values[args[0]] = args[1]; save(); return }
    }
    if (name === 'llm') {
      if (method === 'config') return config
      if (method === 'setConfig') { Object.assign(config, args[0]); return }
      if (method === 'listModels') return { ok: true, models: [{ id: 'test-model' }] }
      if (method === 'checkLmStudio' || method === 'checkOllama') return true
    }
    if (name === 'workspace' || name === 'blueprint' || name === 'wprovider') return []
    if (name === 'omniroute') return status
    if (name === 'providerSetup') {
      if (method === 'inspect') return { available: true, command: 'npm install -g example', url: 'https://example.com' }
      if (method === 'credits') return { ok: true, remaining: 12.3, used: 4.5, limit: 16.8 }
      if (method === 'install') { missing.delete(args[0]); return { ok: true } }
    }
    if (name === 'developerTools') return { platform: 'win32', available: true, manager: 'winget', tools: [] }
    if (name === 'network') return { ok: true, ip: '127.0.0.1', country: 'Test', checkedAt: Date.now() }
    if (method === 'check') return { ok: true, installed: !missing.has(name), loggedIn: !missing.has(name), version: '1.2.3', authNote: 'Test account' }
    if (method === 'usage') return usage
    return { ok: true }
  }
} })
window.ascora = new Proxy({ system: { platform: 'win32' } }, { get: (target, name) => target[name] ?? group(name) })
