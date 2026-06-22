import { useEffect, useRef, useState, type FunctionComponent, type JSX } from 'react'
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
import { Icon } from './Icon'
import { useApp } from '@/state/store'

/**
 * VS Code-style dockable IDE. There is a single dock: the Chat is the home panel
 * (shown full by default), and the activity bar docks Explorer / Source Control
 * in alongside it on demand. Opened panels persist — switching focus back to the
 * chat does not close them. Every panel can be dragged by its tab to split,
 * stack or re-dock anywhere. The arrangement is serialized to the store so it
 * survives leaving and returning to the workspace view.
 */

const TITLES: Record<string, string> = {
  explorer: 'Explorer',
  git: 'Source Control',
  editor: 'Editor',
  terminal: 'Terminal',
  chat: 'Chat',
  preview: 'Live Preview'
}

// Module-scope so the component identities stay stable across renders.
const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  explorer: () => <Explorer />,
  git: () => <GitPanel />,
  editor: () => <EditorPane />,
  terminal: () => <TerminalPanel />,
  chat: () => <AgentChat full />,
  preview: () => <LivePreview />
}

/** First of `ids` that currently has a panel, used to anchor new panels. */
function firstExisting(api: DockviewApi, ids: string[]): string | undefined {
  return ids.find((id) => api.getPanel(id))
}

/** Focus a panel, opening it docked (in a sensible spot) if it isn't open yet. */
function focusOrOpen(api: DockviewApi, id: 'explorer' | 'git' | 'chat'): void {
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  if (id === 'chat') {
    const ref = firstExisting(api, ['editor', 'explorer', 'git'])
    if (ref) api.addPanel({ id, component: id, title: TITLES.chat, position: { referencePanel: ref, direction: 'right' } })
    else api.addPanel({ id, component: id, title: TITLES.chat })
    return
  }
  // explorer | git — share one left-hand sidebar group (tabbed together).
  const other = id === 'explorer' ? 'git' : 'explorer'
  if (api.getPanel(other)) {
    api.addPanel({ id, component: id, title: TITLES[id], position: { referencePanel: other, direction: 'within' } })
    return
  }
  const ref = firstExisting(api, ['editor', 'chat'])
  if (ref) api.addPanel({ id, component: id, title: TITLES[id], initialWidth: 260, position: { referencePanel: ref, direction: 'left' } })
  else api.addPanel({ id, component: id, title: TITLES[id], initialWidth: 260 })
}

/** Open the editor (and a terminal beneath it) once files are open. */
function ensureEditor(api: DockviewApi): void {
  if (api.getPanel('editor')) return
  const ref = firstExisting(api, ['chat', 'explorer', 'git'])
  if (ref === 'chat') api.addPanel({ id: 'editor', component: 'editor', title: TITLES.editor, position: { referencePanel: 'chat', direction: 'left' } })
  else if (ref) api.addPanel({ id: 'editor', component: 'editor', title: TITLES.editor, position: { referencePanel: ref, direction: 'right' } })
  else api.addPanel({ id: 'editor', component: 'editor', title: TITLES.editor })
  api.addPanel({ id: 'terminal', component: 'terminal', title: TITLES.terminal, initialHeight: 200, position: { referencePanel: 'editor', direction: 'below' } })
}

/** Add or remove the Live Preview panel so it matches the store's preview state. */
function reconcilePreview(api: DockviewApi): void {
  const { previewUrl, previewMode } = useApp.getState()
  const want = !!previewUrl && previewMode === 'docked'
  const panel = api.getPanel('preview')
  if (want && !panel) {
    const ref = firstExisting(api, ['editor', 'chat'])
    if (ref) api.addPanel({ id: 'preview', component: 'preview', title: TITLES.preview, initialWidth: 480, position: { referencePanel: ref, direction: 'right' } })
    else api.addPanel({ id: 'preview', component: 'preview', title: TITLES.preview, initialWidth: 480 })
  } else if (!want && panel) {
    api.removePanel(panel)
  }
}

export function DockLayout(): JSX.Element {
  const apiRef = useRef<DockviewApi | null>(null)
  const disposables = useRef<{ dispose: () => void }[]>([])
  const [activeId, setActiveId] = useState<string | undefined>('chat')

  const resolvedTheme = useApp((s) => s.resolvedTheme)
  const previewUrl = useApp((s) => s.previewUrl)
  const previewMode = useApp((s) => s.previewMode)
  const openFilesLen = useApp((s) => s.openFiles.length)
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
    if (!restored) api.addPanel({ id: 'chat', component: 'chat', title: TITLES.chat })

    if (useApp.getState().openFiles.length > 0) ensureEditor(api)
    reconcilePreview(api)
    setActiveId(api.activePanel?.id)

    disposables.current = [
      api.onDidLayoutChange(() => setDockLayout(api.toJSON())),
      api.onDidActivePanelChange(() => setActiveId(api.activePanel?.id)),
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

  // Open the editor when the user opens a file from the Explorer.
  useEffect(() => {
    if (apiRef.current && openFilesLen > 0) ensureEditor(apiRef.current)
  }, [openFilesLen])

  // Mirror the store's preview state into the dock.
  useEffect(() => {
    if (apiRef.current) reconcilePreview(apiRef.current)
  }, [previewUrl, previewMode])

  const open = (id: 'explorer' | 'git' | 'chat'): void => {
    if (apiRef.current) focusOrOpen(apiRef.current, id)
  }

  return (
    <div className="workspace" style={{ display: 'flex' }}>
      <div className="activity-bar">
        <button
          className={`activity-btn${activeId === 'chat' ? ' active' : ''}`}
          title="Chat"
          onClick={() => open('chat')}
        >
          <Icon name="message" size={19} />
        </button>
        <button
          className={`activity-btn${activeId === 'explorer' ? ' active' : ''}`}
          title="Explorer"
          onClick={() => open('explorer')}
        >
          <Icon name="folder" size={19} />
        </button>
        <button
          className={`activity-btn${activeId === 'git' ? ' active' : ''}`}
          title="Source Control"
          onClick={() => open('git')}
        >
          <Icon name="gitBranch" size={19} />
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="dock-host">
          <DockviewReact
            components={components}
            onReady={onReady}
            theme={resolvedTheme === 'dark' ? themeDark : themeLight}
          />
        </div>
      </div>
    </div>
  )
}
