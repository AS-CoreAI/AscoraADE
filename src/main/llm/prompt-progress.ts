import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { PromptProgress } from '@shared/ipc'

const MAX_READ = 64 * 1024
const MAX_LINE = 4096
const activeModels = new Map<string, Set<() => void>>()

/** The compatible chat API has no progress events. Observe only new local
 * server log lines, never prompt contents or old percentages. Log percentages
 * describe a model, not a request ID; suppress them on ambiguous overlaps. */
export class PromptProgressParser {
  private started = false
  private ambiguous = false
  private last = -1

  constructor(private model: string, private messageCount: number, private emit: (progress: PromptProgress) => void) {}

  invalidate(): void {
    if (this.ambiguous) return
    this.ambiguous = true
    this.emit({ phase: 'waiting' })
  }

  push(line: string): void {
    if (this.ambiguous || line.length > MAX_LINE) return
    const record = /^\[[^\]]+\]\[(?:INFO|DEBUG)\]\[([^\]]+)\]\s+(.*)$/.exec(line)
    if (!record || record[1] !== this.model) return
    const message = record[2]
    const start = /^Running chat completion on conversation with (\d+) messages\.$/.exec(message)
    if (start) {
      if (this.started || Number(start[1]) !== this.messageCount) { this.invalidate(); return }
      this.started = true
      return
    }
    if (!this.started) return
    const match = /^Prompt processing progress: (\d+(?:\.\d+)?)%$/.exec(message)
    if (!match) return
    const percent = Number(match[1])
    if (!Number.isFinite(percent) || percent < this.last || percent > 100 || percent === this.last) return
    this.last = percent
    this.emit({ phase: 'processing', percent, source: 'lmstudio-log' })
  }
}

function isLoopback(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch { return false }
}

async function latestLog(root: string): Promise<string | null> {
  const months = (await readdir(root)).filter(name => /^\d{4}-\d{2}$/.test(name)).sort().slice(-2)
  const candidates: { path: string; modified: number }[] = []
  for (const month of months) {
    const directory = join(root, month)
    const names = (await readdir(directory)).filter(name => /^\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(name))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).slice(-4)
    for (const name of names) {
      const path = join(directory, name)
      const info = await stat(path)
      if (info.isFile()) candidates.push({ path, modified: info.mtimeMs })
    }
  }
  return candidates.sort((a, b) => b.modified - a.modified)[0]?.path ?? null
}

export async function watchPromptProgress(
  baseUrl: string, model: string, messageCount: number,
  signal: AbortSignal, emit: (progress: PromptProgress) => void
): Promise<() => void> {
  if (!isLoopback(baseUrl) || signal.aborted || !model) return () => {}
  const root = join(homedir(), '.lmstudio', 'server-logs')
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let path: string | null = null
  let offset = 0
  let pending = ''
  let decoder = new StringDecoder('utf8')
  const parser = new PromptProgressParser(model, messageCount, progress => { if (!stopped) emit(progress) })
  const invalidate = (): void => parser.invalidate()
  // All loopback aliases reach the same local log; two Ascora requests for
  // this model cannot safely claim the shared percentages, even on other ports.
  const observers = activeModels.get(model) ?? new Set<() => void>()
  observers.add(invalidate)
  activeModels.set(model, observers)
  if (observers.size > 1) for (const observer of observers) observer()
  const stop = (): void => {
    stopped = true
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    observers.delete(invalidate)
    if (observers.size === 0) activeModels.delete(model)
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    path = await latestLog(root)
    if (path) offset = (await stat(path)).size
  } catch { /* Logs may not exist yet. Waiting is still useful without a percentage. */ }
  if (signal.aborted) { stop(); return stop }

  const poll = async (): Promise<void> => {
    try {
      const next = await latestLog(root)
      if (stopped || !next) return
      const handle = await open(next, 'r')
      try {
        const info = await handle.stat()
        if (next !== path || info.size < offset) {
          // Rotation/truncation loses request attribution; do not show stale data.
          parser.invalidate()
          path = next; offset = info.size; pending = ''; decoder = new StringDecoder('utf8')
          return
        }
        const count = info.size - offset
        if (count <= 0) return
        if (count > MAX_READ) { parser.invalidate(); offset = info.size; pending = ''; return }
        const buffer = Buffer.alloc(count)
        const { bytesRead } = await handle.read(buffer, 0, count, offset)
        offset += bytesRead
        if (stopped) return
        pending += decoder.write(buffer.subarray(0, bytesRead))
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) {
          parser.push(pending.slice(0, end).replace(/\r$/, ''))
          pending = pending.slice(end + 1)
        }
        if (pending.length > MAX_LINE) { parser.invalidate(); pending = '' }
      } finally { await handle.close() }
    } catch { parser.invalidate() /* Diagnostics must never break generation. */ }
    finally { if (!stopped) { timer = setTimeout(() => void poll(), 500); timer.unref() } }
  }
  if (!stopped) { timer = setTimeout(() => void poll(), 500); timer.unref() }
  return stop
}
