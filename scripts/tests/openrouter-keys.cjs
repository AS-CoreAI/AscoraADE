// node --test scripts/tests/openrouter-keys.cjs
// Named OpenRouter keys: persistence, legacy migration and per-chat selection.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { IPC, normalizeOpenRouterApiKeys } = loadTypeScript('src/shared/ipc.ts')
const production = loadTypeScript('src/main/llm/client.ts')

/** Load the real main-process handlers against an in-memory settings store. */
function fixture(initial = {}) {
  const settings = new Map(Object.entries(initial))
  const handlers = new Map()
  const clients = []
  loadTypeScript('src/main/ipc/llm.ts', {
    electron: { ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } },
    '../store': { getStore: () => ({ getSetting: (key) => settings.get(key), setSetting: (key, value) => settings.set(key, value) }) },
    '../llm/prompt-progress': { watchPromptProgress: async () => () => {} },
    '../omniroute/runner': { getOmnirouteBaseUrl: () => '', startOmniroute: async () => ({ state: 'ready', baseUrl: '' }) },
    '../llm/client': { ...production, LmStudioClient: class {
      constructor(config) { this.config = config; clients.push(config) }
      update(config) { this.config = config }
      async listModels() { return [] }
      async *streamChat() { yield 'Ready'; return { toolCalls: [] } }
    } }
  }).registerLlmHandlers()
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => {} })
  return {
    settings,
    clients,
    config: () => handlers.get(IPC.llm.config)(),
    setConfig: (patch) => handlers.get(IPC.llm.setConfig)({}, patch),
    chat: (params) => handlers.get(IPC.llm.chat)({ sender }, `chat-${clients.length}`, { messages: [{ role: 'user', content: 'Hi' }], provider: 'openrouter', ...params })
  }
}

const work = { id: 'work', label: 'Work', apiKey: 'sk-or-v1-work' }
const home = { id: 'home', label: 'Home', apiKey: 'sk-or-v1-home' }

test('a key saved before multiple keys existed becomes the first named key', () => {
  const app = fixture({ 'openrouter.enabled': true, 'openrouter.apiKey': ' "sk-or-v1-legacy" ' })
  const config = app.config()
  assert.deepEqual(config.openRouterApiKeys, [{ id: 'legacy', label: 'Key 1', apiKey: 'sk-or-v1-legacy' }])
  assert.equal(config.openRouterActiveKeyId, 'legacy')
  assert.equal(config.openRouterApiKey, 'sk-or-v1-legacy')
  assert.equal(fixture({}).config().openRouterApiKeys.length, 0)
})

test('named keys persist with their labels, and the active key is mirrored for downgrades', () => {
  const app = fixture({ 'openrouter.enabled': true })
  app.setConfig({ openRouterApiKeys: [work, home], openRouterActiveKeyId: 'home' })
  assert.deepEqual(app.settings.get('openrouter.apiKeys'), [work, home])
  assert.equal(app.settings.get('openrouter.activeKeyId'), 'home')
  assert.equal(app.settings.get('openrouter.apiKey'), home.apiKey)
  assert.equal(app.config().openRouterApiKey, home.apiKey)

  app.setConfig({ openRouterActiveKeyId: 'work' })
  assert.equal(app.config().openRouterActiveKeyId, 'work')
  assert.equal(app.settings.get('openrouter.apiKey'), work.apiKey)

  // An unknown id selects the first saved key instead of sending nothing.
  app.setConfig({ openRouterActiveKeyId: 'deleted' })
  assert.equal(app.config().openRouterActiveKeyId, 'work')

  // Older callers that save one unlabelled key update the active entry only.
  app.setConfig({ openRouterApiKey: 'sk-or-v1-rotated' })
  assert.deepEqual(app.config().openRouterApiKeys, [{ ...work, apiKey: 'sk-or-v1-rotated' }, home])

  // Removing every key leaves OpenRouter without a usable credential.
  app.setConfig({ openRouterApiKeys: [] })
  assert.equal(app.config().openRouterApiKey, '')
  assert.equal(app.settings.get('openrouter.apiKey'), '')
})

test('each chat request uses the key its chat started with', async () => {
  const app = fixture({ 'openrouter.enabled': true, 'openrouter.apiKeys': [work, home], 'openrouter.activeKeyId': 'work' })
  // Another chat switched the active key to Home while this chat runs on Work.
  app.setConfig({ openRouterActiveKeyId: 'home' })
  assert.equal((await app.chat({ openRouterKeyId: 'work' })).content, 'Ready')
  assert.equal(app.clients.at(-1).openRouterApiKey, work.apiKey)
  await app.chat({})
  assert.equal(app.clients.at(-1).openRouterApiKey, home.apiKey, 'no id uses the active key')
  await app.chat({ openRouterKeyId: 'deleted' })
  assert.equal(app.clients.at(-1).openRouterApiKey, home.apiKey, 'a deleted key falls back to the active key')
  // Other providers ignore the OpenRouter key id.
  await app.chat({ provider: 'ollama', openRouterKeyId: 'work' })
  assert.equal(app.clients.at(-1).openRouterApiKey, home.apiKey)
})

test('stored keys are validated before they can be selected or sent', () => {
  assert.deepEqual(normalizeOpenRouterApiKeys([
    { id: 'a', label: '  Personal  ', apiKey: ' sk-or-v1-a ' },
    { id: 'a', label: '', apiKey: 'sk-or-v1-b' },
    { id: 'blank', label: 'Empty', apiKey: '   ' },
    { label: 'No id', apiKey: 'sk-or-v1-c' },
    'not an object',
    { id: 'x', label: 'No key' }
  ]), [
    { id: 'a', label: 'Personal', apiKey: 'sk-or-v1-a' },
    { id: 'a-2', label: 'Key 2', apiKey: 'sk-or-v1-b' },
    { id: 'openrouter-key-4', label: 'No id', apiKey: 'sk-or-v1-c' }
  ])
  assert.deepEqual(normalizeOpenRouterApiKeys('sk-or-v1-a'), [])
})
