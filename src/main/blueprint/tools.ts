import type { AgentSearchMatch, AgentSearchOptions, Workspace } from '@shared/ipc'
import {
  hasWProviderToolCallIntent,
  parseWProviderTextToolCall,
  type WProviderTextToolCall
} from '@shared/wprovider-tools'
import {
  editAgentFile,
  listAgentDir,
  readAgentFile,
  runAgentCommand,
  searchAgentFiles,
  writeAgentFile
} from '../ipc/agent'
import { fetchWebUrl, searchWeb } from '../ipc/web'

export type BlueprintToolCall = WProviderTextToolCall
export const hasBlueprintToolCallIntent = hasWProviderToolCallIntent
export const parseBlueprintToolCall = parseWProviderTextToolCall

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

function asPositiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined
}

function asNonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

/** Instructions appended to a Blueprint participant's existing team prompt. */
export function blueprintAgentModePrompt(workspace?: Workspace): string {
  const shellNote =
    process.platform === 'win32'
      ? 'Commands run in Windows PowerShell. Use PowerShell/Windows-friendly commands; && and || are translated when PowerShell 7 is unavailable.'
      : 'Commands run in a POSIX shell (sh). Use Unix-compatible commands.'
  const workspaceTools = workspace
    ? [
        '- list_dir(path): list a directory ("." is the project root)',
        '- read_file(path, [start_line], [end_line]): read a whole file or a line range',
        '- search_files(query, [path], [regex], [glob], [context], [case_sensitive]): search project files',
        '- write_file(path, content): create or fully overwrite a file',
        '- edit_file(path, old_string, new_string, [replace_all]): replace an exact snippet',
        '- run_command(command): run a one-shot command in the project root'
      ]
    : []

  return [
    'Agent mode is enabled. You can solve the task through multiple tool calls:',
    ...workspaceTools,
    '- web_search(query): search the web for ranked results',
    '- web_fetch(url, [max_chars]): fetch a page and return readable text',
    '',
    ...(workspace
      ? [
          `The selected local project is "${workspace.name}". All file paths are relative to its root.`,
          'Read relevant content before changing it. File changes and commands run automatically.',
          shellNote
        ]
      : [
          'No project is selected for this Blueprint, so only web_search and web_fetch are available.',
          'Do not request file or command tools unless a project is assigned.'
        ]),
    'Call exactly one tool at a time, wait for its result, and then decide the next action.',
    'To call a tool, reply with ONLY one fenced block in this exact format (no prose around it):',
    '```tool_call',
    '{"tool": "web_search", "args": {"query": "example"}}',
    '```',
    'When the task is complete, reply with the final result in plain text and no tool_call block.'
  ].join('\n')
}

function requireWorkspaceRoot(workspaceRoot: string | undefined): string | null {
  return workspaceRoot?.trim() || null
}

function searchOptions(args: Record<string, unknown>): AgentSearchOptions {
  return {
    path: asString(args.path) || undefined,
    regex: asBoolean(args.regex),
    glob: asString(args.glob) || undefined,
    context: asNonNegativeInteger(args.context),
    caseSensitive: asBoolean(args.case_sensitive)
  }
}

function formatSearchMatch(match: AgentSearchMatch): string {
  if (!match.before?.length && !match.after?.length) {
    return `${match.path}:${match.line}: ${match.text}`
  }
  const lines: string[] = []
  const firstBefore = match.line - (match.before?.length ?? 0)
  match.before?.forEach((line, index) => lines.push(`${match.path}:${firstBefore + index}- ${line}`))
  lines.push(`${match.path}:${match.line}:> ${match.text}`)
  match.after?.forEach((line, index) => lines.push(`${match.path}:${match.line + 1 + index}- ${line}`))
  return lines.join('\n')
}

