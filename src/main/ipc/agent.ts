import { ipcMain } from 'electron'
import { exec } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  IPC,
  EXCLUDED_DIRS,
  type AgentDirEntry,
  type AgentListResult,
  type AgentReadResult,
  type AgentRunResult,
  type AgentWriteResult
} from '@shared/ipc'

/**
 * Tool primitives the agent loop calls (see store.ts). Every path is resolved
 * relative to the workspace `root` and confined to it — the model never gets to
 * touch files outside the open folder. `run_command` is a one-shot exec (no PTY)
 * with a timeout; non-zero exits are reported, not thrown.
 */

const MAX_READ_BYTES = 1024 * 1024 // 1 MB — keep tool output within token budgets
const RUN_TIMEOUT_MS = 60_000
const RUN_MAX_BUFFER = 8 * 1024 * 1024

class AgentError extends Error {}

/** Resolve `rel` under `root`, refusing escapes (`..`, absolute, NUL). */
function resolveInside(root: string, rel: string): string {
  if (rel == null || rel.includes('\0')) throw new AgentError('Invalid path.')
  const cleaned = rel.trim().replace(/^[/\\]+/, '') // treat leading slash as root-relative
  const absolute = resolve(root, cleaned || '.')
  const within = relative(root, absolute)
  if (within.startsWith('..') || isAbsolute(within)) {
    throw new AgentError('Path is outside the workspace.')
  }
  return absolute
}

function toRel(root: string, absolute: string): string {
  const rel = relative(root, absolute).replace(/\\/g, '/')
  return rel === '' ? '.' : rel
}

function errResult(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) }
}

async function listDir(root: string, rel: string): Promise<AgentListResult> {
  try {
    const dir = resolveInside(root, rel || '.')
    const dirents = await readdir(dir, { withFileTypes: true })
    const entries: AgentDirEntry[] = dirents
      .filter((d) => !(d.isDirectory() && EXCLUDED_DIRS.has(d.name)))
      .map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file' }) as AgentDirEntry)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    return { ok: true, path: toRel(root, dir), entries }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

async function readFileTool(root: string, rel: string): Promise<AgentReadResult> {
  try {
    const file = resolveInside(root, rel)
    const info = await stat(file)
    if (info.isDirectory()) throw new AgentError('Path is a directory, not a file.')
    if (info.size > MAX_READ_BYTES) {
      return { ok: true, path: toRel(root, file), truncated: true, content: '' }
    }
    const buf = await readFile(file)
    if (buf.subarray(0, 8192).includes(0)) {
      return { ok: true, path: toRel(root, file), truncated: true, content: '' }
    }
    return { ok: true, path: toRel(root, file), content: buf.toString('utf8'), truncated: false }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

async function writeFileTool(root: string, rel: string, content: string): Promise<AgentWriteResult> {
  try {
    const file = resolveInside(root, rel)
    if (!rel || toRel(root, file) === '.') throw new AgentError('A file path is required.')
    let created = false
    try {
      await stat(file)
    } catch {
      created = true
    }
    await mkdir(join(file, '..'), { recursive: true })
    const text = typeof content === 'string' ? content : String(content ?? '')
    await writeFile(file, text, 'utf8')
    return { ok: true, path: toRel(root, file), created, bytes: Buffer.byteLength(text, 'utf8') }
  } catch (err) {
    return { ok: false, ...errResult(err) }
  }
}

function runCommand(root: string, command: string): Promise<AgentRunResult> {
  return new Promise((resolvePromise) => {
    if (!command || !command.trim()) {
      resolvePromise({ ok: false, error: 'No command provided.' })
      return
    }
    const onWin = process.platform === 'win32'
    const shell = onWin ? 'powershell.exe' : undefined
    // Force UTF-8 so non-ASCII output isn't mojibake (PowerShell defaults to the OEM codepage).
    const line = onWin ? `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;${command}` : command
    exec(
      line,
      {
        cwd: root,
        timeout: RUN_TIMEOUT_MS,
        maxBuffer: RUN_MAX_BUFFER,
        windowsHide: true,
        shell
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '')
        const err = String(stderr ?? '')
        if (!error) {
          resolvePromise({ ok: true, stdout: out, stderr: err, code: 0 })
          return
        }
        const killed = (error as { killed?: boolean }).killed === true
        const code = typeof (error as { code?: unknown }).code === 'number'
          ? ((error as { code: number }).code)
          : null
        // A non-zero exit is a normal result for the agent, not an IPC failure.
        resolvePromise({
          ok: true,
          stdout: out,
          stderr: err,
          code,
          timedOut: killed
        })
      }
    )
  })
}

export function registerAgentHandlers(): void {
  ipcMain.handle(IPC.agent.listDir, (_e, root: string, path: string): Promise<AgentListResult> =>
    listDir(root, path)
  )
  ipcMain.handle(IPC.agent.readFile, (_e, root: string, path: string): Promise<AgentReadResult> =>
    readFileTool(root, path)
  )
  ipcMain.handle(
    IPC.agent.writeFile,
    (_e, root: string, path: string, content: string): Promise<AgentWriteResult> =>
      writeFileTool(root, path, content)
  )
  ipcMain.handle(
    IPC.agent.runCommand,
    (_e, root: string, command: string): Promise<AgentRunResult> => runCommand(root, command)
  )
}
