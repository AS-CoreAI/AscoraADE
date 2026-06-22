import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { Composer } from './Composer'
import { Icon } from './Icon'
import { useApp, type ChatMessage, type ToolStatus } from '@/state/store'
import { lineDiff } from '@/lib/diff'

const TOOL_LABEL: Record<string, string> = {
  list_dir: 'List directory',
  read_file: 'Read file',
  search_files: 'Search',
  write_file: 'Write file',
  edit_file: 'Edit file',
  run_command: 'Run command',
  apply_patch: 'Edit files'
}

function toolIcon(tool?: string): 'terminal' | 'folder' | 'file' | 'search' {
  if (tool === 'run_command') return 'terminal'
  if (tool === 'list_dir') return 'folder'
  if (tool === 'search_files') return 'search'
  return 'file'
}

function toolSummary(m: ChatMessage): string {
  if (m.tool === 'run_command') return String(m.args?.command ?? '')
  if (m.tool === 'search_files') return String(m.args?.query ?? '')
  return String(m.args?.path ?? '')
}

const STATUS_TEXT: Record<ToolStatus, string> = {
  awaiting: 'needs review',
  running: 'running…',
  done: 'done',
  rejected: 'rejected',
  error: 'error'
}

function Diff({ oldText, newText }: { oldText: string; newText: string }): JSX.Element {
  const lines = lineDiff(oldText, newText)
  if (lines.length === 0) return <div className="tool-note">No changes.</div>
  return (
    <pre className="tool-diff">
      {lines.map((l, i) => (
        <div key={i} className={`diff-line ${l.type}`}>
          <span className="diff-gutter">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
          {l.text}
        </div>
      ))}
    </pre>
  )
}

function ToolCard({ m }: { m: ChatMessage }): JSX.Element {
  const approveTool = useApp((s) => s.approveTool)
  const rejectTool = useApp((s) => s.rejectTool)
  const status = m.status ?? 'done'

  return (
    <div className={`tool-card ${status}`}>
      <div className="tool-head">
        <Icon name={toolIcon(m.tool)} size={14} />
        <span className="tool-name">{TOOL_LABEL[m.tool ?? ''] ?? m.tool}</span>
        <code className="tool-arg">{toolSummary(m)}</code>
        <span className="spacer" />
        {m.addedLines || m.removedLines ? (
          <span className="tool-stat">
            {m.addedLines ? <span className="stat-add">+{m.addedLines}</span> : null}
            {m.removedLines ? <span className="stat-del">-{m.removedLines}</span> : null}
          </span>
        ) : null}
        <span className={`tool-status ${status}`}>{STATUS_TEXT[status]}</span>
      </div>

      {(m.tool === 'write_file' || m.tool === 'edit_file') &&
        (status === 'awaiting' || status === 'running' || status === 'done') && (
          <Diff oldText={m.oldContent ?? ''} newText={m.newContent ?? ''} />
        )}

      {m.tool === 'run_command' && (m.output?.trim() || m.stderr?.trim()) && (
        <pre className="tool-output">
          {m.output}
          {m.stderr?.trim() ? <span className="tool-stderr">{m.output ? '\n' : ''}{m.stderr}</span> : null}
          {typeof m.exitCode === 'number' && m.exitCode !== 0 ? (
            <span className="tool-stderr">{`\n[exit ${m.exitCode}]`}</span>
          ) : null}
        </pre>
      )}

      {m.tool === 'search_files' && status === 'done' && m.output && (
        <pre className="tool-output">{m.output}</pre>
      )}

      {(m.tool === 'list_dir' || m.tool === 'read_file') && m.output && status === 'done' && (
        <div className="tool-note">{m.output}</div>
      )}

      {m.tool === 'apply_patch' && m.output && <pre className="tool-output">{m.output}</pre>}

      {status === 'error' && m.error && <div className="tool-error">{m.error}</div>}

      {status === 'awaiting' && (
        <div className="tool-actions">
          <button className="tool-approve" onClick={() => approveTool(m.id)}>
            <Icon name="check" size={14} /> Approve
          </button>
          <button className="tool-reject" onClick={() => rejectTool(m.id)}>
            <Icon name="x" size={14} /> Reject
          </button>
        </div>
      )}
    </div>
  )
}

function ReasoningBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`reasoning-block${open ? ' open' : ''}`}>
      <button className="reasoning-head" onClick={() => setOpen((o) => !o)}>
        <Icon name="sparkles" size={13} />
        <span>Thought process</span>
        <span className="spacer" />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  )
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Electron normally exposes the Clipboard API; keep a fallback for older builds.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard write failed')
}

function TextMessage({ m }: { m: ChatMessage }): JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const resetTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    []
  )

  const copy = async (): Promise<void> => {
    if (!m.text) return
    try {
      await copyText(m.text)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 1800)
  }

  return (
    <div className={`msg ${m.role}`}>
      <div className="msg-head">
        <span className="role" title={m.role === 'assistant' ? m.model || undefined : undefined}>
          {m.role === 'user' ? 'You' : m.model || 'Assistant'}
        </span>
        {m.role === 'assistant' && (
          <button
            type="button"
            className={`msg-copy ${copyState}`}
            onClick={() => void copy()}
            disabled={!m.text}
            title={copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy response'}
            aria-label="Copy assistant response"
          >
            <Icon name={copyState === 'copied' ? 'check' : 'copy'} size={12} />
            <span>{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Failed' : 'Copy'}</span>
          </button>
        )}
      </div>
      <div className="bubble">{m.text}</div>
    </div>
  )
}

function Messages({ messages }: { messages: ChatMessage[] }): JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        Describe a task and the agent will read and edit files and run commands in your project.
        In “Ask before changes” mode it shows a diff and waits for your approval; switch to
        “Auto-apply” to let it work uninterrupted.
      </div>
    )
  }
  return (
    <>
      {messages.map((m) =>
        m.kind === 'tool' ? (
          <ToolCard key={m.id} m={m} />
        ) : m.reasoning ? (
          <ReasoningBlock key={m.id} text={m.text} />
        ) : (
          <TextMessage key={m.id} m={m} />
        )
      )}
    </>
  )
}

