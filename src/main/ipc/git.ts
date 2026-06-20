import { ipcMain } from 'electron'
import { execFile, type ExecFileException } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  IPC,
  type GitActionResult,
  type GitCommitFile,
  type GitCommitSummary,
  type GitCommitDiffRequest,
  type GitCommitFilesResult,
  type GitDiffRequest,
  type GitDiffResult,
  type GitFileStatus,
  type GitHistoryResult,
  type GitStatusFile,
  type GitStatusResult
} from '@shared/ipc'

const GIT_TIMEOUT_MS = 20_000
const GIT_MAX_BUFFER = 24 * 1024 * 1024
const MAX_UNTRACKED_DIFF_BYTES = 512 * 1024

interface GitOutput {
  stdout: string
  stderr: string
}

interface GitBranchInfo {
  branch?: string
  upstream?: string
  ahead?: number
  behind?: number
}

interface GitSnapshot {
  branch: GitBranchInfo
  files: GitStatusFile[]
  outgoingCommits: GitCommitSummary[]
}

class GitError extends Error {}

function cleanOutput(text: string): string {
  return text.replace(/\0/g, '').trim()
}

function runGit(
  cwd: string,
  args: string[],
  allowExitCodes: number[] = []
): Promise<GitOutput> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '')
        const err = String(stderr ?? '')
        if (!error) {
          resolvePromise({ stdout: out, stderr: err })
          return
        }

        const execError = error as ExecFileException
        const code = typeof execError.code === 'number' ? execError.code : undefined
        if (code !== undefined && allowExitCodes.includes(code)) {
          resolvePromise({ stdout: out, stderr: err })
          return
        }

        const message = cleanOutput(err) || cleanOutput(out) || execError.message
        reject(new GitError(message))
      }
    )
  })
}

async function repoRoot(cwd: string): Promise<string> {
  try {
    const result = await runGit(cwd, ['rev-parse', '--show-toplevel'])
    return cleanOutput(result.stdout)
  } catch (err) {
    if (err instanceof GitError) {
      if (err.message.includes('ENOENT')) {
        throw new GitError('Git executable was not found on PATH.')
      }
      throw new GitError('This folder is not a Git repository.')
    }
    throw err
  }
}

async function hasHead(root: string): Promise<boolean> {
  try {
    await runGit(root, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

function safePathspec(filePath: string): string {
  if (!filePath || filePath.includes('\0') || isAbsolute(filePath)) {
    throw new GitError('Invalid file path.')
  }
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.split('/').includes('..')) throw new GitError('Invalid file path.')
  return normalized
}

function statusChar(char: string): GitFileStatus {
  if ([' ', 'M', 'A', 'D', 'R', 'C', 'U', '?', '!', 'T'].includes(char)) {
    return char as GitFileStatus
  }
  return ' '
}

function safeCommitHash(hash: string): string {
  const trimmed = hash.trim()
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) throw new GitError('Invalid commit hash.')
  return trimmed
}

function parseBranch(header: string): GitBranchInfo {
  const info: GitBranchInfo = {}
  let text = header.trim()
  const tracking = text.match(/\s+\[([^\]]+)\]$/)
  if (tracking) {
    for (const part of tracking[1].split(',')) {
      const trimmed = part.trim()
      const ahead = trimmed.match(/^ahead (\d+)$/)
      const behind = trimmed.match(/^behind (\d+)$/)
      if (ahead) info.ahead = Number(ahead[1])
      if (behind) info.behind = Number(behind[1])
    }
    text = text.slice(0, tracking.index).trim()
  }

  const unborn = text.match(/^No commits yet on (.+)$/)
  if (unborn) {
    info.branch = unborn[1]
    return info
  }

  const [branch, upstream] = text.split('...')
  info.branch = branch || text
  if (upstream) info.upstream = upstream
  return info
}

function parseStatus(stdout: string): { branch: GitBranchInfo; files: GitStatusFile[] } {
  const records = stdout.split('\0').filter(Boolean)
  const files: GitStatusFile[] = []
  let branch: GitBranchInfo = {}

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (record.startsWith('## ')) {
      branch = parseBranch(record.slice(3))
      continue
    }
    if (record.length < 4) continue

    const index = statusChar(record[0])
    const workTree = statusChar(record[1])
    const path = record.slice(3)
    let originalPath: string | undefined

    if (['R', 'C'].includes(index) || ['R', 'C'].includes(workTree)) {
      originalPath = records[i + 1]
      i += 1
    }

    const untracked = index === '?' && workTree === '?'
    const staged = !untracked && index !== ' ' && index !== '!'
    const unstaged = untracked || (workTree !== ' ' && workTree !== '!')

    files.push({ path, originalPath, index, workTree, staged, unstaged, untracked })
  }

  return { branch, files }
}

