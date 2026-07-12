import { useEffect, useMemo, useState, type JSX } from 'react'
import { monaco } from '@/monaco-setup'
import { useApp } from '@/state/store'

type DiffLineKind = 'meta' | 'hunk' | 'context' | 'add' | 'delete'

interface DiffLine {
  id: number
  kind: DiffLineKind
  oldLine: number | null
  newLine: number | null
  marker: string
  code: string
}

interface DiffGroup {
  oldPath?: string
  newPath?: string
  diffPath?: string
  sawOldHeader: boolean
  sawNewHeader: boolean
  codeRowIds: number[]
}

interface ParsedDiff {
  lines: DiffLine[]
  groups: DiffGroup[]
}

interface HunkRange {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

interface HighlightState {
  parsed: ParsedDiff
  path?: string
  theme: 'dark' | 'light'
  lines: ReadonlyMap<number, string>
}

export interface GitDiffViewerProps {
  diff: string
  path?: string
  ariaLabel?: string
}

export interface UnifiedDiffStats {
  additions: number
  deletions: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/
const COLORIZED_LINE_BREAK = /<br\s*\/?>/gi

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.bash': 'shell',
  '.c': 'c',
  '.cc': 'cpp',
  '.cjs': 'javascript',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.csv': 'plaintext',
  '.cxx': 'cpp',
  '.dart': 'dart',
  '.fish': 'shell',
  '.go': 'go',
  '.gql': 'graphql',
  '.graphql': 'graphql',
  '.h': 'c',
  '.handlebars': 'handlebars',
  '.hbs': 'handlebars',
  '.hpp': 'cpp',
  '.htm': 'html',
  '.html': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.less': 'less',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.mjs': 'javascript',
  '.php': 'php',
  '.ps1': 'powershell',
  '.py': 'python',
  '.r': 'r',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'shell',
  '.sql': 'sql',
  '.svelte': 'html',
  '.svg': 'xml',
  '.swift': 'swift',
  '.toml': 'ini',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.txt': 'plaintext',
  '.vue': 'html',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell'
}

const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  makefile: 'makefile',
  rakefile: 'ruby'
}

function splitDiffLines(diff: string): string[] {
  if (!diff) return []

  const lines = diff.replace(/\r\n?/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function parseHunkRange(line: string): HunkRange | null {
  const match = HUNK_HEADER.exec(line)
  if (!match) return null

  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4])
  }
}

function decodeGitQuotedPath(value: string): string {
  if (!(value.startsWith('"') && value.endsWith('"'))) return value

  const body = value.slice(1, -1)
  let decoded = ''

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character !== '\\' || index === body.length - 1) {
      decoded += character
      continue
    }

    const escaped = body[index + 1]
    if (escaped !== undefined && /[0-7]/.test(escaped)) {
      const octal = body.slice(index + 1).match(/^[0-7]{1,3}/)?.[0]
      if (octal) {
        decoded += String.fromCharCode(Number.parseInt(octal, 8))
        index += octal.length
        continue
      }
    }

    const escapedCharacters: Readonly<Record<string, string>> = {
      '"': '"',
      '\\': '\\',
      a: '\u0007',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\u000b'
    }
    decoded += escaped === undefined ? '' : (escapedCharacters[escaped] ?? escaped)
    index += 1
  }

  return decoded
}

