import type { UsageEvent } from '@shared/ipc'

/**
 * Approximate public API prices in USD per 1M tokens (input / output).
 * First matching rule wins; model names are matched lowercased.
 * Anthropic prices per platform.claude.com (mid-2026); others are estimates
 * from public pricing pages — treat every figure here as an estimate.
 */
interface PriceRule {
  match: RegExp
  input: number
  output: number
}

const PRICE_RULES: PriceRule[] = [
  // Anthropic
  { match: /fable|mythos/, input: 10, output: 50 },
  { match: /opus/, input: 5, output: 25 },
  { match: /sonnet/, input: 3, output: 15 },
  { match: /haiku/, input: 1, output: 5 },
  // OpenAI
  { match: /gpt-?5\.?\d.*(mini|nano)|gpt-?4.*mini/, input: 0.25, output: 2 },
  { match: /gpt-?5|codex/, input: 1.25, output: 10 },
  { match: /o[34](-|$)/, input: 2, output: 8 },
  { match: /gpt-?4/, input: 2.5, output: 10 },
  // Google
  { match: /gemini.*(flash|lite)/, input: 0.15, output: 0.6 },
  { match: /gemini/, input: 1.25, output: 10 },
  // Others
  { match: /deepseek/, input: 0.28, output: 1.1 },
  { match: /glm/, input: 0.6, output: 2.2 },
  { match: /qwen/, input: 0.4, output: 1.2 },
  { match: /grok/, input: 3, output: 15 },
  { match: /mistral|magistral|devstral/, input: 2, output: 6 },
  { match: /llama/, input: 0.2, output: 0.6 }
]

/** Reference rate for models we can't identify (small generic API price). */
const DEFAULT_RATE = { input: 0.5, output: 1.5 }

/** Providers that don't bill per token: local runtimes and web chats. */
export const FREE_PROVIDERS: ReadonlySet<string> = new Set(['lmstudio', 'ollama', 'unsloth', 'wprovider'])

export function modelRate(model: string): { input: number; output: number } {
  const name = model.toLowerCase()
  for (const rule of PRICE_RULES) {
    if (rule.match.test(name)) return { input: rule.input, output: rule.output }
  }
  return DEFAULT_RATE
}

/** API-equivalent price of one usage event in USD (regardless of provider). */
export function eventCostUsd(e: UsageEvent): number {
  const rate = modelRate(e.model)
  return (e.inputTokens * rate.input + e.outputTokens * rate.output) / 1e6
}

/** Compact dollar label, e.g. $1.2K / $45.30 / $0.07 / <$0.01. */
export function formatUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  if (n >= 0.01 || n === 0) return `$${n.toFixed(2)}`
  return '<$0.01'
}
