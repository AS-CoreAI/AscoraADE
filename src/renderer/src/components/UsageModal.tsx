import { type JSX } from 'react'
import { Icon } from './Icon'
import { resetLabel } from './StatusBar'
import { useApp } from '@/state/store'
import { api } from '@/lib/api'
import type { ClaudeUsageWindow } from '@shared/ipc'

/** Where the "view detailed usage" link sends the user. */
const USAGE_PAGE = 'https://claude.ai/settings/usage'

/** Bar-fill modifier for a window's server-assessed severity. */
function severityClass(severity: string): string {
  if (severity === 'critical') return ' crit'
  return severity === 'normal' ? '' : ' warn'
}

/** "Resets in 5h · Jun 30, 9:00 PM" — relative window plus the local clock time. */
function resetDetail(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const rel = resetLabel(iso)
  const abs = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `${rel.charAt(0).toUpperCase()}${rel.slice(1)} · ${abs}`
}

function UsageItem({ win }: { win: ClaudeUsageWindow }): JSX.Element {
  const reset = resetDetail(win.resetsAt)
  return (
    <div className="usage-item">
      <div className="usage-item-head">
        <span className="usage-item-label">{win.label}</span>
        <span className="usage-item-pct">{win.percent}%</span>
      </div>
      <div className="usage-bar">
        <div
          className={`usage-bar-fill${severityClass(win.severity)}`}
          style={{ width: `${Math.min(100, Math.max(0, win.percent))}%` }}
        />
      </div>
      {reset && <span className="usage-item-reset">{reset}</span>}
    </div>
  )
}

/**
 * Claude subscription usage breakdown, mirroring the Claude Code IDE extension's
 * popover: a bar per limit window (session / weekly / per-model) with reset
 * times. Opened from the status-bar usage indicator.
 */
export function UsageModal(): JSX.Element | null {
  const open = useApp((s) => s.usageOpen)
  const setOpen = useApp((s) => s.setUsageOpen)
  const usage = useApp((s) => s.claudeUsage)
  const refresh = useApp((s) => s.refreshClaudeUsage)

  if (!open) return null

  const windows = usage?.windows ?? []

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal modal-usage" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Claude usage
          <button className="modal-close" onClick={() => setOpen(false)} title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
          {windows.length > 0 ? (
            <div className="usage-list">
              {windows.map((win) => (
                <UsageItem key={win.label} win={win} />
              ))}
            </div>
          ) : (
            <div className="usage-empty">
              {usage && !usage.loggedIn
                ? 'Sign in to Claude Code to see your subscription usage.'
                : usage?.error
                  ? usage.error
                  : 'No usage data reported yet.'}
            </div>
          )}

          <div className="usage-footer">
            <button className="usage-link" onClick={() => void api.live.openExternal(USAGE_PAGE)}>
              <Icon name="external" size={12} /> Detailed usage
            </button>
            <button className="btn btn-icon" onClick={() => void refresh()}>
              <Icon name="refresh" size={13} /> Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
