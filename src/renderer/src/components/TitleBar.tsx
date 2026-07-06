import { useEffect, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'
import { tr } from '@/language'
import type { ChangelogInfo, UpdateInfo } from '@shared/ipc'

/** Re-check the release feed every 4 hours while the app stays open. */
const UPDATE_POLL_MS = 4 * 60 * 60 * 1000

export function TitleBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const goHome = useApp((s) => s.goHome)
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [changelogOpen, setChangelogOpen] = useState(false)
  // null while the changelog is being fetched for the open modal.
  const [changelog, setChangelog] = useState<ChangelogInfo | null>(null)

  // Check for a newer build on launch, then poll periodically so a long-running
  // session still notices a freshly published release.
  useEffect(() => {
    let cancelled = false
    const check = async (): Promise<void> => {
      const info = await api.update.check().catch(() => null)
      if (!cancelled && info) setUpdate(info)
    }
    void check()
    const timer = setInterval(check, UPDATE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const updateAvailable = update?.updateAvailable === true

  // Open the changelog modal and (re)fetch the list of newer releases; the
  // download button falls back to the badge's own URL if the fetch fails.
  const openChangelog = (): void => {
    setChangelogOpen(true)
    setChangelog(null)
    api.update
      .changelog()
      .then(setChangelog)
      .catch(() => setChangelog({ ok: false, releases: [] }))
  }

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <button
          className="logo"
          title={t('title.toggleSidebar')}
          aria-label={t('title.toggleSidebar')}
          onClick={toggleSidebar}
        >
          A
        </button>
        <button
          className="nav-btn"
          title={t('title.back')}
          onClick={goHome}
          disabled={view === 'home'}
          style={{ opacity: view === 'home' ? 0.4 : 1 }}
        >
          <Icon name="arrowLeft" size={15} />
        </button>
        <button className="nav-btn" title={t('title.forward')}>
          <Icon name="arrowRight" size={15} />
        </button>
        {updateAvailable && (
          <button
            className="update-badge"
            title={t('title.updateAvailable', { version: update?.latest ?? '' })}
            onClick={openChangelog}
          >
            <span className="dot" />
            {t('title.update')}
          </button>
        )}
      </div>

      <div className="titlebar-drag" />

      <div className="win-controls">
        <button className="win-btn" title={t('title.minimize')} onClick={() => api.window.minimize()}>
          <Icon name="minimize" size={15} />
        </button>
        <button className="win-btn" title={t('title.maximize')} onClick={() => api.window.maximizeToggle()}>
          <Icon name="maximize" size={13} />
        </button>
        <button className="win-btn close" title={t('title.close')} onClick={() => api.window.close()}>
          <Icon name="close" size={15} />
        </button>
      </div>

      {changelogOpen && (
        <div className="modal-backdrop" onClick={() => setChangelogOpen(false)}>
          <div className="modal modal-update" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              {t('update.title', { version: update?.latest ?? '' })}
              <button
                className="modal-close"
                onClick={() => setChangelogOpen(false)}
                title={t('common.close')}
              >
                <Icon name="x" size={15} />
              </button>
            </div>

            <div className="modal-body">
              {!changelog && <div className="field-hint">{t('update.loading')}</div>}
              {changelog && !changelog.ok && (
                <div className="field-hint">{t('update.loadFailed')}</div>
              )}
              {changelog?.ok && changelog.releases.length > 0 && (
                <div className="update-release-list">
                  {changelog.releases.map((r) => (
                    <div className="update-release" key={r.version}>
                      <div className="update-release-head">
                        <span className="update-release-version">{r.version}</span>
                        {r.date && (
                          <span className="update-release-date">
                            {new Date(r.date).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {r.notes && <div className="update-release-notes">{r.notes}</div>}
                    </div>
                  ))}
                </div>
              )}

              <div className="update-modal-actions">
                <span className="field-hint">
                  {t('update.currentVersion', { version: update?.current ?? '' })}
                </span>
                <button
                  className="btn update-download-btn"
                  onClick={() => api.update.openDownload(changelog?.url ?? update?.url)}
                >
                  {t('update.download')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
