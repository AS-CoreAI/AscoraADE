import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import type { Workspace, TaskRecord, TaskSummary, UsageEvent } from '@shared/ipc'
import { recoverInterruptedTask } from '@shared/task-recovery'

/**
 * Local persistence for settings, workspaces and task history (spec: SQLite).
 *
 * Primary implementation is `SqliteStore` (`better-sqlite3`). It's a native
 * module; if it ever fails to load (e.g. it hasn't been rebuilt for the current
 * Electron ABI) we use Electron's built-in `node:sqlite`. Older runtimes can
 * still use `JsonStore`. Everything goes through the `Store`
 * interface, so callers don't care which backend is active.
 */
export interface Store {
  readonly persistent: boolean
  getSetting<T = unknown>(key: string): T | undefined
  setSetting(key: string, value: unknown): void
  allSettings(): Record<string, unknown>
  listWorkspaces(deletedOnly?: boolean): Workspace[]
  addWorkspace(name: string, path: string): Workspace
  renameWorkspace(id: string, name: string): Workspace | null
  /** Soft-delete a project and all of its chats without touching its folder on disk. */
  archiveWorkspace(id: string): Workspace | null
  /** Restore a soft-deleted project together with all of its chats. */
  restoreWorkspace(id: string): Workspace | null
  listTasks(workspaceId: string, deletedOnly?: boolean): TaskSummary[]
  getTask(taskId: string, includeDeleted?: boolean): TaskRecord | null
  saveTask(task: TaskRecord): TaskSummary
  checkpointTask(taskId: string): void
  /** Soft-delete: stamps `deletedAt` and returns the updated summary, or null if not found. */
  deleteTask(taskId: string): TaskSummary | null
  restoreTask(taskId: string): TaskSummary | null
  addUsage(event: UsageEvent): void
  listUsage(): UsageEvent[]
  close(): void
}

interface DbShape {
  settings: Record<string, unknown>
  workspaces: Workspace[]
  tasks: TaskRecord[]
  usage: UsageEvent[]
  checkpoints?: { taskId: string; createdAt: number; convo: TaskRecord['convo'] }[]
}

const EMPTY: DbShape = { settings: {}, workspaces: [], tasks: [], usage: [] }

function taskSummary(task: TaskRecord): TaskSummary {
  const { id, workspaceId, title, status, updatedAt, deletedAt } = task
  return deletedAt ? { id, workspaceId, title, status, updatedAt, deletedAt } : { id, workspaceId, title, status, updatedAt }
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function parseObject<T extends object>(value: string): T {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : ({} as T)
  } catch {
    return {} as T
  }
}

/** File-backed store with atomic writes (write temp, then rename). */
class JsonStore implements Store {
  readonly persistent = true
  private data: DbShape
  private dirty = false
  private writeTimer: NodeJS.Timeout | null = null

  constructor(private file: string) {
    this.data = this.load()
  }

