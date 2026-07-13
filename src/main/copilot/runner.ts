import { app, type WebContents } from 'electron'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crossSpawn from 'cross-spawn'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  IPC,
  type CodexCheckResult,
  type CodexEvent,
  type CodexEventPayload,
  type CodexRunResult,
  type CopilotLoginResult,
  type CopilotPermissionMode,
  type CopilotReasoning,
  type CopilotRunParams
} from '@shared/ipc'
import { openCliLoginTerminal } from '../cli-login'

/**
 * Drives GitHub's `copilot` CLI as another local agent backend.
 *
 * GitHub Copilot CLI's documented programmatic surface is prompt mode:
 *
 *   copilot -p "..." --mode=autopilot --allow-tool="write, shell"
 *
 * Copilot supports JSONL output, but its event schema is less established than
 * Codex/Claude's. We parse known assistant/result shapes defensively, keep a
 * text fallback, surface stderr as notices/errors, and derive file-change
 * summaries by comparing the workspace's git diff before and after the process.
 */

interface Run {
  child: ChildProcessWithoutNullStreams
  killed: boolean
}

interface FileStat {
  kind: string
  added: number
  removed: number
}

const runs = new Map<string, Run>()

// ---------- binary resolution ----------

function findOnPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export function resolveCopilotPath(configured?: string): { path: string; found: boolean } {
  const want = configured?.trim()
  if (want) {
    if (existsSync(want)) return { path: want, found: true }
    const onPath = findOnPath(want)
    if (onPath) return { path: onPath, found: true }
    return { path: want, found: false }
  }
  const onPath = findOnPath('copilot')
  if (onPath) return { path: onPath, found: true }
  return { path: 'copilot', found: false }
}

// ---------- install / auth probe ----------

function collect(
  file: string,
  args: string[],
  timeoutMs = 8000
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolveResult) => {
    let child: ChildProcessWithoutNullStreams
    try {
      // cross-spawn, not node:spawn: the Copilot CLI ships as a `.bat`/`.cmd`
      // shim on Windows, which node's spawn refuses with `EINVAL` unless run
      // through a shell. cross-spawn resolves the shim and escapes args safely.
      child = crossSpawn(file, args, { windowsHide: true, env: process.env }) as ChildProcessWithoutNullStreams
    } catch (err) {
      resolveResult({ code: null, stdout: '', stderr: '', error: err instanceof Error ? err.message : String(err) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (r: { code: number | null; stdout: string; stderr: string; error?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(r)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      done({ code: null, stdout, stderr, error: 'timed out' })
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c: string) => (stdout += c))
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', (err) => done({ code: null, stdout, stderr, error: err.message }))
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
}

function copilotHome(): string {
  return process.env.COPILOT_HOME?.trim() || join(homedir(), '.copilot')
}

function hasTokenEnv(): boolean {
  return ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'].some((key) => Boolean(process.env[key]?.trim()))
}

function hasPlaintextAuthSignal(): boolean {
  const root = copilotHome()
  if (!existsSync(root)) return false
  try {
    const names = readdirSync(root).map((name) => name.toLowerCase())
    return names.some((name) => /auth|credential|token|account|user/.test(name))
  } catch {
    return false
  }
}

async function hasGitHubCliAuth(): Promise<boolean> {
  const gh = findOnPath('gh')
  if (!gh) return false
  const res = await collect(gh, ['auth', 'status'], 5000)
  const text = `${res.stdout}\n${res.stderr}`
  return res.code === 0 && !/not logged in|not authenticated|failed/i.test(text)
}

const AUTH_ERROR = /No authentication information found|Authentication token found but could not be validated|Bad credentials/i

async function verifyCopilotPromptAuth(path: string): Promise<{ loggedIn: boolean; note?: string }> {
  const res = await collect(
    path,
    ['-p', 'Reply with OK.', '--silent', '--no-color', '--no-ask-user', '--mode=plan', '--allow-tool=read'],
    30000
  )
  const text = `${res.stdout}\n${res.stderr}`.trim()
  if (res.code === 0) return { loggedIn: true, note: 'Verified by Copilot CLI' }
  if (AUTH_ERROR.test(text)) return { loggedIn: false, note: 'Copilot CLI is not signed in' }
  return { loggedIn: false, note: text.split(/\r?\n/).find(Boolean) ?? res.error ?? 'Copilot auth check failed' }
}

export async function checkCopilot(configured?: string, verifyAuth = false): Promise<CodexCheckResult> {
  const { path, found } = resolveCopilotPath(configured)
  if (!found) {
    return {
      ok: true,
      installed: false,
      path,
      error: 'GitHub Copilot CLI not found. Install it, or set the binary path in agent backend settings.'
    }
  }

  const ver = await collect(path, ['--version'])
  if (ver.error || ver.code !== 0) {
    return {
      ok: true,
      installed: false,
      path,
      error: ver.error ?? ver.stderr.trim() ?? 'copilot --version failed'
    }
  }

  let loggedIn = hasTokenEnv() || hasPlaintextAuthSignal() || (await hasGitHubCliAuth())
  let authNote: string | undefined
  if (!loggedIn && verifyAuth) {
    const verified = await verifyCopilotPromptAuth(path)
    loggedIn = verified.loggedIn
    authNote = verified.note
  }
  return {
    ok: true,
    installed: true,
    path,
    version: (ver.stdout.trim() || ver.stderr.trim()).split('\n')[0] || undefined,
    loggedIn,
    authNote:
      authNote ??
      (loggedIn
        ? 'Auth token or Copilot credential file found'
        : 'If authentication is required, run `copilot login` once from a terminal')
  }
}

export function openCopilotLogin(configured?: string): CopilotLoginResult {
  const { path, found } = resolveCopilotPath(configured)
  if (!found) {
    return {
      ok: false,
      error: 'GitHub Copilot CLI not found. Install it, or set the binary path in agent backend settings.'
    }
  }
  return openCliLoginTerminal('Copilot login', path, ['login'])
}

// ---------- git change snapshot ----------

function gitOutput(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 5000,
      windowsHide: true
    })
  } catch {
    return null
  }
}