function parseOutgoingCommits(stdout: string): GitCommitSummary[] {
  return stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', shortHash = '', subject = '', author = '', timestamp = '0'] =
        record.split('\x1f')
      return {
        hash,
        shortHash,
        subject,
        author,
        timestamp: Number(timestamp) * 1000
      }
    })
    .filter((commit) => commit.hash && commit.subject)
}

function parseCommitFiles(stdout: string): GitCommitFile[] {
  const records = stdout.split('\0').filter(Boolean)
  const files: GitCommitFile[] = []
  for (let i = 0; i < records.length; i += 1) {
    const token = records[i]
    const status = statusChar(token[0])
    if (status === 'R' || status === 'C') {
      const originalPath = records[i + 1]
      const path = records[i + 2]
      if (path) files.push({ path, originalPath, status })
      i += 2
    } else {
      const path = records[i + 1]
      if (path) files.push({ path, status })
      i += 1
    }
  }
  return files
}

async function outgoingCommits(root: string, upstream?: string): Promise<GitCommitSummary[]> {
  try {
    const output = await runGit(
      root,
      upstream
        ? ['log', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1e', `${upstream}..HEAD`]
        : ['log', '--max-count=5', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1e', 'HEAD']
    )
    return parseOutgoingCommits(output.stdout)
  } catch {
    return []
  }
}

async function recentCommits(root: string): Promise<GitCommitSummary[]> {
  const output = await runGit(root, [
    'log',
    '--max-count=50',
    '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1e'
  ])
  return parseOutgoingCommits(output.stdout)
}

async function readSnapshot(root: string): Promise<GitSnapshot> {
  const output = await runGit(root, [
    '-c',
    'core.quotepath=false',
    'status',
    '--porcelain=v1',
    '-z',
    '-b',
    '-uall'
  ])
  const parsed = parseStatus(output.stdout)
  return {
    ...parsed,
    outgoingCommits: await outgoingCommits(root, parsed.branch.upstream)
  }
}

async function hasRemote(root: string, name: string): Promise<boolean> {
  try {
    const output = await runGit(root, ['remote'])
    return output.stdout.split(/\r?\n/).includes(name)
  } catch {
    return false
  }
}

function pathInside(root: string, filePath: string): string {
  const pathspec = safePathspec(filePath)
  const absolute = resolve(root, pathspec)
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new GitError('Invalid file path.')
  return absolute
}

async function isUntracked(root: string, filePath: string): Promise<boolean> {
  const pathspec = safePathspec(filePath)
  const result = await runGit(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    pathspec
  ])
  return result.stdout.split('\0').filter(Boolean).includes(pathspec)
}

async function untrackedDiff(root: string, filePath: string): Promise<string> {
  const pathspec = safePathspec(filePath)
  const absolute = pathInside(root, pathspec)
  const info = await stat(absolute)
  if (info.size > MAX_UNTRACKED_DIFF_BYTES) {
    return `diff --git a/${pathspec} b/${pathspec}\nnew file mode 100644\n--- /dev/null\n+++ b/${pathspec}\n@@\n+File is too large to preview (${(info.size / 1024 / 1024).toFixed(1)} MB).\n`
  }

  const buffer = await readFile(absolute)
  if (buffer.subarray(0, 8192).includes(0)) {
    return `diff --git a/${pathspec} b/${pathspec}\nnew file mode 100644\nBinary files /dev/null and b/${pathspec} differ\n`
  }

  const content = buffer.toString('utf8')
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const body = lines.map((line) => `+${line}`).join('\n')
  const lineCount = Math.max(lines.length, 1)
  return [
    `diff --git a/${pathspec} b/${pathspec}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${pathspec}`,
    `@@ -0,0 +1,${lineCount} @@`,
    body
  ]
    .filter(Boolean)
    .join('\n')
}

function actionError(err: unknown): GitActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

function diffError(err: unknown): GitDiffResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

export function registerGitHandlers(): void {
  ipcMain.handle(IPC.git.status, async (_e, cwd: string): Promise<GitStatusResult> => {
    try {
      const root = await repoRoot(cwd)
      const snapshot = await readSnapshot(root)
      return {
        ok: true,
        root,
        ...snapshot.branch,
        files: snapshot.files,
        outgoingCommits: snapshot.outgoingCommits
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.git.diff,
    async (_e, cwd: string, request: GitDiffRequest = {}): Promise<GitDiffResult> => {
      try {
        const root = await repoRoot(cwd)
        const args = ['diff', '--no-ext-diff', '--minimal']
        if (request.staged) args.push('--cached')
        if (request.path) {
          const pathspec = safePathspec(request.path)
          if (!request.staged && (await isUntracked(root, pathspec))) {
            return { ok: true, diff: await untrackedDiff(root, pathspec) }
          }
          args.push('--', pathspec)
        }
        const output = await runGit(root, args, [1])
        return { ok: true, diff: output.stdout }
      } catch (err) {
        return diffError(err)
      }
    }
  )

  ipcMain.handle(
    IPC.git.stage,
    async (_e, cwd: string, filePath?: string): Promise<GitActionResult> => {
      try {
        const root = await repoRoot(cwd)
        const args = filePath ? ['add', '--', safePathspec(filePath)] : ['add', '-A']
        const output = await runGit(root, args)
        return { ok: true, output: cleanOutput(output.stdout || output.stderr) }
      } catch (err) {
        return actionError(err)
      }
    }
  )

  ipcMain.handle(
    IPC.git.unstage,
    async (_e, cwd: string, filePath?: string): Promise<GitActionResult> => {
      try {
        const root = await repoRoot(cwd)
        const args = (await hasHead(root))
          ? filePath
            ? ['restore', '--staged', '--', safePathspec(filePath)]
            : ['restore', '--staged', '--', '.']
          : filePath
            ? ['rm', '--cached', '-r', '--', safePathspec(filePath)]
            : ['rm', '--cached', '-r', '--', '.']
        const output = await runGit(root, args)
        return { ok: true, output: cleanOutput(output.stdout || output.stderr) }
      } catch (err) {
        return actionError(err)
      }
    }
  )

  ipcMain.handle(
    IPC.git.discard,
    async (_e, cwd: string, filePath: string): Promise<GitActionResult> => {
      try {
        const root = await repoRoot(cwd)
        const pathspec = safePathspec(filePath)
        const output = await runGit(
          root,
          (await isUntracked(root, pathspec))
            ? ['clean', '-f', '--', pathspec]
            : ['restore', '--worktree', '--', pathspec]
        )
        return { ok: true, output: cleanOutput(output.stdout || output.stderr) }
      } catch (err) {
        return actionError(err)
      }
    }
  )

  ipcMain.handle(
    IPC.git.commit,
    async (_e, cwd: string, message: string): Promise<GitActionResult> => {
      try {
        const trimmed = message.trim()
        if (!trimmed) throw new GitError('Commit message is required.')
        const root = await repoRoot(cwd)
        const output = await runGit(root, ['commit', '-m', trimmed])
        return { ok: true, output: cleanOutput(output.stdout || output.stderr) }
      } catch (err) {
        return actionError(err)
      }
    }
  )

  ipcMain.handle(IPC.git.push, async (_e, cwd: string): Promise<GitActionResult> => {
    try {
      const root = await repoRoot(cwd)
      const snapshot = await readSnapshot(root)
      const branch = snapshot.branch.branch
      const args =
        snapshot.branch.upstream || !branch || branch === 'HEAD' || !(await hasRemote(root, 'origin'))
          ? ['push', '--porcelain']
          : ['push', '--porcelain', '-u', 'origin', branch]
      const output = await runGit(root, args)
      return { ok: true, output: cleanOutput(output.stdout || output.stderr) }
    } catch (err) {
      return actionError(err)
    }
  })

  ipcMain.handle(IPC.git.fetch, async (_e, cwd: string): Promise<GitActionResult> => {
    try {
      const root = await repoRoot(cwd)
      if (!(await hasRemote(root, 'origin'))) {
        throw new GitError('Remote origin is not configured.')
      }
      const output = await runGit(root, ['fetch', '--prune', 'origin'])
      return { ok: true, output: cleanOutput(output.stdout || output.stderr) }
    } catch (err) {
      return actionError(err)
    }
  })

  ipcMain.handle(IPC.git.history, async (_e, cwd: string): Promise<GitHistoryResult> => {
    try {
      const root = await repoRoot(cwd)
      return { ok: true, commits: await recentCommits(root) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.git.commitFiles,
    async (_e, cwd: string, commit: string): Promise<GitCommitFilesResult> => {
      try {
        const root = await repoRoot(cwd)
        const hash = safeCommitHash(commit)
        const output = await runGit(root, [
          'diff-tree',
          '--no-commit-id',
          '--name-status',
          '-r',
          '-z',
          '--find-renames',
          '--root',
          hash
        ])
        return { ok: true, files: parseCommitFiles(output.stdout) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.git.commitDiff,
    async (_e, cwd: string, request: GitCommitDiffRequest): Promise<GitDiffResult> => {
      try {
        const root = await repoRoot(cwd)
        const hash = safeCommitHash(request.commit)
        const args = ['show', '--format=', '--no-ext-diff', '--minimal', '--find-renames', hash]
        if (request.path) args.push('--', safePathspec(request.path))
        const output = await runGit(root, args)
        return { ok: true, diff: output.stdout }
      } catch (err) {
        return diffError(err)
      }
    }
  )
}