function normalizeHeaderPath(value: string): string | undefined {
  const withoutTimestamp = value.split('\t', 1)[0]?.trim()
  if (!withoutTimestamp) return undefined

  const decoded = decodeGitQuotedPath(withoutTimestamp)
  if (decoded === '/dev/null') return decoded
  return decoded.replace(/^[ab]\//, '')
}

function tokenizeGitHeader(value: string): string[] {
  const tokens: string[] = []
  let index = 0

  while (index < value.length) {
    while (value[index] === ' ') index += 1
    if (index >= value.length) break

    if (value[index] !== '"') {
      const start = index
      while (index < value.length && value[index] !== ' ') index += 1
      tokens.push(value.slice(start, index))
      continue
    }

    const start = index
    index += 1
    let escaped = false
    while (index < value.length) {
      const character = value[index]
      index += 1
      if (!escaped && character === '"') break
      if (!escaped && character === '\\') {
        escaped = true
      } else {
        escaped = false
      }
    }
    tokens.push(value.slice(start, index))
  }

  return tokens
}

function pathFromDiffHeader(line: string): string | undefined {
  const tokens = tokenizeGitHeader(line.slice('diff --git '.length))
  const newPath = tokens[1]
  return newPath === undefined ? undefined : normalizeHeaderPath(newPath)
}

function languageForPath(path: string | undefined): string {
  if (!path || path === '/dev/null') return 'plaintext'

  const filename = path.split(/[\\/]/).at(-1)?.toLowerCase()
  if (!filename) return 'plaintext'

  const filenameLanguage = LANGUAGE_BY_FILENAME[filename]
  if (filenameLanguage) return filenameLanguage

  const dot = filename.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return LANGUAGE_BY_EXTENSION[filename.slice(dot)] ?? 'plaintext'
}

function preferredGroupPath(group: DiffGroup, fallbackPath: string | undefined): string | undefined {
  if (fallbackPath) return fallbackPath
  if (group.newPath && group.newPath !== '/dev/null') return group.newPath
  if (group.oldPath && group.oldPath !== '/dev/null') return group.oldPath
  if (group.diffPath && group.diffPath !== '/dev/null') return group.diffPath
  return undefined
}

function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines: DiffLine[] = []
  const groups: DiffGroup[] = []
  let currentGroup: DiffGroup | undefined
  let oldLine = 0
  let newLine = 0
  let oldRemaining = 0
  let newRemaining = 0
  let inHunk = false

  const startGroup = (): DiffGroup => {
    const group: DiffGroup = {
      sawOldHeader: false,
      sawNewHeader: false,
      codeRowIds: []
    }
    groups.push(group)
    currentGroup = group
    inHunk = false
    oldRemaining = 0
    newRemaining = 0
    return group
  }

  const getGroup = (): DiffGroup => currentGroup ?? startGroup()

  const pushLine = (
    kind: DiffLineKind,
    marker: string,
    code: string,
    lineOnOldSide: number | null = null,
    lineOnNewSide: number | null = null
  ): void => {
    const group = getGroup()
    const parsedLine: DiffLine = {
      id: lines.length,
      kind,
      oldLine: lineOnOldSide,
      newLine: lineOnNewSide,
      marker,
      code
    }

    lines.push(parsedLine)
    if (kind === 'context' || kind === 'add' || kind === 'delete') {
      group.codeRowIds.push(parsedLine.id)
    }
  }

  const finishHunkIfComplete = (): void => {
    if (oldRemaining <= 0 && newRemaining <= 0) inHunk = false
  }

  for (const rawLine of splitDiffLines(diff)) {
    if (rawLine.startsWith('diff --git ')) {
      const group = startGroup()
      group.diffPath = pathFromDiffHeader(rawLine)
      pushLine('meta', '', rawLine)
      continue
    }

    const hunk = parseHunkRange(rawLine)
    if (hunk) {
      getGroup()
      oldLine = hunk.oldStart
      newLine = hunk.newStart
      oldRemaining = hunk.oldCount
      newRemaining = hunk.newCount
      inHunk = true
      pushLine('hunk', '', rawLine)
      finishHunkIfComplete()
      continue
    }

    if (rawLine.startsWith('\\ No newline at end of file')) {
      pushLine('meta', '\\', rawLine.slice(1))
      continue
    }

    if (inHunk) {
      if (rawLine.startsWith('+')) {
        pushLine('add', '+', rawLine.slice(1), null, newLine)
        newLine += 1
        newRemaining -= 1
        finishHunkIfComplete()
        continue
      }

      if (rawLine.startsWith('-')) {
        pushLine('delete', '-', rawLine.slice(1), oldLine, null)
        oldLine += 1
        oldRemaining -= 1
        finishHunkIfComplete()
        continue
      }

      if (rawLine.startsWith(' ')) {
        pushLine('context', ' ', rawLine.slice(1), oldLine, newLine)
        oldLine += 1
        newLine += 1
        oldRemaining -= 1
        newRemaining -= 1
        finishHunkIfComplete()
        continue
      }
    }

    if (rawLine.startsWith('--- ')) {
      if (currentGroup?.sawOldHeader && currentGroup.sawNewHeader) startGroup()
      const group = getGroup()
      group.oldPath = normalizeHeaderPath(rawLine.slice(4))
      group.sawOldHeader = true
      pushLine('meta', '', rawLine)
      continue
    }

    if (rawLine.startsWith('+++ ')) {
      const group = getGroup()
      group.newPath = normalizeHeaderPath(rawLine.slice(4))
      group.sawNewHeader = true
      pushLine('meta', '', rawLine)
      continue
    }

    if (rawLine.startsWith('Binary files ') || rawLine === 'GIT binary patch') {
      inHunk = false
      oldRemaining = 0
      newRemaining = 0
    }
    pushLine('meta', '', rawLine)
  }

  return { lines, groups }
}

