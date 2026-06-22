import { useEffect, useRef, type FunctionComponent, type JSX } from 'react'
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps
} from 'dockview-react'
import 'dockview/dist/styles/dockview.css'
import { Explorer } from './Explorer'
import { GitPanel } from './GitPanel'
import { EditorPane } from './EditorPane'
import { TerminalPanel } from './TerminalPanel'
import { AgentChat } from './AgentChat'
import { LivePreview } from './LivePreview'
import { useApp } from '@/state/store'

/**
 * VS Code-style dockable layout. Every view (Explorer, Source Control, Editor,
 * Terminal, Chat and the Live Preview) is a dockview panel the user can drag by
 * its tab to split, stack or re-dock anywhere. The arrangement is serialized to
 * the store so it survives switching to the full-screen chat and back.
 */

// Module-scope so the component identities stay stable across renders.
const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  explorer: () => <Explorer />,
  git: () => <GitPanel />,
  editor: () => <EditorPane />,
  terminal: () => <TerminalPanel />,
  chat: () => <AgentChat />,
  preview: () => <LivePreview />
}

/** Add or remove the Live Preview panel so it matches the store's preview state. */
function reconcilePreview(api: DockviewApi): void {
  const { previewUrl, previewMode } = useApp.getState()
  const want = !!previewUrl && previewMode === 'docked'
  const panel = api.getPanel('preview')
  if (want && !panel) {
    api.addPanel({
      id: 'preview',
      component: 'preview',
      title: 'Live Preview',
      initialWidth: 480,
      position: { referencePanel: api.getPanel('editor') ? 'editor' : undefined, direction: 'right' }
    })
  } else if (!want && panel) {
    api.removePanel(panel)
  }
}

function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'editor', component: 'editor', title: 'Editor' })
  api.addPanel({
    id: 'explorer',
    component: 'explorer',
    title: 'Explorer',
    initialWidth: 260,
    position: { referencePanel: 'editor', direction: 'left' }
  })
  api.addPanel({
    id: 'git',
    component: 'git',
    title: 'Source Control',
    position: { referencePanel: 'explorer', direction: 'within' }
  })
  api.addPanel({
    id: 'chat',
    component: 'chat',
    title: 'Chat',
    initialWidth: 380,
    position: { referencePanel: 'editor', direction: 'right' }
  })
  api.addPanel({
    id: 'terminal',
    component: 'terminal',
    title: 'Terminal',
    initialHeight: 200,
    position: { referencePanel: 'editor', direction: 'below' }
  })
}

export function DockLayout({ focus }: { focus: 'explorer' | 'git' }): JSX.Element {
  const apiRef = useRef<DockviewApi | null>(null)
  const disposables = useRef<{ dispose: () => void }[]>([])
  const focusRef = useRef(focus)
  focusRef.current = focus

  const resolvedTheme = useApp((s) => s.resolvedTheme)
  const previewUrl = useApp((s) => s.previewUrl)
  const previewMode = useApp((s) => s.previewMode)
  const setDockLayout = useApp((s) => s.setDockLayout)

  const onReady = (event: DockviewReadyEvent): void => {
    const api = event.api
    apiRef.current = api

    const saved = useApp.getState().dockLayout
    let restored = false
    if (saved) {
      try {
        api.fromJSON(saved as Parameters<DockviewApi['fromJSON']>[0])
        restored = api.panels.length > 0
      } catch {
        restored = false
      }
    }
    if (!restored) buildDefaultLayout(api)

    reconcilePreview(api)
    api.getPanel(focusRef.current)?.api.setActive()

    disposables.current = [
      // Persist the arrangement on every drag/resize/split.
      api.onDidLayoutChange(() => setDockLayout(api.toJSON())),
      // Sync the store when the user closes the preview tab by hand.
      api.onDidRemovePanel((panel) => {
        if (panel.id !== 'preview') return
        const s = useApp.getState()
        if (s.previewUrl && s.previewMode === 'docked') s.closePreview()
      })
    ]
  }

  useEffect(
    () => () => {
      disposables.current.forEach((d) => d.dispose())
      disposables.current = []
    },
    []
  )

  // Mirror the store's preview state into the dock once the api exists.
  useEffect(() => {
    if (apiRef.current) reconcilePreview(apiRef.current)
  }, [previewUrl, previewMode])

  // Activity-bar switches focus the matching tab.
  useEffect(() => {
    apiRef.current?.getPanel(focus)?.api.setActive()
  }, [focus])

  return (
    <div className="dock-host">
      <DockviewReact
        components={components}
        onReady={onReady}
        theme={resolvedTheme === 'dark' ? themeDark : themeLight}
      />
    </div>
  )
}
