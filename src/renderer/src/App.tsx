import { useEffect, type JSX } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { LeftRail } from '@/components/LeftRail'
import { StatusBar } from '@/components/StatusBar'
import { ConnectionSettings } from '@/components/ConnectionSettings'
import { HomeView } from '@/views/HomeView'
import { WorkspaceView } from '@/views/WorkspaceView'
import { AnalyticsView } from '@/views/AnalyticsView'
import { useApp } from '@/state/store'

export function App(): JSX.Element {
  const view = useApp((s) => s.view)
  const init = useApp((s) => s.init)
  const themePreference = useApp((s) => s.themePreference)
  const syncSystemTheme = useApp((s) => s.syncSystemTheme)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (themePreference !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => syncSystemTheme()
    media.addEventListener('change', sync)
    sync()
    return () => media.removeEventListener('change', sync)
  }, [syncSystemTheme, themePreference])

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <LeftRail />
        <div className="main">
          {view === 'analytics' ? (
            <AnalyticsView />
          ) : view === 'home' ? (
            <HomeView />
          ) : (
            <WorkspaceView />
          )}
          <StatusBar />
        </div>
      </div>
      <ConnectionSettings />
    </div>
  )
}
