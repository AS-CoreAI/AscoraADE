// node --test scripts/tests/chat-persistence.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const { loadTypeScript } = require('./llm-fixture.cjs')
const root = path.resolve(__dirname, '../../.build')
const { checkpointConversation, recoverInterruptedTask } = loadTypeScript('src/shared/task-recovery.ts')

function fixture(t) {
  fs.mkdirSync(root, { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, 'chat-persistence-'))
  const module = loadTypeScript('src/main/store/index.ts', {
    electron: { app: { getPath: () => dir } },
    'better-sqlite3': class { constructor() { throw new Error('Missing native binary') } }
  })
  t.after(() => {
    module.closeStore()
    assert.equal(path.dirname(path.resolve(dir)), root)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { dir, ...module }
}

const task = (id = 'task') => ({ id, workspaceId: 'workspace', title: 'Recovery fixture', status: 'running', updatedAt: 42,
  messages: [{ id: 'thought', kind: 'text', role: 'assistant', reasoning: true, text: 'Preserve this reasoning' },
    { id: 'reply', kind: 'text', role: 'assistant', text: 'Partial answer' },
    { id: 'tool', kind: 'tool', role: 'assistant', text: '', tool: 'run_command', status: 'running' }],
  convo: [{ role: 'user', content: 'Fix the test' }, { role: 'assistant', content: '', tool_calls: [{ id: 'call', type: 'function', function: { name: 'run_command', arguments: '{}' } }] }],
  sessions: { codexThreadId: 'keep-session' } })

function archive() {
  return { settings: { theme: 'dark' }, workspaces: [{ id: 'workspace', name: 'Test', path: 'test-path', lastOpenedAt: 12 }],
    tasks: [task(), { ...task('deleted'), deletedAt: 30 }, { ...task('ssh'), workspaceId: 'ssh:host' }], usage: [] }
}

test('missing addon migrates JSON to built-in SQLite without touching either original; restart preserves reasoning and context', t => {
  const f = fixture(t)
  const old = new DatabaseSync(path.join(f.dir, 'ascora.db'))
  old.exec('CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES (\'old archive\')')
  old.close()
  const oldBytes = fs.readFileSync(path.join(f.dir, 'ascora.db'))
  const json = JSON.stringify(archive())
  fs.writeFileSync(path.join(f.dir, 'ascora-store.json'), json)
  fs.utimesSync(path.join(f.dir, 'ascora-store.json'), new Date(), new Date(Date.now() + 1000))
  let store = f.getStore()
  assert.equal(store.getSetting('theme'), 'dark')
  assert.equal(store.listTasks('workspace').length, 1)
  assert.equal(store.listTasks('workspace', true).length, 1)
  const recovered = store.getTask('task')
  assert.equal(recovered.status, 'idle')
  assert.equal(recovered.messages[0].text, 'Preserve this reasoning')
  assert.equal(recovered.messages[2].status, 'error')
  assert.equal(recovered.convo.at(-2).tool_call_id, 'call')
  assert.equal(recovered.sessions.codexThreadId, 'keep-session')
  assert.equal(store.listTasks('ssh:host').length, 1)
  store.saveTask({ ...task('ssh-new'), workspaceId: 'ssh:host' })
  store.checkpointTask('task')
  store.saveTask({ ...recovered, convo: [{ role: 'user', content: 'Compressed' }] })
  f.closeStore()
  // A retained JSON backup must never be reimported on the next launch.
  store = f.getStore()
  assert.equal(store.getTask('task').convo[0].content, 'Compressed')
  const db = new DatabaseSync(path.join(f.dir, 'ascora-store.db'), { readOnly: true })
  assert.equal(JSON.parse(db.prepare('SELECT convo_json FROM task_context_checkpoints').get().convo_json)[0].content, 'Fix the test')
  db.close()
  assert.equal(fs.readFileSync(path.join(f.dir, 'ascora-store.json'), 'utf8'), json)
  assert.deepEqual(fs.readFileSync(path.join(f.dir, 'ascora.db')), oldBytes)
})

test('failed import rolls back all rows and can be retried without damaging the source', t => {
  const f = fixture(t), data = archive()
  data.tasks.push(task()) // duplicate IDs must not quietly discard a chat
  // saveTask is an upsert; a duplicate workspace path instead forces rollback.
  data.workspaces.push({ ...data.workspaces[0], id: 'duplicate' })
  fs.writeFileSync(path.join(f.dir, 'ascora-store.json'), JSON.stringify(data))
  assert.throws(() => f.getStore(), /UNIQUE/)
  const db = new DatabaseSync(path.join(f.dir, 'ascora-store.db'))
  assert.equal(db.prepare('SELECT count(*) n FROM settings').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM store_migrations').get().n, 0)
  db.close()
  fs.writeFileSync(path.join(f.dir, 'ascora-store.json'), JSON.stringify(archive()))
  assert.equal(f.getStore().listTasks('workspace').length, 1)
})

test('a committed checkpoint survives abrupt process exit without closeStore', t => {
  const f = fixture(t)
  const source = `const {loadTypeScript}=require(${JSON.stringify(path.join(__dirname, 'llm-fixture.cjs'))});
    const {getStore}=loadTypeScript('src/main/store/index.ts',{electron:{app:{getPath:()=>process.argv[1]}},'better-sqlite3':class{constructor(){throw Error('unbuilt')}}});
    const s=getStore(); const w=s.addWorkspace('Crash','crash-path');
    s.saveTask({...${JSON.stringify(task())},workspaceId:w.id}); process.exit(0);`
  const child = spawnSync(process.execPath, ['-e', source, f.dir], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  assert.equal(f.getStore().getTask('task').messages[0].text, 'Preserve this reasoning')
})

test('checkpoint includes partial prose, keeps reasoning separate and repairs dangling tools once', () => {
  const t = task()
  const convo = checkpointConversation([], t.messages, 'reply')
  assert.deepEqual(convo, [{ role: 'assistant', content: 'Partial answer' }])
  assert.deepEqual(checkpointConversation([], t.messages, 'thought'), [])
  assert.deepEqual(checkpointConversation([], [{ ...t.messages[1], contextSummary: true }], 'reply'), [])
  const recovered = recoverInterruptedTask(t)
  assert.deepEqual(recoverInterruptedTask(recovered), recovered)
  assert.equal(t.status, 'running')
  assert.equal(t.messages[2].status, 'running')
})