function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}\n…(${text.length - max} more chars truncated)`
    : text
}

/** Execute one request and format its result exactly as a follow-up user turn. */
export async function executeBlueprintTool(
  call: BlueprintToolCall,
  workspaceRoot?: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new Error('Tool execution aborted.')
  const root = requireWorkspaceRoot(workspaceRoot)

  if (call.name === 'web_fetch') {
    const result = await fetchWebUrl(
      asString(call.args.url),
      asNonNegativeInteger(call.args.max_chars),
      signal
    )
    return result.ok
      ? `Fetched ${result.url}${result.title ? `\nTitle: ${result.title}` : ''}\n\n${result.content ?? ''}` +
          (result.truncated ? '\n…(content truncated)' : '')
      : `Error: ${result.error}`
  }

  if (call.name === 'web_search') {
    const query = asString(call.args.query)
    const result = await searchWeb(query, signal)
    const items = result.results ?? []
    return result.ok
      ? items.length
        ? `Web results for "${query}":\n` +
          items
            .map(
              (item, index) =>
                `${index + 1}. ${item.title}\n   ${item.url}${item.snippet ? `\n   ${item.snippet}` : ''}`
            )
            .join('\n')
        : `No web results for "${query}".`
      : `Error: ${result.error}`
  }

  if (!root) {
    return 'Error: This Blueprint has no project selected. Choose a project in Agent mode settings before using file or command tools.'
  }

  if (call.name === 'list_dir') {
    const result = await listAgentDir(root, asString(call.args.path) || '.')
    return result.ok
      ? `Directory ${result.path}:\n${(result.entries ?? [])
          .map((entry) => (entry.type === 'directory' ? `${entry.name}/` : entry.name))
          .join('\n') || '(empty)'}`
      : `Error: ${result.error}`
  }

  if (call.name === 'read_file') {
    const startLine = asPositiveInteger(call.args.start_line)
    const endLine = asPositiveInteger(call.args.end_line)
    const range = startLine || endLine ? { startLine, endLine } : undefined
    const result = await readAgentFile(root, asString(call.args.path), range)
    if (!result.ok) return `Error: ${result.error}`
    if (result.truncated) return `(${result.path} is binary or too large to read)`
    return result.startLine != null && result.endLine != null
      ? `Contents of ${result.path} (lines ${result.startLine}-${result.endLine} of ${result.totalLines}):\n${result.content}`
      : `Contents of ${result.path}:\n${result.content}`
  }

  if (call.name === 'search_files') {
    const query = asString(call.args.query)
    const result = await searchAgentFiles(root, query, searchOptions(call.args), signal)
    const matches = result.matches ?? []
    return result.ok
      ? matches.length
        ? `${matches.length}${result.truncated ? '+' : ''} match(es) for "${query}":\n` +
          matches.map(formatSearchMatch).join('\n') +
          (result.truncated ? '\n…(more matches truncated)' : '')
        : `No matches for "${query}".`
      : `Error: ${result.error}`
  }

  if (call.name === 'edit_file') {
    const result = await editAgentFile(
      root,
      asString(call.args.path),
      asString(call.args.old_string),
      asString(call.args.new_string),
      asBoolean(call.args.replace_all)
    )
    return result.ok
      ? `Edited ${result.path} (${result.replacements} replacement${result.replacements === 1 ? '' : 's'}).`
      : `Error: ${result.error}`
  }

  if (call.name === 'write_file') {
    const result = await writeAgentFile(root, asString(call.args.path), asString(call.args.content))
    return result.ok
      ? `${result.created ? 'Created' : 'Updated'} ${result.path} (${result.bytes} bytes).`
      : `Error: ${result.error}`
  }

  const result = await runAgentCommand(root, asString(call.args.command), signal)
  if (!result.ok) return `Error: ${result.error}`
  const head = result.timedOut ? 'Exit: killed (timeout)' : `Exit code: ${result.code}`
  const output = [head]
  if (result.stdout?.trim()) output.push(`stdout:\n${result.stdout}`)
  if (result.stderr?.trim()) output.push(`stderr:\n${result.stderr}`)
  return truncate(output.join('\n'), 16_000)
}