function splitColorizedLines(html: string, expectedLineCount: number): string[] | null {
  const result = html.split(COLORIZED_LINE_BREAK)
  if (result.length === expectedLineCount + 1 && result.at(-1) === '') result.pop()
  return result.length === expectedLineCount ? result : null
}

export function getUnifiedDiffStats(diff: string): UnifiedDiffStats {
  let additions = 0
  let deletions = 0

  for (const line of parseUnifiedDiff(diff).lines) {
    if (line.kind === 'add') additions += 1
    if (line.kind === 'delete') deletions += 1
  }

  return { additions, deletions }
}

export function GitDiffViewer({ diff, path, ariaLabel }: GitDiffViewerProps): JSX.Element {
  const resolvedTheme = useApp((state) => state.resolvedTheme)
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff])
  const [highlightState, setHighlightState] = useState<HighlightState | null>(null)

  useEffect(() => {
    let cancelled = false

    const colorize = async (): Promise<void> => {
      const highlightedLines = new Map<number, string>()

      try {
        monaco.editor.setTheme(resolvedTheme === 'dark' ? 'vs-dark' : 'vs')

        const groupResults = await Promise.all(
          parsed.groups.map(async (group): Promise<Array<readonly [number, string]>> => {
            if (group.codeRowIds.length === 0) return []

            const source = group.codeRowIds
              .map((rowId) => parsed.lines[rowId]?.code ?? '')
              .join('\n')
            const explicitPath = parsed.groups.length === 1 ? path : undefined
            const language = languageForPath(preferredGroupPath(group, explicitPath))

            try {
              const html = await monaco.editor.colorize(source, language, {})
              const htmlLines = splitColorizedLines(html, group.codeRowIds.length)
              if (!htmlLines) return []

              return group.codeRowIds.map((rowId, index) => [rowId, htmlLines[index] ?? ''] as const)
            } catch {
              return []
            }
          })
        )

        for (const groupResult of groupResults) {
          for (const [rowId, html] of groupResult) highlightedLines.set(rowId, html)
        }
      } catch {
        // Monaco can fail while its language services are still loading. Plain React text remains safe.
      }

      if (!cancelled) {
        setHighlightState({ parsed, path, theme: resolvedTheme, lines: highlightedLines })
      }
    }

    void colorize()
    return () => {
      cancelled = true
    }
  }, [parsed, path, resolvedTheme])

  const highlightedLines =
    highlightState?.parsed === parsed &&
    highlightState.path === path &&
    highlightState.theme === resolvedTheme
      ? highlightState.lines
      : undefined

  return (
    <div className="git-diff" role="region" aria-label={ariaLabel}>
      {parsed.lines.map((line) => {
        const highlightedHtml = highlightedLines?.get(line.id)

        return (
          <div className={`git-diff-line ${line.kind}`} key={line.id}>
            <span className="git-diff-line-number old" aria-hidden="true">
              {line.oldLine ?? ''}
            </span>
            <span className="git-diff-line-number new" aria-hidden="true">
              {line.newLine ?? ''}
            </span>
            <span className="git-diff-marker" aria-hidden="true">
              {line.marker}
            </span>
            {highlightedHtml === undefined ? (
              <span className="git-diff-code">{line.code}</span>
            ) : (
              <span
                className="git-diff-code"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default GitDiffViewer