const countLines = (s: string): number => (s.length ? s.split('\n').length : 0)

function untrackedLineStat(cwd: string, pathspec: string): FileStat | null {
  const absolute = resolve(cwd, pathspec)
  if (!existsSync(absolute)) return null
  try {
    const info = statSync(absolute)
    if (!info.isFile() || info.size > 1024 * 1024) return null
    const buf = readFileSync(absolute)
    if (buf.subarray(0, 8192).includes(0)) return null
    return { kind: 'add', added: countLines(buf.toString('utf8')), removed: 0 }
  } catch {
    return null
  }
}

function gitDiffSnapshot(cwd: string): Map<string, FileStat> {
  const out = gitOutput(cwd, ['diff', '--numstat', 'HEAD', '--'])
  const files = new Map<string, FileStat>()
  if (out != null) {
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue
      const [addedRaw, removedRaw, pathspec] = line.split('\t')
      const added = Number(addedRaw)
      const removed = Number(removedRaw)
      if (!pathspec || !Number.isFinite(added) || !Number.isFinite(removed)) continue
      files.set(pathspec, { kind: 'update', added, removed })
    }
  }

  const untracked = gitOutput(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  for (const pathspec of untracked?.split('\0').filter(Boolean) ?? []) {
    const stat = untrackedLineStat(cwd, pathspec)
    if (stat) files.set(pathspec, stat)
  }
  return files
}

function changedFiles(before: Map<string, FileStat>, after: Map<string, FileStat>): Array<FileStat & { path: string }> {
  const paths = new Set([...before.keys(), ...after.keys()])
  const changes: Array<FileStat & { path: string }> = []
  for (const path of paths) {
    const prev = before.get(path)
    const next = after.get(path)
    if (!next) {
      changes.push({ path, kind: 'delete', added: 0, removed: prev?.removed || prev?.added || 0 })
      continue
    }
    if (!prev) {
      changes.push({ path, ...next })
      continue
    }
    if (prev.kind !== next.kind || prev.added !== next.added || prev.removed !== next.removed) {
      changes.push({
        path,
        kind: next.kind,
        added: Math.max(0, next.added - prev.added),
        removed: Math.max(0, next.removed - prev.removed)
      })
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

// ---------- run streaming ----------

function killTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      return
    } catch {
      /* fall through */
    }
  }
  try {
    child.kill()
  } catch {
    /* already gone */
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const b = obj(block)
      return str(b.text) || str(b.content) || str(b.value) || str(b.delta)
    })
    .filter(Boolean)
    .join('')
}

function assistantTextFromJson(raw: Record<string, unknown>): string {
  const message = obj(raw.message)
  const result = obj(raw.result)
  const response = obj(raw.response)
  const item = obj(raw.item)
  const payload = obj(raw.payload)
  return (
    str(raw.text) ||
    str(raw.content) ||
    textFromContent(raw.content) ||
    str(raw.output) ||
    str(raw.response) ||
    str(raw.result) ||
    str(message.text) ||
    str(message.content) ||
    textFromContent(message.content) ||
    str(result.text) ||
    str(result.content) ||
    textFromContent(result.content) ||
    str(response.text) ||
    str(response.content) ||
    textFromContent(response.content) ||
    str(item.text) ||
    str(item.content) ||
    textFromContent(item.content) ||
    str(payload.text) ||
    str(payload.content) ||
    textFromContent(payload.content)
  ).trim()
}

