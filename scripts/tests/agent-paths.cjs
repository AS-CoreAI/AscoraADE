const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { EXTERNAL_FILES_SETTING, externalFilesAllowed } = loadTypeScript('src/shared/agent-file-access.ts')
const defaultStore = { getStore: () => ({ getSetting: () => undefined }) }
const tools = loadTypeScript('src/main/ipc/agent.ts', { electron: { ipcMain: { handle() {} } }, '../store': defaultStore })
const forward = value => value.replace(/\\/g, '/')

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ascora-agent-paths-'))
  const root = path.join(home, 'workspace')
  const outside = path.join(home, '[PS5] Game (2025)', 'PPSA25872')
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(path.join(outside, 'logs'), { recursive: true })
  await fs.writeFile(path.join(root, 'inside.txt'), 'Workspace text')
  await fs.writeFile(path.join(root, '..notes'), 'Dot-prefixed filename')
  await fs.writeFile(path.join(outside, 'logs', 'game.log'), 'Before\nDirectX startup failed\nAfter')
  await fs.writeFile(path.join(outside, 'config.ini'), 'renderer=DirectX')
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(home).startsWith('ascora-agent-paths-'))
    await fs.rm(home, { recursive: true, force: true })
  })
  return { root, outside }
}

test('absolute external directories and files are readable; returned paths remain usable', async t => {
  const { root, outside } = await fixture(t)
  const listing = await tools.listAgentDir(root, outside)
  assert.equal(listing.ok, true, listing.error)
  assert.equal(listing.path, forward(outside))
  assert.deepEqual(listing.entries.map(entry => entry.name), ['logs', 'config.ini'])
  const file = forward(path.join(outside, 'logs', 'game.log'))
  const read = await tools.readAgentFile(root, file, { startLine: 2, endLine: 2 })
  assert.equal(read.ok, true, read.error)
  assert.equal(read.path, file)
  assert.equal(read.content, 'DirectX startup failed')
  assert.equal(read.totalLines, 3)
})

test('external search globs use the selected directory; results can be read directly', async t => {
  const { root, outside } = await fixture(t)
  const search = await tools.searchAgentFiles(root, 'DirectX', { path: outside, glob: 'logs/*.log', context: 1 })
  assert.equal(search.ok, true, search.error)
  assert.equal(search.matches.length, 1)
  assert.equal(search.matches[0].path, forward(path.join(outside, 'logs', 'game.log')))
  assert.deepEqual(search.matches[0].before, ['Before'])
  assert.deepEqual(search.matches[0].after, ['After'])
  assert.equal((await tools.readAgentFile(root, search.matches[0].path)).ok, true)
  const all = await tools.searchAgentFiles(root, 'DirectX', { path: outside })
  assert.equal(all.matches.length, 2)
})

test('relative and absolute internal paths keep workspace-relative results', async t => {
  const { root } = await fixture(t)
  assert.equal((await tools.listAgentDir(root, '.')).path, '.')
  assert.equal((await tools.readAgentFile(root, 'inside.txt')).path, 'inside.txt')
  assert.equal((await tools.readAgentFile(root, path.join(root, 'inside.txt'))).path, 'inside.txt')
  assert.equal((await tools.readAgentFile(root, '..notes')).content, 'Dot-prefixed filename')
  assert.equal((await tools.searchAgentFiles(root, 'Workspace', { glob: '*.txt' })).matches[0].path, 'inside.txt')
})

test('relative parent traversal and NUL do not silently change their target', async t => {
  const { root, outside } = await fixture(t)
  const file = path.join(outside, 'config.ini')
  assert.equal((await tools.listAgentDir(root, '..')).ok, false)
  assert.equal((await tools.readAgentFile(root, file + '\0')).ok, false)
  assert.equal(await fs.readFile(file, 'utf8'), 'renderer=DirectX')
})

