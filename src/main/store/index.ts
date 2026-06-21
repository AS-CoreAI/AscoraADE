import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import type { Workspace, TaskRecord, TaskSummary, UsageEvent } from '@shared/ipc'

/**
 * Local persistence for settings, workspaces and task history (spec: SQLite).
 *
 * Primary implementation is `SqliteStore` (`better-sqlite3`). It's a native
 * module; if it ever fails to load (e.g. it hasn't been rebuilt for the current
 * Electron ABI) we fall back to the file-backed `JsonStore` so the app always
 * launches with persistence intact. Everything goes through the `Store`
 * interface, so callers don't care which backend is active.
 */
export interface Store {
  readonly persistent: boolean
  getSetting<T = unknown>(key: string): T | undefined
  setSetting(key: string, value: unknown): void
  allSettings(): Record<string, unknown>
  listWorkspaces(): Workspace[]
  addWorkspace(name: string, path: string): Workspace
  listTasks(workspaceId: string): TaskSummary[]
  getTask(taskId: string): TaskRecord | null
  saveTask(task: TaskRecord): TaskSummary
  addUsage(event: UsageEvent): void
  listUsage(): UsageEvent[]
  close(): void
}

interface DbShape {
  settings: Record<string, unknown>
  workspaces: Workspace[]
  tasks: TaskRecord[]
  usage: UsageEvent[]
}

const EMPTY: DbShape = { settings: {}, workspaces: [], tasks: [], usage: [] }

function taskSummary(task: TaskRecord): TaskSummary {
  const { id, workspaceId, title, status, updatedAt } = task
  return { id, workspaceId, title, status, updatedAt }
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
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
          ? parsed.tasks.map((task) => ({
              ...task,
              status: task.status === 'running' ? ('idle' as const) : task.status,
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
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
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

  listWorkspaces(): Workspace[] {
    return [...this.data.workspaces].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }
  addWorkspace(name: string, path: string): Workspace {
    const now = Date.now()
    const existing = this.data.workspaces.find((w) => w.path === path)
    if (existing) {
      existing.name = name
      existing.lastOpenedAt = now
      this.scheduleFlush()
      return existing
    }
    const ws: Workspace = { id: randomUUID(), name, path, lastOpenedAt: now }
    this.data.workspaces.push(ws)
    this.scheduleFlush()
    return ws
  }

  listTasks(workspaceId: string): TaskSummary[] {
    return this.data.tasks
      .filter((t) => t.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(taskSummary)
  }

  getTask(taskId: string): TaskRecord | null {
    const task = this.data.tasks.find((item) => item.id === taskId)
    return task ? structuredClone(task) : null
  }

  saveTask(task: TaskRecord): TaskSummary {
    const stored = structuredClone(task)
    const index = this.data.tasks.findIndex((item) => item.id === task.id)
    if (index === -1) this.data.tasks.push(stored)
    else this.data.tasks[index] = stored
    this.scheduleFlush()
    return taskSummary(stored)
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

/** SQLite-backed store (spec default). `Database` is injected so the module is
 *  only `require`d when present, keeping the type-check independent of it. */
class SqliteStore implements Store {
  readonly persistent = true
  private db: import('better-sqlite3').Database

  constructor(Database: typeof import('better-sqlite3'), file: string) {
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
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
        last_opened_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'idle',
        updated_at   INTEGER NOT NULL,
        messages_json TEXT NOT NULL DEFAULT '[]',
        convo_json    TEXT NOT NULL DEFAULT '[]',
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
    `)

    const columns = this.db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'messages_json')) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!columns.some((column) => column.name === 'convo_json')) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN convo_json TEXT NOT NULL DEFAULT '[]'")
    }
    this.db.prepare("UPDATE tasks SET status = 'idle' WHERE status = 'running'").run()
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

  listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare('SELECT id, name, path, last_opened_at FROM workspaces ORDER BY last_opened_at DESC')
      .all() as { id: string; name: string; path: string; last_opened_at: number }[]
    return rows.map((r) => ({ id: r.id, name: r.name, path: r.path, lastOpenedAt: r.last_opened_at }))
  }
  addWorkspace(name: string, path: string): Workspace {
    const now = Date.now()
    const existing = this.db.prepare('SELECT id FROM workspaces WHERE path = ?').get(path) as
      | { id: string }
      | undefined
    const id = existing?.id ?? randomUUID()
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, path, last_opened_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened_at = excluded.last_opened_at`
      )
      .run(id, name, path, now)
    return { id, name, path, lastOpenedAt: now }
  }

  listTasks(workspaceId: string): TaskSummary[] {
    const rows = this.db
      .prepare(
        'SELECT id, workspace_id, title, status, updated_at FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC'
      )
      .all(workspaceId) as {
      id: string
      workspace_id: string
      title: string
      status: TaskSummary['status']
      updated_at: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      title: r.title,
      status: r.status,
      updatedAt: r.updated_at
    }))
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, workspace_id, title, status, updated_at, messages_json, convo_json
         FROM tasks WHERE id = ?`
      )
      .get(taskId) as
      | {
          id: string
          workspace_id: string
          title: string
          status: TaskSummary['status']
          updated_at: number
          messages_json: string
          convo_json: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      messages: parseArray(row.messages_json),
      convo: parseArray(row.convo_json)
    }
  }

  saveTask(task: TaskRecord): TaskSummary {
    this.db
      .prepare(
        `INSERT INTO tasks
           (id, workspace_id, title, status, updated_at, messages_json, convo_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           title = excluded.title,
           status = excluded.status,
           updated_at = excluded.updated_at,
           messages_json = excluded.messages_json,
           convo_json = excluded.convo_json`
      )
      .run(
        task.id,
        task.workspaceId,
        task.title,
        task.status,
        task.updatedAt,
        JSON.stringify(task.messages),
        JSON.stringify(task.convo)
      )
    return taskSummary(task)
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
  try {
    // Lazy require so an unbuilt native binary degrades to the JSON fallback.
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const file = join(userData, 'ascora.db')
    store = new SqliteStore(Database, file)
    console.log(`[store] SQLite ready at ${file}`)
  } catch (err) {
    const file = join(userData, 'ascora-store.json')
    console.warn(
      '[store] better-sqlite3 unavailable — using JSON store fallback ' +
        '(install C++ build tools, then `npm install better-sqlite3`):',
      err instanceof Error ? err.message : err
    )
    store = new JsonStore(file)
    console.log(`[store] JSON store ready at ${file}`)
  }
  return store
}

export function closeStore(): void {
  store?.close()
  store = null
}