function errorTextFromJson(raw: Record<string, unknown>): string {
  const error = raw.error
  if (typeof error === 'string') return error.trim()
  const err = obj(error)
  return (str(err.message) || str(err.detail) || str(raw.message) || str(raw.error_description)).trim()
}

function sessionIdFromJson(raw: Record<string, unknown>): string {
  const session = obj(raw.session)
  const message = obj(raw.message)
  return (
    str(raw.session_id) ||
    str(raw.sessionId) ||
    str(raw.thread_id) ||
    str(raw.threadId) ||
    str(session.id) ||
    str(message.session_id) ||
    str(message.sessionId)
  ).trim()
}

function usageFromJson(raw: Record<string, unknown>): { inputTokens: number; outputTokens: number } | null {
  const usage = obj(raw.usage)
  const input =
    Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0
  const output =
    (Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens ?? 0) ||
      0) + (Number(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens ?? 0) || 0)
  return input || output ? { inputTokens: input, outputTokens: output } : null
}

function copilotArgs(
  params: CopilotRunParams,
  config: {
    copilotModel?: string
    copilotPermission?: CopilotPermissionMode
    copilotReasoning?: CopilotReasoning | ''
  }
): string[] {
  const permission: CopilotPermissionMode = params.permission ?? config.copilotPermission ?? 'workspace'
  const model = (params.model ?? config.copilotModel ?? '').trim()
  const reasoning = params.reasoning ?? config.copilotReasoning ?? ''

  const args = [
    '-p',
    params.prompt,
    '--output-format=json',
    '--stream=off',
    '--silent',
    '--no-color',
    '--no-ask-user',
    '--plain-diff'
  ]
  args.push(`--mode=${permission === 'plan' ? 'plan' : 'autopilot'}`)
  if (params.sessionId) args.push('--session-id', params.sessionId)
  if (model && model !== 'default') args.push(`--model=${model}`)
  if (reasoning) args.push(`--reasoning-effort=${reasoning}`)

  if (permission === 'full') {
    args.push('--allow-all')
  } else {
    args.push(`--add-dir=${params.cwd}`)
    if (permission === 'workspace') args.push('--allow-tool=read,write,shell,edit,create,apply_patch')
    else args.push('--allow-tool=read')
  }
  return args
}

