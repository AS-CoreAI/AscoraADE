import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { GitBranch, GitStatusResult } from '@shared/ipc'
import { Composer } from './Composer'
import { Icon } from './Icon'
import { useApp, type ChatMessage, type ToolStatus } from '@/state/store'
import { lineDiff } from '@/lib/diff'
import { api } from '@/lib/api'

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

function isCopilotAuthError(m: ChatMessage): boolean {
  if (m.role !== 'assistant') return false
  const haystack = `${m.model ?? ''}\n${m.text}`
  return (
    /copilot/i.test(haystack) &&
    /(No authentication information found|Authentication token found but could not be validated|Bad credentials|copilot login|gh auth login|COPILOT_GITHUB_TOKEN|GH_TOKEN|GITHUB_TOKEN)/i.test(
      m.text
    )
  )
}

function TextMessage({ m }: { m: ChatMessage }): JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const resetTimer = useRef<number | null>(null)
  const setCopilotAuthOpen = useApp((s) => s.setCopilotAuthOpen)
  const showCopilotAuth = isCopilotAuthError(m)

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
      {showCopilotAuth && (
        <div className="msg-actions">
          <button type="button" className="msg-action" onClick={() => setCopilotAuthOpen(true)}>
            <Icon name="terminal" size={13} />
            Authorize Copilot
          </button>
        </div>
      )}
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

interface ChangeFileSummary {
  path: string
  kind: ChangeKind
  added: number
  removed: number
  hasLineCounts: boolean
}

interface ChangesSummary {
  added: number
  modified: number
  removed: number
  lineAdded: number
  lineRemoved: number
  files: ChangeFileSummary[]
}

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
 * Tally the distinct files touched across the whole task branch, deduped by
 * path. Uses structured `changes` when available and falls back to older
 * apply_patch text so saved tasks still render.
 */