  private load(): DbShape {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<DbShape>
        const tasks = Array.isArray(parsed.tasks)
          ? parsed.tasks.map((task) => recoverInterruptedTask({
              ...task,
              messages: Array.isArray(task.messages) ? task.messages : [],
              convo: Array.isArray(task.convo) ? task.convo : []
            }))
          : []
        const usage = Array.isArray(parsed.usage) ? parsed.usage : []
        return { ...EMPTY, ...parsed, tasks, usage }
      }
    } catch (err) {
      console.warn('[store] failed to read store file, starting fresh:', err)
    }
    return structuredClone(EMPTY)
  }

  /** Debounced atomic flush so rapid setting writes don't thrash the disk. */
  private scheduleFlush(): void {
    this.dirty = true
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => this.flush(), 150)
  }

  private flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    if (!this.dirty) return
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', flush: true })
    renameSync(tmp, this.file)
    this.dirty = false
  }

  getSetting<T = unknown>(key: string): T | undefined {
    return this.data.settings[key] as T | undefined
  }
  setSetting(key: string, value: unknown): void {
    this.data.settings[key] = value
    this.scheduleFlush()
  }
  allSettings(): Record<string, unknown> {
    return { ...this.data.settings }
  }

  listWorkspaces(deletedOnly = false): Workspace[] {
    return this.data.workspaces
      .filter((workspace) => deletedOnly ? !!workspace.deletedAt : !workspace.deletedAt)
      .sort((a, b) => deletedOnly
        ? (b.deletedAt ?? 0) - (a.deletedAt ?? 0)
        : b.lastOpenedAt - a.lastOpenedAt)
      .map((workspace) => ({ ...workspace }))
  }
  addWorkspace(name: string, path: string): Workspace {
    const now = Date.now()
    const existing = this.data.workspaces.find((w) => w.path === path)
    if (existing) {
      existing.name = name
      existing.lastOpenedAt = now
      if (existing.deletedAt) {
        delete existing.deletedAt
        for (const task of this.data.tasks) {
          if (task.workspaceId === existing.id) delete task.deletedAt
        }
      }
      this.scheduleFlush()
      return { ...existing }
    }
    const ws: Workspace = { id: randomUUID(), name, path, lastOpenedAt: now }
    this.data.workspaces.push(ws)
    this.scheduleFlush()
    return ws
  }

  listTasks(workspaceId: string, deletedOnly = false): TaskSummary[] {
    return this.data.tasks
      .filter((t) => t.workspaceId === workspaceId && (deletedOnly ? !!t.deletedAt : !t.deletedAt))
      .sort((a, b) => deletedOnly ? (b.deletedAt ?? 0) - (a.deletedAt ?? 0) : b.updatedAt - a.updatedAt)
      .map(taskSummary)
  }
  renameWorkspace(id: string, name: string): Workspace | null {
    const workspace = this.data.workspaces.find((item) => item.id === id)
    if (!workspace) return null
    workspace.name = name.trim()
    this.scheduleFlush()
    return { ...workspace }
  }

  archiveWorkspace(id: string): Workspace | null {
    const workspace = this.data.workspaces.find((item) => item.id === id)
    if (!workspace || workspace.deletedAt) return null
    const deletedAt = Date.now()
    workspace.deletedAt = deletedAt
    for (const task of this.data.tasks) {
      if (task.workspaceId !== id) continue
      task.deletedAt = deletedAt
      if (task.status === 'running') task.status = 'idle'
    }
    this.scheduleFlush()
    return { ...workspace }
  }

  restoreWorkspace(id: string): Workspace | null {
    const workspace = this.data.workspaces.find((item) => item.id === id)
    if (!workspace?.deletedAt) return null
    delete workspace.deletedAt
    workspace.lastOpenedAt = Date.now()
    for (const task of this.data.tasks) {
      if (task.workspaceId === id) delete task.deletedAt
    }
    this.scheduleFlush()
    return { ...workspace }
  }

  getTask(taskId: string, includeDeleted = false): TaskRecord | null {
    const task = this.data.tasks.find((item) => item.id === taskId && (includeDeleted || !item.deletedAt))
    return task ? structuredClone(task) : null
  }

  saveTask(task: TaskRecord): TaskSummary {
    const stored = structuredClone(task)
    const index = this.data.tasks.findIndex((item) => item.id === task.id)
    if (index === -1) this.data.tasks.push(stored)
    else {
      // A late renderer save must not resurrect a chat after its project was
      // archived. Restoration explicitly clears the stored tombstone first.
      if (this.data.tasks[index].deletedAt && !stored.deletedAt) {
        stored.deletedAt = this.data.tasks[index].deletedAt
      }
      this.data.tasks[index] = stored
    }
    this.scheduleFlush()
    return taskSummary(stored)
  }

  deleteTask(taskId: string): TaskSummary | null {
    const task = this.data.tasks.find((item) => item.id === taskId)
    if (!task || task.deletedAt) return null
    task.deletedAt = Date.now()
    this.scheduleFlush()
    return taskSummary(task)
  }

  checkpointTask(taskId: string): void {
    const task = this.data.tasks.find((item) => item.id === taskId)
    if (!task) throw new Error('Cannot checkpoint a missing task')
    const checkpoints = this.data.checkpoints ??= []
    checkpoints.push({ taskId, createdAt: Date.now(), convo: structuredClone(task.convo) })
    this.dirty = true
    this.flush()
  }

  restoreTask(taskId: string): TaskSummary | null {
    const task = this.data.tasks.find((item) => item.id === taskId)
    if (!task?.deletedAt) return null
    delete task.deletedAt
    task.updatedAt = Date.now()
    this.scheduleFlush()
    return taskSummary(task)
  }

  addUsage(event: UsageEvent): void {
    this.data.usage.push(event)
    this.scheduleFlush()
  }

  listUsage(): UsageEvent[] {
    return [...this.data.usage].sort((a, b) => a.ts - b.ts)
  }

  close(): void {
    this.flush()
  }
}

