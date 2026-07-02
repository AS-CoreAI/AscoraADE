import { type JSX } from 'react'
import { Icon } from './Icon'
import { resetLabel } from './StatusBar'
import { useApp, type AppLanguage } from '@/state/store'
import { api } from '@/lib/api'
import { localeForLanguage, tr } from '@/language'
import type { UsageLimitWindow } from '@shared/ipc'

/** Where the "view detailed usage" link sends the user. */
const USAGE_PAGE = 'https://claude.ai/settings/usage'

/** Bar-fill modifier for a window's server-assessed severity. */
function severityClass(severity: string): string {
  if (severity === 'critical') return ' crit'
  return severity === 'normal' ? '' : ' warn'
}

/** "Resets in 5h · Jun 30, 9:00 PM" — relative window plus the local clock time. */
function resetDetail(iso: string | undefined, language: AppLanguage): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const rel = resetLabel(iso, language)
  const abs = d.toLocaleString(localeForLanguage(language), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `${rel.charAt(0).toUpperCase()}${rel.slice(1)} · ${abs}`
}

function UsageItem({ win }: { win: UsageLimitWindow }): JSX.Element {
  const appLanguage = useApp((s) => s.appLanguage)
  const reset = resetDetail(win.resetsAt, appLanguage)
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
 * Subscription/account usage breakdown: a bar per limit window with reset
 * times. Opened from the status-bar usage indicator.
 */
export function UsageModal(): JSX.Element | null {
  const open = useApp((s) => s.usageOpen)
  const setOpen = useApp((s) => s.setUsageOpen)
  const provider = useApp((s) => s.provider)
  const codexUsage = useApp((s) => s.codexUsage)
  const claudeUsage = useApp((s) => s.claudeUsage)
  const refreshCodex = useApp((s) => s.refreshCodexUsage)
  const refreshClaude = useApp((s) => s.refreshClaudeUsage)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)

  if (!open) return null

  const isCodex = provider === 'codex'
  const usage = isCodex ? codexUsage : claudeUsage
  const refresh = isCodex ? refreshCodex : refreshClaude
  const title = isCodex ? t('usage.codexTitle') : t('usage.claudeTitle')
  const windows = usage?.windows ?? []

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal modal-usage" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {title}
          <button className="modal-close" onClick={() => setOpen(false)} title={t('common.close')}>
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
                ? t('usage.signIn', { name: isCodex ? 'Codex' : 'Claude Code' })
                : usage?.error
                  ? usage.error
                  : t('usage.empty')}
            </div>
          )}

          <div className="usage-footer">
            {!isCodex && (
              <button className="usage-link" onClick={() => void api.live.openExternal(USAGE_PAGE)}>
                <Icon name="external" size={12} /> {t('usage.detailed')}
              </button>
            )}
            <button className="btn btn-icon" onClick={() => void refresh()}>
              <Icon name="refresh" size={13} /> {t('common.refresh')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
