/** Tool names understood by the built-in WProvider text protocol. */
export const WPROVIDER_TOOL_NAMES = [
  'list_dir',
  'read_file',
  'search_files',
  'write_file',
  'edit_file',
  'run_command',
  'run_typescript',
  'web_fetch',
  'web_search'
] as const

export type WProviderToolName = (typeof WPROVIDER_TOOL_NAMES)[number]

export interface WProviderTextToolCall {
  id: string
  name: WProviderToolName
  args: Record<string, unknown>
}

export interface ParsedWProviderTextToolCall {
  call: WProviderTextToolCall
  block: string
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

export function isWProviderToolName(name: string): name is WProviderToolName {
  return (WPROVIDER_TOOL_NAMES as readonly string[]).includes(name)
}

/**
 * `run_typescript` follows Mistral's native convention: the supplied program
 * defines `main()` and the host invokes it once. Keep the wrapper shared so
 * local, SSH and Blueprint executions have identical behaviour.
 */
export function wrapWProviderTypescript(code: string): string {
  return `${code}\n\n;Promise.resolve().then(() => {\n  if (typeof main !== 'function') {\n    throw new Error('run_typescript code must define a main() function.')\n  }\n  return main()\n}).then((value) => {\n  if (value !== undefined) {\n    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))\n  }\n}).catch((error) => {\n  console.error(error instanceof Error ? error.stack || error.message : String(error))\n  process.exitCode = 1\n})\n`
}

/** True when text appears to be a tool request even if its JSON cannot be parsed. */
export function hasWProviderToolCallIntent(content: string): boolean {
  return (
    /```tool_call\b/i.test(content) ||
    /(?:^|\n)\s*tool_call\s*(?:\{|\n|$)/i.test(content) ||
    /\{\s*"(?:tool|name)"\s*:/.test(content)
  )
}

function safeArgs(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Escape raw LF/CR/TAB characters that models sometimes put inside JSON strings. */
function escapeControlCharacters(text: string): string {
  let output = ''
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (!inString) {
      if (character === '"') inString = true
      output += character
    } else if (character === '\\') {
      output += character + (text[index + 1] ?? '')
      index += 1
    } else if (character === '"') {
      inString = false
      output += character
    } else if (character === '\n') output += '\\n'
    else if (character === '\r') output += '\\r'
    else if (character === '\t') output += '\\t'
    else output += character
  }
  return output
}

function toolCallFromJson(text: string): WProviderTextToolCall | null {
  const trimmed = text.trim()
  for (const candidate of [trimmed, escapeControlCharacters(trimmed)]) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>
      const name = asString(value.tool) || asString(value.name)
      if (!isWProviderToolName(name)) return null
      const rawArgs = value.args ?? value.arguments ?? {}
      const args =
        rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : safeArgs(asString(rawArgs))
      return { id: `call_${Math.random().toString(36).slice(2, 9)}`, name, args }
    } catch {
      // Retry once with escaped control characters.
    }
  }
  return null
}

function scanJsonObject(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (character === '\\') index += 1
      else if (character === '"') inString = false
    } else if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

/**
 * Parse a fenced `tool_call`/`json` block, or salvage a bare balanced JSON
 * object. Both the regular renderer loop and background Blueprints use this so
 * WProvider accepts exactly the same text protocol in either surface.
 */
export function parseWProviderTextToolCall(content: string): ParsedWProviderTextToolCall | null {
  const fence = content.match(/```(?:tool_call|json)?\s*([\s\S]*?)```/i)
  if (fence) {
    const call = toolCallFromJson(fence[1])
    if (call) return { call, block: fence[0] }
  }

  const start = content.search(/\{\s*"(?:tool|name)"\s*:/)
  if (start < 0) return null
  const json = scanJsonObject(content, start)
  const call = json ? toolCallFromJson(json) : null
  if (!json || !call) return null
  const before = /(?:`{1,3})?(?:tool_call|json)?\s*$/i.exec(content.slice(0, start))
  const after = /^\s*`{0,3}/.exec(content.slice(start + json.length))
  return { call, block: `${before?.[0] ?? ''}${json}${after?.[0] ?? ''}` }
}