export function runCopilot(
  id: string,
  sender: WebContents,
  params: CopilotRunParams,
  config: {
    copilotPath?: string
    copilotModel?: string
    copilotPermission?: CopilotPermissionMode
    copilotReasoning?: CopilotReasoning | ''
  }
): Promise<CodexRunResult> {
  killRun(id)

  const { path, found } = resolveCopilotPath(config.copilotPath)
  if (!found) {
    return Promise.resolve({
      ok: false,
      error:
        'GitHub Copilot CLI not found. Open connection settings to set the binary path, or install the Copilot CLI.'
    })
  }

  const args = copilotArgs(params, config)
  const before = gitDiffSnapshot(params.cwd)

  const emit = (event: CodexEvent): void => {
    if (!sender.isDestroyed()) sender.send(IPC.copilot.event, { id, event } satisfies CodexEventPayload)
  }

  return new Promise<CodexRunResult>((resolveRun) => {
    let child: ChildProcessWithoutNullStreams
    try {
      // cross-spawn handles the Windows `.bat`/`.cmd` Copilot shim (node's spawn
      // throws EINVAL on it) and escapes the prompt against shell metacharacters.
      child = crossSpawn(path, args, {
        cwd: params.cwd,
        windowsHide: true,
        env: process.env
      }) as ChildProcessWithoutNullStreams
    } catch (err) {
      resolveRun({ ok: false, error: err instanceof Error ? err.message : String(err) })
      return
    }
    try {
      child.stdin.end()
    } catch {
      /* already closed */
    }

    const run: Run = { child, killed: false }
    runs.set(id, run)

    let stdout = ''
    let stdoutBuf = ''
    let stderr = ''
    let stderrBuf = ''
    let sawJson = false
    let sawAssistantText = false
    let threadId = params.sessionId
    let usage: { inputTokens: number; outputTokens: number } | undefined
    emit({ kind: 'turn-started' })
    if (params.sessionId) emit({ kind: 'thread', threadId: params.sessionId })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    const emitAssistant = (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      sawAssistantText = true
      emit({
        kind: 'item',
        phase: 'completed',
        item: {
          id: `msg_${Math.random().toString(36).slice(2)}`,
          type: 'agent_message',
          text: trimmed
        }
      })
    }

    const handleJsonLine = (raw: Record<string, unknown>): void => {
      const sid = sessionIdFromJson(raw)
      if (sid && sid !== threadId) {
        threadId = sid
        emit({ kind: 'thread', threadId: sid })
      }

      // Copilot's JSONL wraps every payload in `data`; the top-level guessers
      // below are the fallback for other/older shapes.
      const data = obj(raw.data)
      const u = usageFromJson(raw)
      const outTokens = Number(data.outputTokens ?? 0) || 0
      if (u || outTokens) {
        usage = {
          inputTokens: (usage?.inputTokens ?? 0) + (u?.inputTokens ?? 0),
          outputTokens: (usage?.outputTokens ?? 0) + (u?.outputTokens ?? 0) + outTokens
        }
      }

      const type = String(raw.type ?? raw.event ?? raw.kind ?? '').toLowerCase()
      const err = errorTextFromJson(raw) || errorTextFromJson(data)
      if (err && (type.includes('error') || raw.error != null || data.error != null)) {
        emit({ kind: 'error', message: err })
        return
      }

      // The finished answer arrives as `assistant.message` with its text under
      // data.content. Ignore streaming *_delta/_start partials, `assistant.reasoning`
      // (also carries data.content), and the echoed `user.message` so only the
      // completed reply becomes a chat bubble.
      if (type === 'assistant.message') {
        emitAssistant(str(data.content) || textFromContent(data.content))
        return
      }
      if (
        type.startsWith('assistant.') ||
        type.startsWith('session.') ||
        type === 'user.message' ||
        type === 'result'
      ) {
        return
      }

      // Fallback for other/older Copilot schemas: the original defensive guesser.
      const text = assistantTextFromJson(raw)
      if (!text) return
      if (
        !type ||
        type.includes('assistant') ||
        type.includes('agent_message') ||
        type.includes('message') ||
        type.includes('response') ||
        type.includes('result') ||
        type.includes('completion')
      ) {
        emitAssistant(text)
      }
    }

    const handleStdoutLine = (line: string): void => {
      if (!line.trim()) return
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        sawJson = true
        handleJsonLine(parsed)
      } catch {
        stdout += `${line}\n`
      }
    }

    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        handleStdoutLine(line)
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      stderrBuf += chunk
      let nl: number
      while ((nl = stderrBuf.indexOf('\n')) >= 0) {
        const line = stderrBuf.slice(0, nl).trim()
        stderrBuf = stderrBuf.slice(nl + 1)
        if (line) emit({ kind: 'notice', text: line })
      }
    })

    child.on('error', (err) => emit({ kind: 'error', message: err.message }))

    child.on('close', (code) => {
      if (runs.get(id) === run) runs.delete(id)
      const stdoutTail = stdoutBuf.trim()
      if (stdoutTail) handleStdoutLine(stdoutTail)
      const tail = stderrBuf.trim()
      if (tail) emit({ kind: 'notice', text: tail })

      const changes = changedFiles(before, gitDiffSnapshot(params.cwd))
      if (changes.length > 0) {
        emit({
          kind: 'item',
          phase: 'completed',
          item: {
            id: `files_${Math.random().toString(36).slice(2)}`,
            type: 'file_change',
            changes
          }
        })
      }

      const finalText = stdout.trim()
      if (finalText && !sawAssistantText) {
        emitAssistant(finalText)
      } else if (code === 0 && !sawAssistantText && changes.length === 0 && !run.killed) {
        const stderrText = stderr.trim()
        emit({
          kind: 'error',
          message: stderrText
            ? `Copilot completed without returning an assistant message.\n\n${stderrText}`
            : sawJson
              ? 'Copilot completed without returning an assistant message.'
              : 'Copilot completed without producing output.'
        })
      }
      emit({ kind: 'turn-completed' })

      if (run.killed) {
        resolveRun({ ok: true, code, threadId, usage, aborted: true })
        return
      }
      if (code === 0) {
        resolveRun({ ok: true, code, threadId, usage })
      } else {
        resolveRun({
          ok: false,
          code,
          threadId,
          usage,
          error: stderr.trim() || stdout.trim() || `copilot exited with code ${code}`
        })
      }
    })

    sender.once('destroyed', () => killRun(id))
  })
}

export function killRun(id: string): void {
  const run = runs.get(id)
  if (!run) return
  run.killed = true
  runs.delete(id)
  killTree(run.child)
}

app.on('before-quit', () => {
  for (const id of [...runs.keys()]) killRun(id)
})
