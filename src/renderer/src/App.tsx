import { useEffect, type JSX } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { LeftRail } from '@/components/LeftRail'
import { StatusBar } from '@/components/StatusBar'
import { ConnectionSettings } from '@/components/ConnectionSettings'
import { CopilotAuthModal } from '@/components/CopilotAuthModal'
import { SkillsModal } from '@/components/SkillsModal'
import { SshModal } from '@/components/SshModal'
import { UsageModal } from '@/components/UsageModal'
import { HomeView } from '@/views/HomeView'
import { WorkspaceView } from '@/views/WorkspaceView'
import { AnalyticsView } from '@/views/AnalyticsView'
import { OmnirouteView } from '@/views/OmnirouteView'
import { VpnView } from '@/views/VpnView'
import { useApp } from '@/state/store'
import { api } from '@/lib/api'

export function App(): JSX.Element {
  const view = useApp((s) => s.view)
  const init = useApp((s) => s.init)
  const themePreference = useApp((s) => s.themePreference)
  const syncSystemTheme = useApp((s) => s.syncSystemTheme)
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed)
  const handlePreviewWindowClosed = useApp((s) => s.handlePreviewWindowClosed)

  useEffect(() => {
    void init()
  }, [init])

  // Keep store state in sync when the user closes the detached preview window.
  useEffect(() => api.live.onWindowClosed(handlePreviewWindowClosed), [handlePreviewWindowClosed])

  useEffect(() => {
    if (themePreference !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => syncSystemTheme()
    media.addEventListener('change', sync)
    sync()
    return () => media.removeEventListener('change', sync)
  }, [syncSystemTheme, themePreference])

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <TitleBar />
      <div className="body">
        <LeftRail />
        <div className="main">
          {view === 'analytics' ? (
            <AnalyticsView />
          ) : view === 'vpn' ? (
            <VpnView />
          ) : view === 'omniroute' ? (
            <OmnirouteView />
          ) : view === 'home' ? (
            <HomeView />
          ) : (
            <WorkspaceView />
          )}
          <StatusBar />
        </div>
      </div>
      <ConnectionSettings />
      <CopilotAuthModal />
      <SkillsModal />
      <SshModal />
      <UsageModal />
    </div>
  )
}
