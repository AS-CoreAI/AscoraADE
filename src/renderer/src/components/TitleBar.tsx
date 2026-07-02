import { useEffect, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'
import { tr } from '@/language'
import type { UpdateInfo } from '@shared/ipc'

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
            onClick={() => api.update.openDownload(update?.url)}
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
    </div>
  )
}
