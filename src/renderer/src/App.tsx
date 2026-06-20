import { useEffect, type JSX } from 'react'
import { TitleBar } from '@/components/TitleBar'
import { LeftRail } from '@/components/LeftRail'
import { StatusBar } from '@/components/StatusBar'
import { ConnectionSettings } from '@/components/ConnectionSettings'
import { HomeView } from '@/views/HomeView'
import { WorkspaceView } from '@/views/WorkspaceView'
import { useApp } from '@/state/store'

export function App(): JSX.Element {
  const view = useApp((s) => s.view)
  const init = useApp((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <LeftRail />
        <div className="main">
          {view === 'home' ? <HomeView /> : <WorkspaceView />}
          <StatusBar />
        </div>
      </div>
      <ConnectionSettings />
    </div>
  )
}
