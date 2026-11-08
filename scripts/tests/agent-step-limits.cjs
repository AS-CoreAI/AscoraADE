const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { AGENT_STEP_LIMIT_SETTING, normalizeAgentStepLimit } = loadTypeScript('src/shared/agent-limits.ts')
const { EXTERNAL_FILES_SETTING } = loadTypeScript('src/shared/agent-file-access.ts')
const graph = loadTypeScript('src/main/blueprint/graph.ts')
const toolFunctions = loadTypeScript('src/main/blueprint/tools.ts', { '../ipc/agent': {}, '../ipc/web': {} })

test('missing settings disable the limit; enabled limits require a positive integer', () => {
  assert.deepEqual(normalizeAgentStepLimit(undefined), { enabled: false, maxSteps: 16 })
  assert.deepEqual(normalizeAgentStepLimit({ enabled: 'true', maxSteps: 72 }), { enabled: false, maxSteps: 72 })
  assert.deepEqual(normalizeAgentStepLimit({ enabled: true, maxSteps: 72 }), { enabled: true, maxSteps: 72 })
  for (const value of [0, -1, NaN, Infinity, 2.5]) assert.equal(normalizeAgentStepLimit({ maxSteps: value }).maxSteps, 16)
})

async function blueprintFixture({ limit, turns = 70, plain = false, workspace = false, onTool, onChat } = {}) {
  const settings = new Map(limit ? [[AGENT_STEP_LIMIT_SETTING, limit]] : [])
  const saved = { getSetting: key => structuredClone(settings.get(key)), setSetting: (key, value) => settings.set(key, structuredClone(value)),
    listWorkspaces: () => workspace ? [{ id: 'fixture-space', name: 'Fixture', path: __dirname }] : [] }
  const requests = [], calls = [], events = []
  let finished
  const done = new Promise(resolve => { finished = resolve })
  let runner
  runner = loadTypeScript('src/main/blueprint/runner.ts', {
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    '../store': { getStore: () => saved }, '../ipc/agent': {}, './graph': graph,
    './tools': { ...toolFunctions, executeBlueprintTool: async (call, _root, signal) => {
      calls.push(call); await onTool?.({ runner, settings, count: calls.length, signal })
      return `Verified result ${calls.length}`
    } },
    '../wprovider/runner': {
      chatWProvider: async (id, _service, params) => {
        requests.push({ id, messages: structuredClone(params.messages) })
        const override = await onChat?.({ runner, count: requests.length })
        return override ?? { ok: true, content: requests.length <= turns
          ? '```tool_call\n{"name":"web_search","arguments":{"query":"fixture"}}\n```'
          : 'Finished all tool work.' }
      },
      abortWProvider: () => {}, forgetWProviderSession: () => {}
    }
  })
  runner.saveBlueprint({ id: 'fixture', name: 'Fixture', agentMode: !plain,
    ...(workspace ? { workspaceId: 'fixture-space' } : {}),
    agents: [{ id: 'agent', name: 'Agent', role: 'Tester', service: 'qwen', enabled: true, instructions: '' }],
    steps: [{ id: 'step', name: 'Work', type: 'agent', agentId: 'agent', prompt: '{{input}}' }],
    schedule: { enabled: false, intervalMinutes: 60 } })
  const result = runner.startBlueprint({ blueprintId: 'fixture', input: 'Complete the task' }, {
    isDestroyed: () => false,
    send: (_channel, event) => { events.push(event); if (['run-completed', 'run-stopped', 'run-failed'].includes(event.kind)) finished(event.run) }
  })
  assert.equal(result.ok, true)
  const run = await done
  return { run, requests, calls, events, persisted: runner.listBlueprints()[0].lastRun }
}

test('Blueprint agents complete 70 tool rounds by default, preserving audit and context', async () => {
  const result = await blueprintFixture()
  assert.equal(result.run.status, 'completed', result.run.error)
  assert.equal(result.calls.length, 70)
  assert.equal(result.requests.length, 71)
  assert.equal(new Set(result.requests.map(r => r.id)).size, 71)
  assert.equal(result.run.steps[0].tools.length, 70)
  assert.equal(result.persisted.steps[0].output, 'Finished all tool work.')
  assert.ok(result.requests.at(-1).messages.at(-1).content.includes('Verified result 70'))
})

test('opt-in Blueprint limit stops at the configured count after recording completed tools', async () => {
  const result = await blueprintFixture({ limit: { enabled: true, maxSteps: 4 } })
  assert.equal(result.run.status, 'stopped', result.run.error)
  assert.match(result.run.error, /configured limit of 4/)
  assert.equal(result.requests.length, 4)
  assert.equal(result.calls.length, 4)
  assert.ok(result.run.steps[0].tools.every(tool => tool.status === 'completed'))
  assert.equal(result.persisted.status, 'stopped')
})

test('Blueprint picks up disabling the limit at the next turn boundary', async () => {
  const result = await blueprintFixture({ limit: { enabled: true, maxSteps: 4 },
    onTool: ({ settings, count }) => { if (count === 3) settings.set(AGENT_STEP_LIMIT_SETTING, { enabled: false, maxSteps: 4 }) } })
  assert.equal(result.run.status, 'completed', result.run.error)
  assert.equal(result.calls.length, 70)
})

test('Blueprint refreshes file access instructions when the global preference changes', async () => {
  const result = await blueprintFixture({ turns: 2, workspace: true,
    onTool: ({ settings, count }) => settings.set(EXTERNAL_FILES_SETTING, count !== 1) })
  assert.equal(result.run.status, 'completed', result.run.error)
  assert.match(result.requests[0].messages[0].content, /External file access is enabled/)
  assert.match(result.requests[1].messages[0].content, /External file access is disabled/)
  assert.match(result.requests[2].messages[0].content, /External file access is enabled/)
})

test('Stop still cancels a long Blueprint run and retains finished tool results', async () => {
  const result = await blueprintFixture({ onTool: ({ runner, count, signal }) => {
    if (count === 20) { runner.stopBlueprint('fixture'); assert.equal(signal.aborted, true) }
  } })
  assert.equal(result.run.status, 'stopped')
  assert.equal(result.calls.length, 20)
  assert.equal(result.persisted.steps[0].tools.filter(tool => tool.status === 'completed').length, 19)
  assert.equal(result.persisted.steps[0].tools.at(-1).status, 'stopped')
})

test('provider failures terminate a long Blueprint run; plain steps still return once', async () => {
  const failure = await blueprintFixture({ onChat: ({ count }) => count === 22 ? { ok: false, error: 'Fixture provider failure' } : undefined })
  assert.equal(failure.run.status, 'failed')
  assert.equal(failure.requests.length, 22)
  assert.match(failure.run.error, /Fixture provider failure/)
  const plain = await blueprintFixture({ plain: true })
  assert.equal(plain.run.status, 'completed')
  assert.equal(plain.requests.length, 1)
  assert.equal(plain.calls.length, 0)
})