interface StoreDatabase {
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...params: (string | number | null)[]): unknown
    all(...params: (string | number | null)[]): unknown[]
    run(...params: (string | number | null)[]): { changes: number | bigint }
  }
  transaction<T>(fn: () => T): () => T
  close(): void
}

class SqliteUnavailableError extends Error {}

function openDatabase(file: string): StoreDatabase {
  try {
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(file)
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare<(string | number | null)[]>(sql),
      transaction: (fn) => db.transaction(fn),
      close: () => db.close()
    }
  } catch {
    // Electron ships SQLite with Node. A missing optional native addon should
    // not force the entire chat archive to live in the main process JS heap.
    let sqlite: typeof import('node:sqlite')
    try {
      sqlite = require('node:sqlite') as typeof import('node:sqlite')
    } catch {
      throw new SqliteUnavailableError('Neither better-sqlite3 nor node:sqlite is available')
    }
    // Open errors (corruption, permissions, etc.) must not select a stale JSON
    // archive. Only an unavailable driver permits the legacy fallback.
    const db = new sqlite.DatabaseSync(file)
    console.log('[store] using built-in node:sqlite')
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      close: () => db.close(),
      transaction: (fn) => () => {
        db.exec('BEGIN IMMEDIATE')
        try {
          const result = fn()
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    }
  }
}

/** SQLite-backed store using either supported synchronous driver. */
class SqliteStore implements Store {
  readonly persistent = true
  private db: StoreDatabase

