/**
 * Tiny, dependency-free line diff for the agent's write_file preview. Not a full
 * LCS diff — it trims the common prefix/suffix and shows the changed hunk with a
 * little surrounding context. Good enough for an at-a-glance "Approve?" card.
 */

export interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  text: string
}

const CONTEXT = 2
const MAX_LINES = 240

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  if (oldText === newText) return []
  const o = oldText.length ? oldText.split('\n') : []
  const n = newText.length ? newText.split('\n') : []

  let p = 0
  while (p < o.length && p < n.length && o[p] === n[p]) p += 1
  let s = 0
  while (s < o.length - p && s < n.length - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s += 1

  const out: DiffLine[] = []
  for (let i = Math.max(0, p - CONTEXT); i < p; i += 1) out.push({ type: 'ctx', text: o[i] })
  for (let i = p; i < o.length - s; i += 1) out.push({ type: 'del', text: o[i] })
  for (let i = p; i < n.length - s; i += 1) out.push({ type: 'add', text: n[i] })
  const tail = o.length - s
  for (let i = tail; i < Math.min(o.length, tail + CONTEXT); i += 1) out.push({ type: 'ctx', text: o[i] })

  if (out.length > MAX_LINES) {
    const trimmed = out.slice(0, MAX_LINES)
    trimmed.push({ type: 'ctx', text: `… ${out.length - MAX_LINES} more lines` })
    return trimmed
  }
  return out
}