function summarizeChanges(messages: ChatMessage[]): ChangesSummary {
  const files = new Map<string, ChangeFileSummary>()
  const note = (key: string, kind: ChangeKind, added?: number, removed?: number): void => {
    const path = key.trim()
    if (!path) return
    const prev = files.get(path)
    files.set(path, {
      path,
      kind: mergeChangeKind(prev?.kind, kind),
      added: (prev?.added ?? 0) + (added ?? 0),
      removed: (prev?.removed ?? 0) + (removed ?? 0),
      hasLineCounts: Boolean(prev?.hasLineCounts || added != null || removed != null)
    })
  }
  for (const m of messages) {
    if (m.kind !== 'tool' || m.status !== 'done') continue
    if (m.changes?.length) {
      for (const change of m.changes) {
        const singleFile = m.changes.length === 1
        note(
          change.path,
          normChangeKind(change.kind),
          change.added ?? (singleFile ? m.addedLines : undefined),
          change.removed ?? (singleFile ? m.removedLines : undefined)
        )
      }
    } else if (m.tool === 'write_file') {
      note(String(m.args?.path ?? ''), m.created ? 'add' : 'modify', m.addedLines, m.removedLines)
    } else if (m.tool === 'edit_file') {
      note(String(m.args?.path ?? ''), 'modify', m.addedLines, m.removedLines)
    } else if (m.tool === 'apply_patch' && m.output) {
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
  let lineAdded = 0
  let lineRemoved = 0
  for (const file of files.values()) {
    if (file.kind === 'add') added += 1
    else if (file.kind === 'delete') removed += 1
    else modified += 1
    lineAdded += file.added
    lineRemoved += file.removed
  }
  return {
    added,
    modified,
    removed,
    lineAdded,
    lineRemoved,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
  }
}

function changeKindLabel(kind: ChangeKind): string {
  if (kind === 'add') return 'Created'
  if (kind === 'delete') return 'Removed'
  return 'Edited'
}

/**
 * "N files +A -R" pill summarising what the agent changed in this task branch:
 * the file count plus added/removed line totals (lines shown only when known —
 * shell/PowerShell edits carry no line counts). Hidden until something changed.
 */
function ChangesBadge({ floating = false }: { floating?: boolean }): JSX.Element | null {
  const messages = useApp((s) => s.messages)
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const summary = summarizeChanges(messages)
  const fileCount = summary.added + summary.modified + summary.removed

  useEffect(() => {
    if (fileCount === 0 && open) setOpen(false)
  }, [fileCount, open])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (fileCount === 0) return null
  return (
    <div className={`changes-popover-root${floating ? ' floating' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`changes-badge${floating ? ' floating' : ''}`}
        aria-expanded={open}
        title={`${summary.added} added, ${summary.modified} modified, ${summary.removed} removed`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="file" size={12} />
        <span className="changes-label">
          {fileCount} file{fileCount === 1 ? '' : 's'}
        </span>
        <span className="changes-add">+{summary.lineAdded}</span>
        <span className="changes-del">-{summary.lineRemoved}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
      </button>

      {open && (
        <div className="changes-popover" role="dialog" aria-label="Changed files">
          <div className="changes-popover-head">
            <strong>
              {fileCount} changed file{fileCount === 1 ? '' : 's'}
            </strong>
            <span>
              {summary.added} created, {summary.modified} edited, {summary.removed} removed
            </span>
          </div>

          <div className="changes-file-list">
            {summary.files.map((file) => (
              <div className="changes-file-row" key={file.path} title={file.path}>
                <span className={`changes-kind ${file.kind}`}>{changeKindLabel(file.kind)}</span>
                <span className="changes-file-path">{file.path}</span>
                <span className="changes-file-stat">
                  <span className="changes-add">+{file.hasLineCounts ? file.added : '?'}</span>
                  <span className="changes-del">-{file.hasLineCounts ? file.removed : '?'}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function cleanCommitMessage(text: string): string {
  return text
    .replace(/```[a-z]*|```/gi, '')
    .split('\n')
    .map((line) => line.replace(/^["'`]|["'`]$/g, '').trimEnd())
    .join('\n')
    .trim()
}

function sameProjectPath(left: string | undefined, right: string): boolean {
  if (!left) return false
  const normalize = (path: string): string => {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return api.system.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  return normalize(left) === normalize(right)
}

function GitBranchBadge(): JSX.Element | null {
  const activePath = useApp((s) => s.active?.path)
  const provider = useApp((s) => s.provider)
  const model = useApp((s) => s.model)
  const openRouterModel = useApp((s) => s.openRouterModel)
  const rootRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(
    async (fetchRemote = false): Promise<void> => {
      if (!activePath) {
        setStatus(null)
        setBranches([])
        return
      }
      setLoading(true)
      try {
        let remoteError: string | null = null
        if (fetchRemote) {
          const before = await api.git.status(activePath)
          if (before.ok && before.upstream) {
            const fetched = await api.git.fetch(activePath)
            if (!fetched.ok) remoteError = fetched.error ?? 'Failed to fetch remote changes.'
          }
        }
        const nextStatus = await api.git.status(activePath)
        const isProjectRepository = nextStatus.ok && sameProjectPath(nextStatus.root, activePath)
        setStatus(isProjectRepository ? nextStatus : null)
        if (!isProjectRepository) {
          setBranches([])
          setError(null)
          return
        }
        try {
          const nextBranches = await api.git.branches(activePath)
          setBranches(nextBranches.ok ? nextBranches.branches ?? [] : [])
          if (!nextBranches.ok && nextStatus.ok) {
            remoteError = nextBranches.error ?? 'Failed to read Git branches.'
          }
        } catch (err) {
          setBranches([])
          if (nextStatus.ok) {
            remoteError = err instanceof Error ? err.message : 'Failed to read Git branches.'
          }
        }
        setError(remoteError ?? (nextStatus.ok ? null : nextStatus.error ?? 'Failed to read Git status.'))
      } catch {
        setStatus(null)
        setBranches([])
      } finally {
        setLoading(false)
      }
    },
    [activePath]
  )

  useEffect(() => {
    setOpen(false)
    setError(null)
    setNotice(null)
    void refresh(false)
  }, [refresh])

  useEffect(() => {
    if (!open) return
    void refresh(true)
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, refresh])

  const runGitAction = async (
    name: string,
    action: () => Promise<{ ok: boolean; error?: string; output?: string }>,
    successMessage: string
  ): Promise<void> => {
    setBusy(name)
    setError(null)
    setNotice(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error ?? 'Git command failed.')
        return
      }
      setNotice(successMessage)
      await refresh(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Git command failed.')
    } finally {
      setBusy(null)
    }
  }

  const switchBranch = (branch: string): void => {
    if (!activePath || branch === status?.branch) return
    void runGitAction(
      'switch',
      () => api.git.checkout(activePath, branch),
      `Switched to ${branch}.`
    )
  }

  const pull = (): void => {
    if (!activePath) return
    void runGitAction('pull', () => api.git.pull(activePath), 'Branch updated.')
  }

  const push = (): void => {
    if (!activePath) return
    void runGitAction('push', () => api.git.push(activePath), 'Commits pushed.')
  }

  const aiCommitAndPush = async (): Promise<void> => {
    if (!activePath || busy) return
    setBusy('ai')
    setError(null)
    setNotice(null)
    try {
      const staged = await api.git.stage(activePath)
      if (!staged.ok) throw new Error(staged.error ?? 'Failed to stage changes.')

      const diffResult = await api.git.diff(activePath, { staged: true })
      if (!diffResult.ok) throw new Error(diffResult.error ?? 'Failed to read staged diff.')
      const diff = (diffResult.diff ?? '').trim()
      if (!diff) throw new Error('There are no changes to commit.')

      const result = await api.llm.chat(
        crypto.randomUUID(),
        {
          model: provider === 'openrouter' ? openRouterModel : model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: 'Write concise Git commit messages. Return only the commit message, without markdown.'
            },
            {
              role: 'user',
              content:
                'Create a concise commit message for this staged diff. Use imperative mood and keep the subject under 72 characters.\n\n' +
                diff.slice(0, 12_000)
            }
          ]
        },
        () => undefined
      )
      if (!result.ok) throw new Error(result.error ?? 'Failed to generate a commit message.')
      const message = cleanCommitMessage(result.content)
      if (!message) throw new Error('AI returned an empty commit message.')

      const committed = await api.git.commit(activePath, message)
      if (!committed.ok) throw new Error(committed.error ?? 'Failed to create commit.')
      const pushed = await api.git.push(activePath)
      if (!pushed.ok) {
        throw new Error(`Commit created as "${message}", but push failed: ${pushed.error ?? 'unknown error'}`)
      }
      setNotice(`Committed and pushed: ${message}`)
      await refresh(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI commit failed.'
      await refresh(false)
      setError(message)
    } finally {
      setBusy(null)
    }
  }

  if (!activePath || !status?.ok || !sameProjectPath(status.root, activePath)) return null

  const fileCount = status.files?.length ?? 0
  const ahead = status.ahead ?? 0
  const behind = status.behind ?? 0
  const hasPushTarget = Boolean(status.pushTarget)
  const canPush = hasPushTarget && (ahead > 0 || !status.upstream)
  const disabled = loading || busy !== null

  return (
    <div className="git-branch-floating" ref={rootRef}>
      <button
        type="button"
        className="changes-badge git-branch-badge"
        aria-expanded={open}
        title="Git branch and repository actions"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="gitBranch" size={12} />
        <span>{status.branch || 'HEAD'}</span>
        {behind > 0 && <span className="git-behind">↓{behind}</span>}
        {ahead > 0 && <span className="git-ahead">↑{ahead}</span>}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
      </button>

      {open && (
        <div className="git-quick-popover" role="dialog" aria-label="Git actions">
          <div className="git-quick-head">
            <div>
              <strong>{status.branch || 'HEAD'}</strong>
              <span>
                {status.pushTarget ? `Push target: ${status.pushTarget}` : 'No push remote configured'}
              </span>
            </div>
            <button
              type="button"
              className="git-quick-icon"
              title="Fetch and refresh"
              disabled={disabled}
              onClick={() => void refresh(true)}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>

          <label className="git-quick-field">
            <span>Branch</span>
            <select
              value={status.branch || ''}
              disabled={disabled || branches.length === 0}
              onChange={(event) => switchBranch(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}{branch.current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="git-quick-state">
            <span>{fileCount} changed</span>
            <span>{behind} incoming</span>
            <span>{ahead} outgoing</span>
          </div>

          <div className="git-quick-actions">
            <button type="button" disabled={disabled || behind === 0} onClick={pull}>
              {busy === 'pull' ? 'Pulling…' : `Pull${behind ? ` (${behind})` : ''}`}
            </button>
            <button type="button" disabled={disabled || !canPush} onClick={push}>
              {busy === 'push' ? 'Pushing…' : `Push${ahead ? ` (${ahead})` : ''}`}
            </button>
          </div>
          <button
            type="button"
            className="git-ai-push"
            disabled={disabled || fileCount === 0 || !hasPushTarget}
            onClick={() => void aiCommitAndPush()}
          >
            <Icon name="sparkles" size={14} />
            {busy === 'ai' ? 'Creating AI commit…' : 'AI commit & push'}
          </button>

          {loading && <div className="git-quick-message">Checking remote…</div>}
          {notice && <div className="git-quick-message success">{notice}</div>}
          {error && <div className="git-quick-message error">{error}</div>}
        </div>
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
        <GitBranchBadge />
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