  constructor(file: string, jsonFile?: string) {
    this.db = openDatabase(file)
    try {
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = FULL')
      // SSH chats use virtual workspace IDs; older JSON archives also retain
      // chats whose workspace was removed. Keep those records without inventing
      // local projects. Workspace deletion here is soft deletion, never CASCADE.
      this.db.exec('PRAGMA foreign_keys = OFF')
      this.migrate()
      if (jsonFile) this.importJson(jsonFile)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private importJson(file: string): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS store_migrations (name TEXT PRIMARY KEY)')
    if (this.db.prepare('SELECT name FROM store_migrations WHERE name = ?').get('json-import')) return
    // Import into a separate database: the legacy SQLite and JSON stores may
    // contain different workspace IDs for the same paths. Keep both originals.
    const data = JSON.parse(readFileSync(file, 'utf8')) as DbShape
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) ||
        !Array.isArray(data.workspaces) || !Array.isArray(data.tasks)) {
      throw new Error('Invalid JSON archive; migration cancelled without changing the source')
    }
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(data.settings)) this.setSetting(key, value)
      const workspaceInsert = this.db.prepare(
        'INSERT INTO workspaces (id, name, path, last_opened_at, deleted_at) VALUES (?, ?, ?, ?, ?)'
      )
      for (const ws of data.workspaces) {
        workspaceInsert.run(ws.id, ws.name, ws.path, ws.lastOpenedAt, ws.deletedAt ?? null)
      }
      const tombstone = this.db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?')
      for (const task of data.tasks) {
        this.saveTask({ ...task,
          messages: task.messages ?? [], convo: task.convo ?? [] })
        if (task.deletedAt) tombstone.run(task.deletedAt, task.id)
      }
      for (const event of data.usage ?? []) this.addUsage(event)
      for (const checkpoint of data.checkpoints ?? []) {
        this.db.prepare('INSERT INTO task_context_checkpoints (id, task_id, created_at, convo_json) VALUES (?, ?, ?, ?)')
          .run(randomUUID(), checkpoint.taskId, checkpoint.createdAt, JSON.stringify(checkpoint.convo))
      }
      this.db.prepare('INSERT INTO store_migrations (name) VALUES (?)').run('json-import')
    })()
    console.log(`[store] imported ${data.tasks.length} chats from JSON; original archive retained`)
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        path           TEXT NOT NULL UNIQUE,
        last_opened_at INTEGER NOT NULL,
        deleted_at     INTEGER
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'idle',
        updated_at   INTEGER NOT NULL,
        messages_json TEXT NOT NULL DEFAULT '[]',
        convo_json    TEXT NOT NULL DEFAULT '[]',
        sessions_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS usage (
        id                 TEXT PRIMARY KEY,
        ts                 INTEGER NOT NULL,
        workspace_id       TEXT NOT NULL,
        workspace_name     TEXT NOT NULL,
        task_id            TEXT NOT NULL,
        provider           TEXT NOT NULL,
        model              TEXT NOT NULL,
        input_tokens       INTEGER NOT NULL DEFAULT 0,
        output_tokens      INTEGER NOT NULL DEFAULT 0,
        user_messages      INTEGER NOT NULL DEFAULT 0,
        assistant_messages INTEGER NOT NULL DEFAULT 0,
        estimated          INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
      CREATE TABLE IF NOT EXISTS task_context_checkpoints (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at INTEGER NOT NULL, convo_json TEXT NOT NULL
      );
    `)

    const workspaceColumns = this.db.prepare('PRAGMA table_info(workspaces)').all() as { name: string }[]
    if (!workspaceColumns.some((column) => column.name === 'deleted_at')) {
      this.db.exec('ALTER TABLE workspaces ADD COLUMN deleted_at INTEGER')
    }

    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    if (!taskColumns.some((column) => column.name === 'messages_json')) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!taskColumns.some((column) => column.name === 'convo_json')) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN convo_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!taskColumns.some((column) => column.name === 'sessions_json')) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN sessions_json TEXT NOT NULL DEFAULT '{}'")
    }
    if (!taskColumns.some((column) => column.name === 'deleted_at')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN deleted_at INTEGER')
    }
  }

  getSetting<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }
  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, JSON.stringify(value))
  }
  allSettings(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const out: Record<string, unknown> = {}
    for (const r of rows) out[r.key] = JSON.parse(r.value)
    return out
  }

  listWorkspaces(deletedOnly = false): Workspace[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, path, last_opened_at, deleted_at FROM workspaces
         WHERE deleted_at IS ${deletedOnly ? 'NOT NULL ORDER BY deleted_at DESC' : 'NULL ORDER BY last_opened_at DESC'}`
      )
      .all() as { id: string; name: string; path: string; last_opened_at: number; deleted_at: number | null }[]
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      lastOpenedAt: r.last_opened_at,
      ...(r.deleted_at ? { deletedAt: r.deleted_at } : {})
    }))
  }
  addWorkspace(name: string, path: string): Workspace {
    const now = Date.now()
    const existing = this.db.prepare('SELECT id, deleted_at FROM workspaces WHERE path = ?').get(path) as
      | { id: string; deleted_at: number | null }
      | undefined
    const id = existing?.id ?? randomUUID()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workspaces (id, name, path, last_opened_at, deleted_at) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(path) DO UPDATE SET
             name = excluded.name,
             last_opened_at = excluded.last_opened_at,
             deleted_at = NULL`
        )
        .run(id, name, path, now)
      if (existing?.deleted_at) {
        this.db.prepare('UPDATE tasks SET deleted_at = NULL WHERE workspace_id = ?').run(id)
      }
    })()
    return { id, name, path, lastOpenedAt: now }
  }
  renameWorkspace(id: string, name: string): Workspace | null {
    const value = name.trim()
    const info = this.db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(value, id)
    if (info.changes === 0) return null
    const row = this.db
      .prepare('SELECT id, name, path, last_opened_at FROM workspaces WHERE id = ?')
      .get(id) as { id: string; name: string; path: string; last_opened_at: number }
    return { id: row.id, name: row.name, path: row.path, lastOpenedAt: row.last_opened_at }
  }

  archiveWorkspace(id: string): Workspace | null {
    const deletedAt = Date.now()
    const archived = this.db.transaction(() => {
      const info = this.db
        .prepare('UPDATE workspaces SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(deletedAt, id)
      if (info.changes === 0) return false
      this.db
        .prepare(
          `UPDATE tasks SET deleted_at = ?, status = CASE WHEN status = 'running' THEN 'idle' ELSE status END
           WHERE workspace_id = ?`
        )
        .run(deletedAt, id)
      return true
    })()
    if (!archived) return null
    const row = this.db
      .prepare('SELECT id, name, path, last_opened_at FROM workspaces WHERE id = ?')
      .get(id) as { id: string; name: string; path: string; last_opened_at: number }
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      lastOpenedAt: row.last_opened_at,
      deletedAt
    }
  }

  restoreWorkspace(id: string): Workspace | null {
    const lastOpenedAt = Date.now()
    const restored = this.db.transaction(() => {
      const info = this.db
        .prepare('UPDATE workspaces SET deleted_at = NULL, last_opened_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
        .run(lastOpenedAt, id)
      if (info.changes === 0) return false
      this.db.prepare('UPDATE tasks SET deleted_at = NULL WHERE workspace_id = ?').run(id)
      return true
    })()
    if (!restored) return null
    const row = this.db
      .prepare('SELECT id, name, path FROM workspaces WHERE id = ?')
      .get(id) as { id: string; name: string; path: string }
    return { id: row.id, name: row.name, path: row.path, lastOpenedAt }
  }

  listTasks(workspaceId: string, deletedOnly = false): TaskSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, title, status, updated_at, deleted_at
         FROM tasks WHERE workspace_id = ? AND deleted_at IS ${deletedOnly ? 'NOT NULL ORDER BY deleted_at DESC' : 'NULL ORDER BY updated_at DESC'}`
      )
      .all(workspaceId) as {
      id: string
      workspace_id: string
      title: string
      status: TaskSummary['status']
      updated_at: number
      deleted_at: number | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      title: r.title,
      status: r.status === 'running' ? 'idle' : r.status,
      updatedAt: r.updated_at,
      ...(r.deleted_at ? { deletedAt: r.deleted_at } : {})
    }))
  }

  getTask(taskId: string, includeDeleted = false): TaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, workspace_id, title, status, updated_at, deleted_at, messages_json, convo_json, sessions_json
         FROM tasks WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`
      )
      .get(taskId) as
      | {
          id: string
          workspace_id: string
          title: string
          status: TaskSummary['status']
          updated_at: number
          deleted_at: number | null
          messages_json: string
          convo_json: string
          sessions_json: string
        }
      | undefined
    if (!row) return null
    return recoverInterruptedTask({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
      messages: parseArray(row.messages_json),
      convo: parseArray(row.convo_json),
      sessions: parseObject(row.sessions_json)
    })
  }

  checkpointTask(taskId: string): void {
    const result = this.db.prepare(
      'INSERT INTO task_context_checkpoints (id, task_id, created_at, convo_json) SELECT ?, id, ?, convo_json FROM tasks WHERE id = ?'
    ).run(randomUUID(), Date.now(), taskId)
    if (Number(result.changes) !== 1) throw new Error('Cannot checkpoint a missing task')
  }

  saveTask(task: TaskRecord): TaskSummary {
    this.db
      .prepare(
        `INSERT INTO tasks
           (id, workspace_id, title, status, updated_at, messages_json, convo_json, sessions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           title = excluded.title,
           status = excluded.status,
           updated_at = excluded.updated_at,
           messages_json = excluded.messages_json,
           convo_json = excluded.convo_json,
           sessions_json = excluded.sessions_json`
      )
      .run(
        task.id,
        task.workspaceId,
        task.title,
        task.status,
        task.updatedAt,
        JSON.stringify(task.messages),
        JSON.stringify(task.convo),
        JSON.stringify(task.sessions ?? {})
      )
    return taskSummary(task)
  }

  deleteTask(taskId: string): TaskSummary | null {
    const now = Date.now()
    const info = this.db
      .prepare('UPDATE tasks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(now, taskId)
    if (info.changes === 0) return null
    const row = this.db
      .prepare('SELECT id, workspace_id, title, status, updated_at, deleted_at FROM tasks WHERE id = ?')
      .get(taskId) as {
      id: string
      workspace_id: string
      title: string
      status: TaskSummary['status']
      updated_at: number
      deleted_at: number
    }
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at
    }
  }

  restoreTask(taskId: string): TaskSummary | null {
    const now = Date.now()
    const info = this.db
      .prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
      .run(now, taskId)
    if (info.changes === 0) return null
    const row = this.db
      .prepare('SELECT id, workspace_id, title, status, updated_at FROM tasks WHERE id = ?')
      .get(taskId) as { id: string; workspace_id: string; title: string; status: TaskSummary['status']; updated_at: number }
    return { id: row.id, workspaceId: row.workspace_id, title: row.title, status: row.status, updatedAt: row.updated_at }
  }

  addUsage(event: UsageEvent): void {
    this.db
      .prepare(
        `INSERT INTO usage
           (id, ts, workspace_id, workspace_name, task_id, provider, model,
            input_tokens, output_tokens, user_messages, assistant_messages, estimated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.ts,
        event.workspaceId,
        event.workspaceName,
        event.taskId,
        event.provider,
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.userMessages,
        event.assistantMessages,
        event.estimated ? 1 : 0
      )
  }

  listUsage(): UsageEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, ts, workspace_id, workspace_name, task_id, provider, model,
                input_tokens, output_tokens, user_messages, assistant_messages, estimated
         FROM usage ORDER BY ts ASC`
      )
      .all() as {
      id: string
      ts: number
      workspace_id: string
      workspace_name: string
      task_id: string
      provider: string
      model: string
      input_tokens: number
      output_tokens: number
      user_messages: number
      assistant_messages: number
      estimated: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      taskId: r.task_id,
      provider: r.provider as UsageEvent['provider'],
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      userMessages: r.user_messages,
      assistantMessages: r.assistant_messages,
      estimated: r.estimated === 1
    }))
  }

  close(): void {
    this.db.close()
  }
}

let store: Store | null = null

export function getStore(): Store {
  if (store) return store
  const userData = app.getPath('userData')
  const jsonFile = join(userData, 'ascora-store.json')
  const legacyFile = join(userData, 'ascora.db')
  const importedFile = join(userData, 'ascora-store.db')
  const modified = (file: string): number => existsSync(file) ? statSync(file).mtimeMs : 0
  // Once created, the imported database is authoritative. Otherwise select the
  // most recently written archive, including SQLite's uncheckpointed WAL.
  const importJson = existsSync(importedFile) || (existsSync(jsonFile) &&
    modified(jsonFile) >= Math.max(modified(legacyFile), modified(`${legacyFile}-wal`)))
  const file = importJson ? importedFile : legacyFile
  try {
    store = new SqliteStore(file, importJson ? jsonFile : undefined)
    console.log(`[store] SQLite ready at ${file}`)
  } catch (err) {
    if (!(err instanceof SqliteUnavailableError) || existsSync(importedFile)) throw err
    console.warn(
      '[store] SQLite drivers unavailable — using legacy JSON store. ' +
        'Use the supported Electron runtime or run `npm run rebuild`.'
    )
    store = new JsonStore(jsonFile)
    console.log(`[store] JSON store ready at ${jsonFile}`)
  }
  return store
}

export function closeStore(): void {
  store?.close()
  store = null
}
