import type { JSX } from 'react'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'

export function TitleBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const goHome = useApp((s) => s.goHome)
  const toggleSidebar = useApp((s) => s.toggleSidebar)

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <button
          className="logo"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
        >
          A
        </button>
        <button
          className="nav-btn"
          title="Back"
          onClick={goHome}
          disabled={view === 'home'}
          style={{ opacity: view === 'home' ? 0.4 : 1 }}
        >
          <Icon name="arrowLeft" size={15} />
        </button>
        <button className="nav-btn" title="Forward">
          <Icon name="arrowRight" size={15} />
        </button>
        <span className="update-badge">
          <span className="dot" />
          Update
        </span>
      </div>

      <div className="titlebar-drag" />

      <div className="win-controls">
        <button className="win-btn" title="Minimize" onClick={() => api.window.minimize()}>
          <Icon name="minimize" size={15} />
        </button>
        <button className="win-btn" title="Maximize" onClick={() => api.window.maximizeToggle()}>
          <Icon name="maximize" size={13} />
        </button>
        <button className="win-btn close" title="Close" onClick={() => api.window.close()}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  )
}