/** Compact token count: 942 → "942", 1240 → "1.2k", 23000 → "23k". */
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`
}

/** Blinking "Thinking… (N tokens · Ms)" badge shown while a model turn generates. */
function ThinkingIndicator(): JSX.Element | null {
  const thinking = useApp((s) => s.thinking)
  const tokens = useApp((s) => s.thinkingTokens)
  const startedAt = useApp((s) => s.thinkingStartedAt)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!thinking || startedAt == null) return
    const tick = (): void => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [thinking, startedAt])

  if (!thinking) return null
  return (
    <div className="thinking" aria-live="polite">
      <span className="thinking-dot" />
      <span className="thinking-label">Thinking…</span>
      <span className="thinking-meta">
        {formatTokenCount(tokens)} tokens{elapsed > 0 ? ` · ${elapsed}s` : ''}
      </span>
    </div>
  )
}

type ChangeKind = 'add' | 'modify' | 'delete'

/** Normalize a backend's change verb (codex/claude/glm use add|update|delete|edit). */
function normChangeKind(raw: string): ChangeKind {
  const k = raw.trim().toLowerCase()
  if (k === 'add' || k === 'added' || k === 'create' || k === 'created' || k === 'new' || k === 'a')
    return 'add'
  if (k === 'delete' || k === 'deleted' || k === 'remove' || k === 'removed' || k === 'd')
    return 'delete'
  return 'modify'
}

/** Merge repeated touches of one file: a delete wins; a file born in this branch stays "add". */
function mergeChangeKind(prev: ChangeKind | undefined, next: ChangeKind): ChangeKind {
  if (next === 'delete') return 'delete'
  if (prev === 'add') return 'add'
  return next
}

/**
 * Tally the distinct files touched across the whole task branch (every prompt's
 * messages), deduped by path. Works for the local loop (write_file/edit_file)
 * and the CLI backends (apply_patch cards, whose `output` lists "kind name").
 */
function countChanges(messages: ChatMessage[]): {
  added: number
  modified: number
  removed: number
} {
  const files = new Map<string, ChangeKind>()
  const note = (key: string, kind: ChangeKind): void => {
    const path = key.trim()
    if (path) files.set(path, mergeChangeKind(files.get(path), kind))
  }
  for (const m of messages) {
    if (m.kind !== 'tool' || m.status !== 'done') continue
    if (m.tool === 'write_file') note(String(m.args?.path ?? ''), m.created ? 'add' : 'modify')
    else if (m.tool === 'edit_file') note(String(m.args?.path ?? ''), 'modify')
    else if (m.tool === 'apply_patch' && m.output) {
      for (const line of m.output.split('\n')) {
        const t = line.trim()
        const sp = t.indexOf(' ')
        if (sp > 0) note(t.slice(sp + 1), normChangeKind(t.slice(0, sp)))
      }
    }
  }
  let added = 0
  let modified = 0
  let removed = 0
  for (const kind of files.values()) {
    if (kind === 'add') added += 1
    else if (kind === 'delete') removed += 1
    else modified += 1
  }
  return { added, modified, removed }
}

/** Sum the added/removed *lines* across every applied edit in this task branch. */
function countLines(messages: ChatMessage[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const m of messages) {
    if (m.kind !== 'tool' || m.status !== 'done') continue
    if (m.tool === 'write_file' || m.tool === 'edit_file' || m.tool === 'apply_patch') {
      added += m.addedLines ?? 0
      removed += m.removedLines ?? 0
    }
  }
  return { added, removed }
}

/**
 * "N files +A -R" pill summarising what the agent changed in this task branch:
 * the file count plus added/removed line totals (lines shown only when known —
 * shell/PowerShell edits carry no line counts). Hidden until something changed.
 */
function ChangesBadge({ floating = false }: { floating?: boolean }): JSX.Element | null {
  const messages = useApp((s) => s.messages)
  const files = countChanges(messages)
  const lines = countLines(messages)
  const fileCount = files.added + files.modified + files.removed
  if (fileCount === 0) return null
  const hasLines = lines.added > 0 || lines.removed > 0
  return (
    <div
      className={`changes-badge${floating ? ' floating' : ''}`}
      title={`${files.added} added · ${files.modified} modified · ${files.removed} removed`}
    >
      <Icon name="file" size={12} />
      <span className="changes-label">
        {fileCount} file{fileCount === 1 ? '' : 's'}
      </span>
      {hasLines && (
        <>
          <span className="changes-add">+{lines.added}</span>
          <span className="changes-del">-{lines.removed}</span>
        </>
      )}
    </div>
  )
}

export function AgentChat({ full = false }: { full?: boolean }): JSX.Element {
  const messages = useApp((s) => s.messages)
  const thinking = useApp((s) => s.thinking)
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [messages, thinking])

  if (full) {
    return (
      <div className="chat-full">
        <ChangesBadge floating />
        <div className="chat-full-scroll" ref={scrollRef}>
          <div className="chat-col chat-messages-col">
            <Messages messages={messages} />
            <ThinkingIndicator />
          </div>
        </div>
        <div className="chat-full-composer">
          <div className="chat-col">
            <Composer showFolder={false} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel panel-side">
      <div className="panel-header">
        <Icon name="message" size={13} />
        Agent
        <span className="spacer" />
        <ChangesBadge />
      </div>

      <div className="chat">
        <div className="chat-messages" ref={scrollRef}>
          <Messages messages={messages} />
          <ThinkingIndicator />
        </div>
        <div className="chat-composer">
          <Composer showFolder={false} />
        </div>
      </div>
    </div>
  )
}
