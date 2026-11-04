import type { AgentListResult, ToolDef } from './ipc'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const MAX_ENTRY_CHARS = 12_000

export const LIST_DIR_USAGE = '- list_dir(path, [offset], [limit], [filter]): list a directory in bounded pages; filter is a case-insensitive filename substring ("." is the project root)'

export const LIST_DIR_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'list_dir',
    description: 'List files and folders in a workspace directory. Large directories are paginated; use filter to find relevant names without reading every page.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative dir; "." for root.' },
        offset: { type: 'integer', minimum: 0, description: 'Zero-based offset from the previous result; default 0.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Maximum entries per page; default ${DEFAULT_LIMIT}. Output also has a character limit.` },
        filter: { type: 'string', description: 'Optional case-insensitive substring of the filename, e.g. ".log" or "config".' }
      },
      required: ['path']
    }
  }
}

function integer(value: unknown, fallback: number, minimum: number): number {
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(n) && n >= minimum ? n : fallback
}

/** Bound the model-facing output, shared by local/SSH chat and Blueprints. */
export function formatAgentDirectory(result: AgentListResult, args: Record<string, unknown> = {}): {
  content: string
  summary: string
} {
  if (!result.ok) return { content: `Error: ${result.error}`, summary: '' }
  const all = result.entries ?? []
  const filter = typeof args.filter === 'string' ? args.filter : ''
  const entries = all.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
  const offset = Math.min(integer(args.offset, 0, 0), entries.length)
  const limit = Math.min(integer(args.limit, DEFAULT_LIMIT, 1), MAX_LIMIT)
  const lines: string[] = []
  let chars = 0
  for (const entry of entries.slice(offset, offset + limit)) {
    const line = entry.type === 'directory' ? `${entry.name}/` : entry.name
    if (lines.length && chars + line.length + 1 > MAX_ENTRY_CHARS) break
    lines.push(line)
    chars += line.length + 1
  }
  const next = offset + lines.length
  const summary = `${entries.length} entries${filter ? ` matching ${JSON.stringify(filter)} (${all.length} total)` : ''}` +
    (lines.length ? `; showing ${offset + 1}-${next}` : '')
  const continuation = next < entries.length
    ? `\n… ${entries.length - next} more entries. Use list_dir with the same path${filter ? ' and filter' : ''} and offset=${next}, or narrow filter to relevant filenames.`
    : ''
  return {
    content: `Directory ${result.path ?? '.'} (${summary}):\n${lines.join('\n') || (entries.length ? '(no entries at this offset)' : filter ? '(no matching entries)' : '(empty)')}${continuation}`,
    summary
  }
}