test('Windows paths on another drive and UNC shares reach the exact requested directory', async () => {
  const requested = []
  const windows = loadTypeScript('src/main/ipc/agent.ts', {
    '../store': defaultStore,
    electron: { ipcMain: { handle() {} } },
    'node:path': { ...path, ...path.win32 },
    'node:fs/promises': { ...fs, readdir: async target => { requested.push(target); return [] } }
  })
  for (const target of ['D:\\[PS5] Terminator 2D - No Fate (2025) (PPSA25872) (EU) v1.002\\PPSA25872', '\\\\server\\games\\PPSA25872']) {
    const listing = await windows.listAgentDir('E:\\AscoraADE', target)
    assert.equal(listing.ok, true, listing.error)
    assert.equal(requested.at(-1), target)
    assert.equal(listing.path, forward(target))
  }
})

test('POSIX absolute reads stay absolute instead of being prefixed with the workspace', async () => {
  let requested
  let allowed = true
  const posix = loadTypeScript('src/main/ipc/agent.ts', {
    '../store': { getStore: () => ({ getSetting: () => allowed }) },
    electron: { ipcMain: { handle() {} } },
    'node:path': { ...path, ...path.posix },
    'node:fs/promises': { ...fs, readdir: async target => { requested = target; return [] } }
  })
  const listing = await posix.listAgentDir('/home/project', '/mnt/games/PPSA25872')
  assert.equal(listing.ok, true, listing.error)
  assert.equal(requested, '/mnt/games/PPSA25872')
  assert.equal(listing.path, requested)
  allowed = false
  assert.equal((await posix.writeAgentFile('/home/project', '/mnt/games/config.ini', 'x')).ok, false)
})

test('external access defaults on and permits actual creation and editing outside the project', async t => {
  const { root, outside } = await fixture(t)
  assert.equal(externalFilesAllowed(undefined), true)
  assert.equal(externalFilesAllowed(false), false)
  const file = path.join(outside, 'new', 'config.ini')
  const written = await tools.writeAgentFile(root, file, 'renderer=DirectX')
  assert.equal(written.ok, true, written.error)
  assert.equal(written.path, forward(file))
  const edited = await tools.editAgentFile(root, file, 'DirectX', 'Vulkan', false)
  assert.equal(edited.ok, true, edited.error)
  assert.equal(await fs.readFile(file, 'utf8'), 'renderer=Vulkan')
})

test('switching off blocks all five file tools immediately; project files still work and re-enabling restores access', async t => {
  const { root, outside } = await fixture(t)
  const settings = new Map()
  const agent = loadTypeScript('src/main/ipc/agent.ts', {
    electron: { ipcMain: { handle() {} } },
    '../store': { getStore: () => ({ getSetting: key => settings.get(key) }) }
  })
  const file = path.join(outside, 'config.ini')
  assert.equal((await agent.listAgentDir(root, outside)).ok, true)
  settings.set(EXTERNAL_FILES_SETTING, false)
  const denied = await Promise.all([
    agent.listAgentDir(root, outside), agent.readAgentFile(root, file),
    agent.searchAgentFiles(root, 'DirectX', { path: outside }),
    agent.writeAgentFile(root, file, 'changed'), agent.editAgentFile(root, file, 'DirectX', 'Vulkan', false)
  ])
  for (const result of denied) { assert.equal(result.ok, false); assert.equal(result.error, 'Path is outside the workspace.') }
  assert.equal(await fs.readFile(file, 'utf8'), 'renderer=DirectX')
  assert.equal((await agent.listAgentDir(root, '.')).ok, true)
  assert.equal((await agent.readAgentFile(root, 'inside.txt')).ok, true)
  assert.equal((await agent.searchAgentFiles(root, 'Workspace')).matches.length, 1)
  assert.equal((await agent.writeAgentFile(root, 'created.txt', 'inside')).ok, true)
  assert.equal((await agent.editAgentFile(root, 'created.txt', 'inside', 'edited', false)).ok, true)
  settings.set(EXTERNAL_FILES_SETTING, true)
  assert.equal((await agent.readAgentFile(root, file)).ok, true)
  assert.equal((await agent.editAgentFile(root, file, 'DirectX', 'Vulkan', false)).ok, true)
})
