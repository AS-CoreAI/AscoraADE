import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type {
  GitCommitFile,
  GitCommitSummary,
  GitFileStatus,
  GitStatusFile,
  GitStatusResult
} from '@shared/ipc'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import { useApp, type AppLanguage } from '@/state/store'
import { tr, type TranslationKey } from '@/language'

interface Selection {
  path: string
  staged: boolean
}

interface CommitFileSelection {
  commit: string
  path: string
  status: GitFileStatus
}

type GitApi = (typeof api)['git']

const GIT_BRIDGE_UNAVAILABLE =
  'Git API is not available in this window. Restart the Electron app to load the updated preload.'

const STATUS_LABEL: Record<GitFileStatus, string> = {
  ' ': '',
  M: 'M',
  A: 'A',
  D: 'D',
  R: 'R',
  C: 'C',
  U: 'U',
  '?': 'U',
  '!': '!',
  T: 'T'
}

function basename(path: string): string {
  return path.split('/').at(-1) || path
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

function statusFor(file: GitStatusFile, staged: boolean): GitFileStatus {
  if (file.untracked) return '?'
  return staged ? file.index : file.workTree
}

function statusClass(status: GitFileStatus): string {
  if (status === 'A' || status === 'C' || status === '?') return 'a'
  if (status === 'D') return 'd'
  return 'm'
}

function pickSelection(files: GitStatusFile[]): Selection | null {
  const unstaged = files.find((file) => file.unstaged)
  if (unstaged) return { path: unstaged.path, staged: false }
  const staged = files.find((file) => file.staged)
  return staged ? { path: staged.path, staged: true } : null
}

function hasSelection(files: GitStatusFile[], selection: Selection): boolean {
  return files.some(
    (file) =>
      file.path === selection.path && (selection.staged ? file.staged : file.unstaged)
  )
}

function stripCommitMessage(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, '').trim())
    .split('\n')
    .map((line) => line.replace(/^["'`]|["'`]$/g, '').trimEnd())
    .join('\n')
    .trim()
}

function branchLabel(status: GitStatusResult | null, language: AppLanguage): string {
  if (!status?.ok) return tr(language, 'git.noRepository')
  const branch = status.branch || 'HEAD'
  const upstream = status.upstream ? ` -> ${status.upstream}` : ''
  const ahead = status.ahead ? ` +${status.ahead}` : ''
  const behind = status.behind ? ` -${status.behind}` : ''
  return `${branch}${upstream}${ahead}${behind}`
}

function formatCommitTime(timestamp: number, language: AppLanguage): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return tr(language, 'git.now')
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function getGitApi(): GitApi | null {
  const bridged = api as typeof api & { git?: GitApi }
  return bridged.git ?? null
}

function absoluteGitPath(root: string, path: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${path}`
}

function hasGitMethod<K extends keyof GitApi>(
  git: GitApi,
  method: K
): git is GitApi & Record<K, GitApi[K]> {
  return typeof git[method] === 'function'
}

function GitFileRow({
  file,
  staged,
  active,
  busy,
  onSelect,
  onStage,
  onUnstage,
  onOpen
}: {
  file: GitStatusFile
  staged: boolean
  active: boolean
  busy: boolean
  onSelect: () => void
  onStage: () => void
  onUnstage: () => void
  onOpen: () => void
}): JSX.Element {
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const status = statusFor(file, staged)
  const dir = dirname(file.path)
  const canOpen = status !== 'D'
  return (
    <div className={`git-row${active ? ' active' : ''}`} onClick={onSelect} title={file.path}>
      <span className={`git-badge ${statusClass(status)}`}>{STATUS_LABEL[status]}</span>
      <span className="git-file-main">
        <span className="git-file-name">{basename(file.path)}</span>
        {dir && <span className="git-file-dir">{dir}</span>}
      </span>
      <span className="git-row-actions">
        <button
          disabled={busy || !canOpen}
          title={canOpen ? t('git.openFile') : t('git.fileDeleted')}
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          <Icon name="file" size={13} />
        </button>
        {staged ? (
          <button
            disabled={busy}
            title={t('git.unstageFile')}
            onClick={(e) => {
              e.stopPropagation()
              onUnstage()
            }}
          >
            <Icon name="arrowLeft" size={13} />
          </button>
        ) : (
          <button
            disabled={busy}
            title={t('git.stageFile')}
            onClick={(e) => {
              e.stopPropagation()
              onStage()
            }}
          >
            <Icon name="plus" size={13} />
          </button>
        )}
      </span>
    </div>
  )
}

function GitCommitRow({
  commit,
  active,
  onSelect
}: {
  commit: GitCommitSummary
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const appLanguage = useApp((s) => s.appLanguage)
  const time = formatCommitTime(commit.timestamp, appLanguage)
  return (
    <div className={`git-commit-row${active ? ' active' : ''}`} title={commit.hash} onClick={onSelect}>
      <span className="git-commit-hash">{commit.shortHash}</span>
      <span className="git-commit-main">
        <span className="git-commit-subject">{commit.subject}</span>
        <span className="git-commit-meta">
          {commit.author}
          {time ? ` - ${time}` : ''}
        </span>
      </span>
    </div>
  )
}

function GitCommitFileRow({
  file,
  active,
  busy,
  onSelect,
  onOpen
}: {
  file: GitCommitFile
  active: boolean
  busy: boolean
  onSelect: () => void
  onOpen: () => void
}): JSX.Element {
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const dir = dirname(file.path)
  const canOpen = file.status !== 'D'
  return (
    <div className={`git-row git-history-file${active ? ' active' : ''}`} onClick={onSelect} title={file.path}>
      <span className={`git-badge ${statusClass(file.status)}`}>{STATUS_LABEL[file.status]}</span>
      <span className="git-file-main">
        <span className="git-file-name">{basename(file.path)}</span>
        {dir && <span className="git-file-dir">{dir}</span>}
        {file.originalPath && (
          <span className="git-file-dir">{t('git.fromOriginal', { path: file.originalPath })}</span>
        )}
      </span>
      <span className="git-row-actions">
        <button
          disabled={busy || !canOpen}
          title={canOpen ? t('git.openFile') : t('git.fileDeletedCommit')}
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          <Icon name="file" size={13} />
        </button>
      </span>
    </div>
  )
}

export function GitPanel(): JSX.Element {
  const active = useApp((s) => s.active)
  const activeSsh = useApp((s) => s.activeSsh)
  const provider = useApp((s) => s.provider)
  const model = useApp((s) => s.model)
  const appLanguage = useApp((s) => s.appLanguage)
  const ollamaModel = useApp((s) => s.ollamaModel)
  const openRouterModel = useApp((s) => s.openRouterModel)
  const openFileInEditor = useApp((s) => s.openFile)
  const activePath = activeSsh ? undefined : active?.path
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)

  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFileSelection | null>(null)
  const [diff, setDiff] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [history, setHistory] = useState<GitCommitSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [commitFilesLoading, setCommitFilesLoading] = useState(false)

  const files = status?.ok ? status.files ?? [] : []
  const outgoingCommits = status?.ok ? status.outgoingCommits ?? [] : []
  const stagedFiles = useMemo(() => files.filter((file) => file.staged), [files])
  const unstagedFiles = useMemo(() => files.filter((file) => file.unstaged), [files])
  const isBusy = busy !== null || loading
  const gitReady = getGitApi() !== null
  const selectedCommitSummary = history.find((commit) => commit.hash === selectedCommit)

  const refreshHistory = useCallback(async () => {
    if (!activePath) {
      setHistory([])
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedCommitFile(null)
      return
    }

    const git = getGitApi()
    if (!git || !hasGitMethod(git, 'history')) return

    setHistoryLoading(true)
    try {
      const result = await git.history(activePath)
      if (!result.ok) {
        setError(result.error ?? 'Failed to read commit history.')
        return
      }
      const commits = result.commits ?? []
      setHistory(commits)
      setSelectedCommit((current) => {
        if (current && commits.some((commit) => commit.hash === current)) return current
        setCommitFiles([])
        setSelectedCommitFile(null)
        return null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read commit history.')
    } finally {
      setHistoryLoading(false)
    }
  }, [activePath])

  const refreshStatus = useCallback(async () => {
    if (!activePath) {
      setStatus(null)
      setSelected(null)
      setDiff('')
      return
    }

    const git = getGitApi()
    if (!git) {
      setStatus({ ok: false, error: GIT_BRIDGE_UNAVAILABLE })
      setError(GIT_BRIDGE_UNAVAILABLE)
      setSelected(null)
      setDiff('')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await git.status(activePath)
      setStatus(result)
      if (!result.ok) {
        setError(result.error ?? 'Failed to read Git status.')
        setSelected(null)
        setDiff('')
      } else {
        const nextFiles = result.files ?? []
        setSelected((current) =>
          current && hasSelection(nextFiles, current) ? current : pickSelection(nextFiles)
        )
      }
    } catch (err) {
      setStatus({ ok: false, error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : 'Failed to read Git status.')
      setSelected(null)
      setDiff('')
    } finally {
      setLoading(false)
    }
  }, [activePath])

  useEffect(() => {
    void refreshStatus()
    void refreshHistory()
  }, [refreshStatus, refreshHistory])

  useEffect(() => {
    let canceled = false

    async function loadCommitFiles(): Promise<void> {
      if (!activePath || !selectedCommit) {
        setCommitFiles([])
        return
      }

      const git = getGitApi()
      if (!git || !hasGitMethod(git, 'commitFiles')) {
        setError(GIT_BRIDGE_UNAVAILABLE)
        return
      }

      setCommitFilesLoading(true)
      try {
        const result = await git.commitFiles(activePath, selectedCommit)
        if (canceled) return
        if (!result.ok) {
          setError(result.error ?? 'Failed to read commit files.')
          setCommitFiles([])
          return
        }
        const files = result.files ?? []
        setCommitFiles(files)
        const next = files[0]
        setSelectedCommitFile(next ? { commit: selectedCommit, path: next.path, status: next.status } : null)
        setSelected(null)
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to read commit files.')
      } finally {
        if (!canceled) setCommitFilesLoading(false)
      }
    }

    void loadCommitFiles()
    return () => {
      canceled = true
    }
  }, [activePath, selectedCommit])

  useEffect(() => {
    let canceled = false

    async function loadDiff(): Promise<void> {
      if (!activePath || !selected) {
        if (!selectedCommitFile) setDiff('')
        return
      }

      const git = getGitApi()
      if (!git) {
        setDiff('')
        setError(GIT_BRIDGE_UNAVAILABLE)
        return
      }

      setDiffLoading(true)
      try {
        const result = await git.diff(activePath, {
          path: selected.path,
          staged: selected.staged
        })
        if (canceled) return
        if (result.ok) {
          setDiff(result.diff?.trimEnd() || 'No diff to show.')
        } else {
          setDiff('')
          setError(result.error ?? 'Failed to read diff.')
        }
      } catch (err) {
        if (canceled) return
        setDiff('')
        setError(err instanceof Error ? err.message : 'Failed to read diff.')
      } finally {
        if (!canceled) setDiffLoading(false)
      }
    }

    void loadDiff()
    return () => {
      canceled = true
    }
  }, [activePath, selected?.path, selected?.staged, selectedCommitFile])

  useEffect(() => {
    let canceled = false

    async function loadCommitDiff(): Promise<void> {
      if (!activePath || !selectedCommitFile) return

      const git = getGitApi()
      if (!git || !hasGitMethod(git, 'commitDiff')) {
        setError(GIT_BRIDGE_UNAVAILABLE)
        return
      }

      setDiffLoading(true)
      try {
        const result = await git.commitDiff(activePath, {
          commit: selectedCommitFile.commit,
          path: selectedCommitFile.path
        })
        if (canceled) return
        if (result.ok) {
          setDiff(result.diff?.trimEnd() || 'No diff to show.')
        } else {
          setDiff('')
          setError(result.error ?? 'Failed to read commit diff.')
        }
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : 'Failed to read commit diff.')
      } finally {
        if (!canceled) setDiffLoading(false)
      }
    }

    void loadCommitDiff()
    return () => {
      canceled = true
    }
  }, [activePath, selectedCommitFile?.commit, selectedCommitFile?.path])

  const runAction = useCallback(
    async (
      name: string,
      action: () => Promise<{ ok: boolean; error?: string }>,
      onSuccess?: () => void
    ) => {
      setBusy(name)
      setError(null)
      try {
        const result = await action()
        if (!result.ok) {
          setError(result.error ?? 'Git command failed.')
          return
        }
        onSuccess?.()
        await refreshStatus()
        await refreshHistory()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Git command failed.')
      } finally {
        setBusy(null)
      }
    },
    [refreshStatus, refreshHistory]
  )

  const openGitFile = async (path: string): Promise<void> => {
    const root = status?.root ?? activePath
    if (!root) return
    try {
      await openFileInEditor({
        path: absoluteGitPath(root, path),
        name: basename(path),
        type: 'file'
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file.')
    }
  }

  const stageFile = (path: string): void => {
    if (!activePath) return
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    void runAction('stage', () => git.stage(activePath, path))
  }

  const unstageFile = (path: string): void => {
    if (!activePath) return
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    void runAction('unstage', () => git.unstage(activePath, path))
  }

  const stageAll = (): void => {
    if (!activePath) return
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    void runAction('stage-all', () => git.stage(activePath))
  }

  const unstageAll = (): void => {
    if (!activePath) return
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    void runAction('unstage-all', () => git.unstage(activePath))
  }

  const discardSelected = (): void => {
    if (!activePath || !selected || selected.staged) return
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    const ok = window.confirm(`Discard working tree changes in ${selected.path}? This cannot be undone.`)
    if (!ok) return
    void runAction('discard', () => git.discard(activePath, selected.path))
  }

  const push = (): void => {
    if (!activePath) return
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    if (!hasGitMethod(git, 'push')) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    void runAction('push', () => git.push(activePath))
  }

  const fetchOrigin = (): void => {
    if (!activePath) return
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    if (!hasGitMethod(git, 'fetch')) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    void runAction('fetch', () => git.fetch(activePath))
  }

  const generateCommitMessage = async (): Promise<void> => {
    if (!activePath || files.length === 0 || aiBusy) return

    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }

    setAiBusy(true)
    setError(null)
    try {
      if (stagedFiles.length === 0) {
        const stageResult = await git.stage(activePath)
        if (!stageResult.ok) {
          setError(stageResult.error ?? 'Failed to stage changes.')
          return
        }
        await refreshStatus()
      }

      const diffResult = await git.diff(activePath, { staged: true })
      if (!diffResult.ok) {
        setError(diffResult.error ?? 'Failed to read staged diff.')
        return
      }

      const stagedDiff = (diffResult.diff ?? '').trim()
      if (!stagedDiff) {
        setError('Stage changes before generating a commit message.')
        return
      }

      let streamed = ''
      const id = crypto.randomUUID()
      const result = await api.llm.chat(
        id,
        {
          model: provider === 'openrouter' ? openRouterModel : provider === 'ollama' ? ollamaModel : model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'Write concise Git commit messages. Return only the commit message, with no markdown.'
            },
            {
              role: 'user',
              content:
                'Create a concise commit message for this staged diff. Use imperative mood. ' +
                'Prefer one subject line under 72 characters; add a short body only if needed.\n\n' +
                stagedDiff.slice(0, 12_000)
            }
          ]
        },
        (delta) => {
          streamed += delta
          setCommitMessage(stripCommitMessage(streamed))
        }
      )

      if (!result.ok) {
        setError(result.error ?? 'Failed to generate commit message.')
        return
      }

      const message = stripCommitMessage(result.content || streamed)
      if (message) setCommitMessage(message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate commit message.')
    } finally {
      setAiBusy(false)
    }
  }

  const commit = (): void => {
    if (!activePath) return
    const message = commitMessage.trim()
    if (!message) {
      setError('Commit message is required.')
      return
    }
    const git = getGitApi()
    if (!git) {
      setError(GIT_BRIDGE_UNAVAILABLE)
      return
    }
    void runAction('commit', () => git.commit(activePath, message), () => {
      setCommitMessage('')
    })
  }

  return (
    <div className="panel panel-side">
      <div className="panel-header">
        <Icon name="gitBranch" size={13} />
        {t('dock.sourceControl')}
        <span className="spacer" />
        <button
          title={t('common.refresh')}
          disabled={loading || !activePath || !gitReady}
          onClick={() => {
            void refreshStatus()
            void refreshHistory()
          }}
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <div className="panel-body">
        {!activePath && (
          <div className="placeholder-note">{t('git.openFolderHint')}</div>
        )}

        {activePath && (
          <>
            <div className="git-summary" title={status?.root}>
              <Icon name="gitBranch" size={13} />
              <span>{loading ? t('git.loadingStatus') : branchLabel(status, appLanguage)}</span>
              <button
                className="git-inline-btn"
                title={t('git.fetchOrigin')}
                disabled={isBusy || !gitReady}
                onClick={fetchOrigin}
              >
                <Icon name="arrowDown" size={13} />
                {t('git.fetchOrigin')}
              </button>
            </div>

            {error && <div className="git-error">{error}</div>}

            {status?.ok && (
              <>
                <div className="git-commit">
                  <textarea
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder={t('git.commitMessage')}
                    spellCheck={false}
                  />
                  <div className="git-commit-actions">
                    <button
                      className="git-text-btn"
                      disabled={aiBusy || files.length === 0 || isBusy}
                      title={
                        stagedFiles.length > 0
                          ? t('git.generateStaged')
                          : t('git.generateAll')
                      }
                      onClick={() => void generateCommitMessage()}
                    >
                      <Icon name="sparkles" size={13} />
                      {aiBusy ? t('git.generating') : 'AI'}
                    </button>
                    <button
                      className="git-text-btn primary"
                      disabled={busy === 'commit' || stagedFiles.length === 0 || !commitMessage.trim()}
                      title={t('git.commitStaged')}
                      onClick={commit}
                    >
                      <Icon name="check" size={13} />
                      {t('git.commit')}
                    </button>
                  </div>
                </div>

                {outgoingCommits.length > 0 && (
                  <>
                    <div className="git-section-head">
                      <span>
                        {status.upstream ? t('git.outgoingCommits') : t('git.localCommits')} (
                        {outgoingCommits.length})
                      </span>
                      <button
                        className="git-inline-btn primary"
                        title={t('git.pushCommits')}
                        disabled={isBusy || busy === 'push'}
                        onClick={push}
                      >
                        <Icon name="arrowUp" size={13} />
                        {t('git.push')}
                      </button>
                    </div>
                    {outgoingCommits.map((commit) => (
                      <GitCommitRow
                        key={commit.hash}
                        commit={commit}
                        active={selectedCommit === commit.hash}
                        onSelect={() => {
                          setSelectedCommit(commit.hash)
                          setSelected(null)
                          setSelectedCommitFile(null)
                          setDiff('')
                        }}
                      />
                    ))}
                  </>
                )}

                <div className="git-section-head">
                  <span>{t('git.stagedChanges')} ({stagedFiles.length})</span>
                  {stagedFiles.length > 0 && (
                    <button
                      className="git-inline-btn"
                      title={t('git.unstageAllTitle')}
                      disabled={isBusy}
                      onClick={unstageAll}
                    >
                      <Icon name="arrowLeft" size={13} />
                      {t('git.unstageAll')}
                    </button>
                  )}
                </div>
                {stagedFiles.map((file) => (
                  <GitFileRow
                    key={`staged:${file.path}`}
                    file={file}
                    staged
                    active={selected?.path === file.path && selected.staged}
                    busy={isBusy}
                    onSelect={() => {
                      setSelected({ path: file.path, staged: true })
                      setSelectedCommitFile(null)
                      setSelectedCommit(null)
                      setCommitFiles([])
                    }}
                    onStage={() => stageFile(file.path)}
                    onUnstage={() => unstageFile(file.path)}
                    onOpen={() => void openGitFile(file.path)}
                  />
                ))}

                <div className="git-section-head">
                  <span>{t('git.changes')} ({unstagedFiles.length})</span>
                  {unstagedFiles.length > 0 && (
                    <button
                      className="git-inline-btn primary"
                      title={t('git.stageAllTitle')}
                      disabled={isBusy}
                      onClick={stageAll}
                    >
                      <Icon name="plus" size={13} />
                      {t('git.stageAll')}
                    </button>
                  )}
                </div>
                {unstagedFiles.map((file) => (
                  <GitFileRow
                    key={`unstaged:${file.path}`}
                    file={file}
                    staged={false}
                    active={selected?.path === file.path && !selected.staged}
                    busy={isBusy}
                    onSelect={() => {
                      setSelected({ path: file.path, staged: false })
                      setSelectedCommitFile(null)
                      setSelectedCommit(null)
                      setCommitFiles([])
                    }}
                    onStage={() => stageFile(file.path)}
                    onUnstage={() => unstageFile(file.path)}
                    onOpen={() => void openGitFile(file.path)}
                  />
                ))}

                {files.length === 0 && (
                  <div className="placeholder-note">{t('git.clean')}</div>
                )}

                <div className="git-section-head">
                  <span>{t('git.commitHistory')} ({history.length})</span>
                  {historyLoading && <span className="git-section-state">{t('git.loading')}</span>}
                </div>
                {history.map((commit) => (
                  <GitCommitRow
                    key={commit.hash}
                    commit={commit}
                    active={selectedCommit === commit.hash}
                    onSelect={() => {
                      setSelectedCommit(commit.hash)
                      setSelected(null)
                      setSelectedCommitFile(null)
                      setDiff('')
                    }}
                  />
                ))}
                {!historyLoading && history.length === 0 && (
                  <div className="placeholder-note">{t('git.noCommits')}</div>
                )}

                {selectedCommit && (
                  <>
                    <div className="git-section-head nested">
                      <span>
                        {selectedCommitSummary?.shortHash ?? selectedCommit.slice(0, 7)} {t('git.files')} (
                        {commitFiles.length})
                      </span>
                      {commitFilesLoading && <span className="git-section-state">{t('git.loading')}</span>}
                    </div>
                    {commitFiles.map((file) => (
                      <GitCommitFileRow
                        key={`${selectedCommit}:${file.path}:${file.originalPath ?? ''}`}
                        file={file}
                        active={
                          selectedCommitFile?.commit === selectedCommit &&
                          selectedCommitFile.path === file.path
                        }
                        busy={isBusy}
                        onSelect={() => {
                          setSelected(null)
                          setSelectedCommitFile({
                            commit: selectedCommit,
                            path: file.path,
                            status: file.status
                          })
                        }}
                        onOpen={() => void openGitFile(file.path)}
                      />
                    ))}
                  </>
                )}

                {(selected || selectedCommitFile) && (
                  <div className="git-diff-wrap">
                    <div className="git-diff-head">
                      <span>
                        {selectedCommitFile
                          ? t('git.commitDiff', {
                              hash: selectedCommitSummary?.shortHash ?? selectedCommitFile.commit.slice(0, 7)
                            })
                          : selected?.staged
                            ? t('git.stagedDiff')
                            : t('git.workingDiff')}
                      </span>
                      {selected && !selected.staged && (
                        <button title={t('git.discardSelected')} disabled={isBusy} onClick={discardSelected}>
                          <Icon name="x" size={13} />
                        </button>
                      )}
                    </div>
                    <pre className="git-diff">{diffLoading ? t('git.loadingDiff') : diff}</pre>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
