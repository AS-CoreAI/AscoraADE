import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { GitBranch, GitStatusResult } from '@shared/ipc'
import { Composer } from './Composer'
import { FileIcon } from './FileIcon'
import { Icon } from './Icon'
import { useApp, type ChatMessage, type ToolStatus } from '@/state/store'
import { lineDiff } from '@/lib/diff'
import { api } from '@/lib/api'
import { tr, type TranslationKey } from '@/language'

const TOOL_LABEL_KEY: Record<string, TranslationKey> = {
  list_dir: 'chat.tool.listDir',
  read_file: 'chat.tool.readFile',
  search_files: 'chat.tool.search',
  write_file: 'chat.tool.writeFile',
  edit_file: 'chat.tool.editFile',
  run_command: 'chat.tool.runCommand',
  apply_patch: 'chat.tool.editFiles',
  web_fetch: 'chat.tool.webFetch',
  web_search: 'chat.tool.webSearch'
}

function toolIcon(tool?: string): 'terminal' | 'folder' | 'file' | 'search' | 'globe' {
  if (tool === 'run_command') return 'terminal'
  if (tool === 'list_dir') return 'folder'
  if (tool === 'search_files' || tool === 'web_search') return 'search'
  if (tool === 'web_fetch') return 'globe'
  return 'file'
}

function toolSummary(m: ChatMessage): string {
  if (m.tool === 'run_command') return String(m.args?.command ?? '')
  if (m.tool === 'search_files' || m.tool === 'web_search') return String(m.args?.query ?? '')
  if (m.tool === 'web_fetch') return String(m.args?.url ?? '')
  return String(m.args?.path ?? '')
}

const STATUS_TEXT_KEY: Record<ToolStatus, TranslationKey> = {
  awaiting: 'chat.status.awaiting',
  running: 'chat.status.running',
  done: 'chat.status.done',
  rejected: 'chat.status.rejected',
  error: 'chat.status.error'
}

function Diff({ oldText, newText }: { oldText: string; newText: string }): JSX.Element {
  const appLanguage = useApp((s) => s.appLanguage)
  const lines = lineDiff(oldText, newText)
  if (lines.length === 0) return <div className="tool-note">{tr(appLanguage, 'chat.noChanges')}</div>
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
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const status = m.status ?? 'done'
  const toolLabelKey = TOOL_LABEL_KEY[m.tool ?? '']

  return (
    <div className={`tool-card ${status}`}>
      <div className="tool-head">
        <Icon name={toolIcon(m.tool)} size={14} />
        <span className="tool-name">{toolLabelKey ? t(toolLabelKey) : m.tool}</span>
        <code className="tool-arg">{toolSummary(m)}</code>
        <span className="spacer" />
        {m.addedLines || m.removedLines ? (
          <span className="tool-stat">
            {m.addedLines ? <span className="stat-add">+{m.addedLines}</span> : null}
            {m.removedLines ? <span className="stat-del">-{m.removedLines}</span> : null}
          </span>
        ) : null}
        <span className={`tool-status ${status}`}>{t(STATUS_TEXT_KEY[status])}</span>
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

      {(m.tool === 'search_files' || m.tool === 'web_search' || m.tool === 'web_fetch') &&
        status === 'done' &&
        m.output && <pre className="tool-output">{m.output}</pre>}

      {(m.tool === 'list_dir' || m.tool === 'read_file') && m.output && status === 'done' && (
        <div className="tool-note">{m.output}</div>
      )}

      {m.tool === 'apply_patch' && m.output && <pre className="tool-output">{m.output}</pre>}

      {status === 'error' && m.error && <div className="tool-error">{m.error}</div>}

      {status === 'awaiting' && (
        <div className="tool-actions">
          <button className="tool-approve" onClick={() => approveTool(m.id)}>
            <Icon name="check" size={14} /> {t('chat.approve')}
          </button>
          <button className="tool-reject" onClick={() => rejectTool(m.id)}>
            <Icon name="x" size={14} /> {t('chat.reject')}
          </button>
        </div>
      )}
    </div>
  )
}

function ReasoningBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const appLanguage = useApp((s) => s.appLanguage)
  return (
    <div className={`reasoning-block${open ? ' open' : ''}`}>
      <button className="reasoning-head" onClick={() => setOpen((o) => !o)}>
        <Icon name="sparkles" size={13} />
        <span>{tr(appLanguage, 'chat.thoughtProcess')}</span>
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
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const showCopilotAuth = isCopilotAuthError(m)
  const attachments = m.role === 'user' ? (m.attachments ?? []) : []

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
          {m.role === 'user' ? t('chat.you') : m.model || t('chat.assistant')}
        </span>
        {m.role === 'assistant' && (
          <button
            type="button"
            className={`msg-copy ${copyState}`}
            onClick={() => void copy()}
            disabled={!m.text}
            title={copyState === 'copied' ? t('common.copied') : copyState === 'error' ? t('common.copyFailed') : t('chat.copyResponse')}
            aria-label={t('chat.copyAssistantResponse')}
          >
            <Icon name={copyState === 'copied' ? 'check' : 'copy'} size={12} />
            <span>{copyState === 'copied' ? t('common.copied') : copyState === 'error' ? t('common.failed') : t('common.copy')}</span>
          </button>
        )}
      </div>
      {(m.text || attachments.length > 0) && (
        <div className={`bubble${attachments.length > 0 ? ' has-attachments' : ''}`}>
          {attachments.length > 0 && (
            <div className={`msg-attachments${m.text ? ' has-text' : ''}`} role="list">
              {attachments.map((attachment, index) => (
                <div
                  key={`${attachment.name}-${index}`}
                  className={`msg-attachment ${attachment.previewDataUrl ? 'image' : 'file'}`}
                  role="listitem"
                  title={attachment.name}
                >
                  {attachment.previewDataUrl ? (
                    <img src={attachment.previewDataUrl} alt={attachment.name} draggable={false} />
                  ) : (
                    <>
                      <FileIcon name={attachment.name} size={17} />
                      <span>{attachment.name}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {m.text && <span className="msg-text">{m.text}</span>}
        </div>
      )}
      {showCopilotAuth && (
        <div className="msg-actions">
          <button type="button" className="msg-action" onClick={() => setCopilotAuthOpen(true)}>
            <Icon name="terminal" size={13} />
            {t('chat.authorizeCopilot')}
          </button>
        </div>
      )}
    </div>
  )
}

function Messages({ messages }: { messages: ChatMessage[] }): JSX.Element {
  const appLanguage = useApp((s) => s.appLanguage)
  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        {tr(appLanguage, 'chat.empty')}
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

/**
 * VS Code / Copilot–style whimsical progress verbs cycled while a Claude turn
 * generates, in place of the static "Thinking…" label.
 */
const CLAUDE_STATUS_VERBS = [
  'Unfurling',
  'Puzzling',
  'Incubating',
  'Mulling',
  'Tinkering',
  'Crafting',
  'Pondering',
  'Ruminating',
  'Percolating',
  'Noodling',
  'Cogitating',
  'Marinating',
  'Simmering',
  'Brewing',
  'Conjuring',
  'Synthesizing',
  'Wrangling',
  'Finagling',
  'Spelunking',
  'Deliberating',
  'Contemplating',
  'Formulating',
  'Reticulating',
  'Distilling'
] as const

const pickStatusVerb = (): string =>
  CLAUDE_STATUS_VERBS[Math.floor(Math.random() * CLAUDE_STATUS_VERBS.length)]

/** Blinking "Thinking… (N tokens · Ms)" badge shown while a model turn generates. */
function ThinkingIndicator(): JSX.Element | null {
  const thinking = useApp((s) => s.thinking)
  const tokens = useApp((s) => s.thinkingTokens)
  const startedAt = useApp((s) => s.thinkingStartedAt)
  const provider = useApp((s) => s.provider)
  const appLanguage = useApp((s) => s.appLanguage)
  const [elapsed, setElapsed] = useState(0)
  const [verb, setVerb] = useState(pickStatusVerb)

  useEffect(() => {
    if (!thinking || startedAt == null) return
    const tick = (): void => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [thinking, startedAt])

  // Rotate through VS Code–style status verbs while Claude is generating.
  useEffect(() => {
    if (!thinking || provider !== 'claude') return
    setVerb(pickStatusVerb())
    const timer = window.setInterval(() => setVerb(pickStatusVerb()), 3000)
    return () => window.clearInterval(timer)
  }, [thinking, provider])

  if (!thinking) return null
  const label = provider === 'claude' && appLanguage === 'en' ? `${verb}…` : tr(appLanguage, 'chat.thinking')
  return (
    <div className="thinking" aria-live="polite">
      <span className="thinking-dot" />
      <span className="thinking-label">{label}</span>
      <span className="thinking-meta">
        {formatTokenCount(tokens)} {tr(appLanguage, 'common.tokens')}{elapsed > 0 ? ` · ${elapsed}s` : ''}
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

function changeKindLabel(kind: ChangeKind, language: Parameters<typeof tr>[0]): string {
  if (kind === 'add') return tr(language, 'chat.created')
  if (kind === 'delete') return tr(language, 'chat.removedLabel')
  return tr(language, 'chat.edited')
}

/**
 * "N files +A -R" pill summarising what the agent changed in this task branch:
 * the file count plus added/removed line totals (lines shown only when known —
 * shell/PowerShell edits carry no line counts). Hidden until something changed.
 */
function ChangesBadge({ floating = false }: { floating?: boolean }): JSX.Element | null {
  const messages = useApp((s) => s.messages)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
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
        title={`${summary.added} ${t('chat.added')}, ${summary.modified} ${t('chat.modified')}, ${summary.removed} ${t('chat.removed')}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="file" size={12} />
        <span className="changes-label">
          {fileCount} {fileCount === 1 ? t('chat.file') : t('chat.files')}
        </span>
        <span className="changes-add">+{summary.lineAdded}</span>
        <span className="changes-del">-{summary.lineRemoved}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
      </button>

      {open && (
        <div className="changes-popover" role="dialog" aria-label={t('chat.changedFiles')}>
          <div className="changes-popover-head">
            <strong>
              {fileCount} {t('chat.changed')} {fileCount === 1 ? t('chat.file') : t('chat.files')}
            </strong>
            <span>
              {summary.added} {t('chat.createdLower')}, {summary.modified} {t('chat.editedLower')}, {summary.removed} {t('chat.removed')}
            </span>
          </div>

          <div className="changes-file-list">
            {summary.files.map((file) => (
              <div className="changes-file-row" key={file.path} title={file.path}>
                <span className={`changes-kind ${file.kind}`}>{changeKindLabel(file.kind, appLanguage)}</span>
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
  const ollamaModel = useApp((s) => s.ollamaModel)
  const openRouterModel = useApp((s) => s.openRouterModel)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
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
          model: provider === 'openrouter' ? openRouterModel : provider === 'ollama' ? ollamaModel : model,
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
        title={t('git.branchActions')}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="gitBranch" size={12} />
        <span>{status.branch || 'HEAD'}</span>
        {behind > 0 && <span className="git-behind">↓{behind}</span>}
        {ahead > 0 && <span className="git-ahead">↑{ahead}</span>}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
      </button>

      {open && (
        <div className="git-quick-popover" role="dialog" aria-label={t('git.actions')}>
          <div className="git-quick-head">
            <div>
              <strong>{status.branch || 'HEAD'}</strong>
              <span>
                {status.pushTarget ? t('git.pushTarget', { target: status.pushTarget }) : t('git.noPushRemote')}
              </span>
            </div>
            <button
              type="button"
              className="git-quick-icon"
              title={t('git.fetchRefresh')}
              disabled={disabled}
              onClick={() => void refresh(true)}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>

          <label className="git-quick-field">
            <span>{t('git.branch')}</span>
            <select
              value={status.branch || ''}
              disabled={disabled || branches.length === 0}
              onChange={(event) => switchBranch(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}{branch.current ? ` (${t('git.current')})` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="git-quick-state">
            <span>{fileCount} {t('chat.changed')}</span>
            <span>{behind} {t('git.incoming')}</span>
            <span>{ahead} {t('git.outgoing')}</span>
          </div>

          <div className="git-quick-actions">
            <button type="button" disabled={disabled || behind === 0} onClick={pull}>
              {busy === 'pull' ? t('git.pulling') : `Pull${behind ? ` (${behind})` : ''}`}
            </button>
            <button type="button" disabled={disabled || !canPush} onClick={push}>
              {busy === 'push' ? t('git.pushing') : `Push${ahead ? ` (${ahead})` : ''}`}
            </button>
          </div>
          <button
            type="button"
            className="git-ai-push"
            disabled={disabled || fileCount === 0 || !hasPushTarget}
            onClick={() => void aiCommitAndPush()}
          >
            <Icon name="sparkles" size={14} />
            {busy === 'ai' ? t('git.creatingAiCommit') : t('git.aiCommitPush')}
          </button>

          {loading && <div className="git-quick-message">{t('git.checkingRemote')}</div>}
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
  const appLanguage = useApp((s) => s.appLanguage)
  const activeTaskId = useApp((s) => s.activeTaskId)
  const archivedTaskId = useApp((s) => s.archivedTaskId)
  const readOnly = !!activeTaskId && archivedTaskId === activeTaskId
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
            {readOnly
              ? <div className="archived-task-notice"><Icon name="archive" size={13} /> Архивная задача доступна только для чтения. Восстановите её, чтобы продолжить.</div>
              : <Composer showFolder={false} />}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel panel-side">
      <div className="panel-header">
        <Icon name="message" size={13} />
        {tr(appLanguage, 'chat.agent')}
        <span className="spacer" />
        <ChangesBadge />
      </div>

      <div className="chat">
        <div className="chat-messages" ref={scrollRef}>
          <Messages messages={messages} />
          <ThinkingIndicator />
        </div>
        <div className="chat-composer">
          {readOnly
            ? <div className="archived-task-notice"><Icon name="archive" size={13} /> Архивная задача доступна только для чтения. Восстановите её, чтобы продолжить.</div>
            : <Composer showFolder={false} />}
        </div>
      </div>
    </div>
  )
}
