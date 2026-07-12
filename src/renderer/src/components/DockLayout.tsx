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
import { SshTerminal } from './SshTerminal'
import { BlueprintStudio } from './BlueprintStudio'
import { BlueprintHub } from './BlueprintHub'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import { useBlueprints } from '@/state/blueprints'
import { tr, type TranslationKey } from '@/language'

/**
 * VS Code-style dockable IDE. There is a single dock: the Chat is the home panel
 * (shown full by default), and the activity bar docks Explorer / Source Control
 * in alongside it on demand. Opened panels persist — switching focus back to the
 * chat does not close them. Every panel can be dragged by its tab to split,
 * stack or re-dock anywhere. The arrangement is serialized to the store so it
 * survives leaving and returning to the workspace view.
 */

const TITLE_KEYS: Record<string, TranslationKey> = {
  explorer: 'dock.explorer',
  git: 'dock.sourceControl',
  editor: 'dock.editor',
  terminal: 'dock.terminal',
  chat: 'dock.chat',
  blueprint: 'dock.blueprint',
  blueprintHub: 'dock.blueprint',
  preview: 'dock.livePreview'
}

const GIT_PANEL_INITIAL_WIDTH = 760
const GIT_PANEL_READABLE_WIDTH = 620

function titleOf(id: keyof typeof TITLE_KEYS): string {
  return tr(useApp.getState().appLanguage, TITLE_KEYS[id])
}

// Module-scope so the component identities stay stable across renders.
const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  explorer: () => <Explorer />,
  git: () => <GitPanel />,
  editor: () => <EditorPane />,
  terminal: () => <TerminalPanel />,
  chat: () => <AgentChat full />,
  blueprint: () => <BlueprintStudio />,
  blueprintHub: () => <BlueprintHub />,
  preview: () => <LivePreview />,
  ssh: (props) => <SshTerminal connId={String((props.params as { connId?: string })?.connId ?? '')} />
}

const SSH_PREFIX = 'ssh-'

/** First of `ids` that currently has a panel, used to anchor new panels. */
function firstExisting(api: DockviewApi, ids: string[]): string | undefined {
  return ids.find((id) => api.getPanel(id))
}

function ensureGitPanelWidth(panel: NonNullable<ReturnType<DockviewApi['getPanel']>>): void {
  const currentWidth = panel.api.group.api.boundingBox?.width
  if (currentWidth !== undefined && currentWidth >= GIT_PANEL_READABLE_WIDTH) return
  panel.api.group.api.setSize({ width: GIT_PANEL_INITIAL_WIDTH })
}

/** Focus a panel, opening it docked (in a sensible spot) if it isn't open yet. */
function focusOrOpen(api: DockviewApi, id: 'explorer' | 'git' | 'chat' | 'blueprint' | 'blueprintHub'): void {
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    if (id === 'git') ensureGitPanelWidth(existing)
    return
  }
  if (id === 'chat' || id === 'blueprint' || id === 'blueprintHub') {
    const ref = firstExisting(api, id === 'chat' ? ['editor', 'explorer', 'git', 'blueprintHub', 'blueprint'] : ['chat', 'editor', 'explorer', 'git'])
    if (ref) api.addPanel({ id, component: id, title: titleOf(id), position: { referencePanel: ref, direction: 'right' } })
    else api.addPanel({ id, component: id, title: titleOf(id) })
    return
  }
  // explorer | git — share one left-hand sidebar group (tabbed together).
  const other = id === 'explorer' ? 'git' : 'explorer'
  if (api.getPanel(other)) {
    const panel = api.addPanel({
      id,
      component: id,
      title: titleOf(id),
      position: { referencePanel: other, direction: 'within' }
    })
    if (id === 'git') ensureGitPanelWidth(panel)
    return
  }
  const ref = firstExisting(api, ['editor', 'chat'])
  const initialWidth = id === 'git' ? GIT_PANEL_INITIAL_WIDTH : 260
  if (ref) {
    api.addPanel({
      id,
      component: id,
      title: titleOf(id),
      initialWidth,
      position: { referencePanel: ref, direction: 'left' }
    })
  } else {
    api.addPanel({ id, component: id, title: titleOf(id), initialWidth })
  }
}

/** Open the editor (and a terminal beneath it) once files are open. */
function ensureEditor(api: DockviewApi): void {
  if (!api.getPanel('editor')) {
    const ref = firstExisting(api, ['chat', 'explorer', 'git'])
    if (ref === 'chat') api.addPanel({ id: 'editor', component: 'editor', title: titleOf('editor'), position: { referencePanel: 'chat', direction: 'left' } })
    else if (ref) api.addPanel({ id: 'editor', component: 'editor', title: titleOf('editor'), position: { referencePanel: ref, direction: 'right' } })
    else api.addPanel({ id: 'editor', component: 'editor', title: titleOf('editor') })
  }
  if (!useApp.getState().activeSsh && !api.getPanel('terminal')) {
    api.addPanel({ id: 'terminal', component: 'terminal', title: titleOf('terminal'), initialHeight: 200, position: { referencePanel: 'editor', direction: 'below' } })
  }
}

/** Open (or focus) the local terminal panel — used by the Explorer's "Run". */
function ensureTerminal(api: DockviewApi): void {
  if (useApp.getState().activeSsh) return // the local terminal is hidden over SSH
  const existing = api.getPanel('terminal')
  if (existing) {
    existing.api.setActive()
    return
  }
  const ref = firstExisting(api, ['editor', 'chat', 'explorer', 'git'])
  if (ref) {
    api.addPanel({ id: 'terminal', component: 'terminal', title: titleOf('terminal'), initialHeight: 200, position: { referencePanel: ref, direction: 'below' } })
  } else {
    api.addPanel({ id: 'terminal', component: 'terminal', title: titleOf('terminal'), initialHeight: 200 })
  }
}

/** Add/remove SSH terminal panels so they match the store's open list. */
function reconcileSsh(api: DockviewApi): void {
  const state = useApp.getState()
  const localTerminal = api.getPanel('terminal')
  if (state.activeSsh && localTerminal) api.removePanel(localTerminal)
  for (const connId of state.openSshTerminals) {
    const panelId = `${SSH_PREFIX}${connId}`
    const existing = api.getPanel(panelId)
    if (existing) {
      existing.api.setActive()
      continue
    }
    const conn = state.sshConnections.find((c) => c.id === connId)
    const title = conn ? conn.name : 'SSH'
    const ref = firstExisting(api, ['editor', 'chat', 'explorer', 'git'])
    if (ref === 'editor') api.addPanel({ id: panelId, component: 'ssh', title, params: { connId }, position: { referencePanel: 'editor', direction: 'within' } })
    else if (ref) api.addPanel({ id: panelId, component: 'ssh', title, params: { connId }, position: { referencePanel: ref, direction: 'left' } })
    else api.addPanel({ id: panelId, component: 'ssh', title, params: { connId } })
  }
  // Remove panels for sessions that are no longer open.
  for (const panel of api.panels) {
    if (panel.id.startsWith(SSH_PREFIX) && !state.openSshTerminals.includes(panel.id.slice(SSH_PREFIX.length))) {
      api.removePanel(panel)
    }
  }
}

/** Add or remove the Live Preview panel so it matches the store's preview state. */
function reconcilePreview(api: DockviewApi): void {
  const { previewUrl, previewMode } = useApp.getState()
  const want = !!previewUrl && previewMode === 'docked'
  const panel = api.getPanel('preview')
  if (want && !panel) {
    const ref = firstExisting(api, ['editor', 'chat'])
    if (ref) api.addPanel({ id: 'preview', component: 'preview', title: titleOf('preview'), initialWidth: 480, position: { referencePanel: ref, direction: 'right' } })
    else api.addPanel({ id: 'preview', component: 'preview', title: titleOf('preview'), initialWidth: 480 })
  } else if (!want && panel) {
    api.removePanel(panel)
  }
}

export function DockLayout(): JSX.Element {
  const apiRef = useRef<DockviewApi | null>(null)
  const disposables = useRef<{ dispose: () => void }[]>([])
  const [activeId, setActiveId] = useState<string | undefined>('chat')

  const resolvedTheme = useApp((s) => s.resolvedTheme)
  const appLanguage = useApp((s) => s.appLanguage)
  const previewUrl = useApp((s) => s.previewUrl)
  const previewMode = useApp((s) => s.previewMode)
  const openFilesLen = useApp((s) => s.openFiles.length)
  const openSshTerminals = useApp((s) => s.openSshTerminals)
  const activeSsh = useApp((s) => s.activeSsh)
  const terminalRequest = useApp((s) => s.terminalRequest)
  const setDockLayout = useApp((s) => s.setDockLayout)
  const blueprintRequest = useBlueprints((s) => s.openRequest)

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
    if (!restored) {
      const initial = useApp.getState().view === 'blueprint' ? 'blueprint' : 'chat'
      api.addPanel({ id: initial, component: initial, title: titleOf(initial) })
    }
    if (useApp.getState().view === 'blueprint') focusOrOpen(api, 'blueprint')

    if (useApp.getState().openFiles.length > 0) ensureEditor(api)
    reconcilePreview(api)
    reconcileSsh(api)
    setActiveId(api.activePanel?.id)
    if (api.activePanel?.id === 'git') ensureGitPanelWidth(api.activePanel)

    disposables.current = [
      api.onDidLayoutChange(() => setDockLayout(api.toJSON())),
      api.onDidActivePanelChange(() => {
        const id = api.activePanel?.id
        setActiveId(id)
        if (id === 'git' && api.activePanel) ensureGitPanelWidth(api.activePanel)
        // Focusing an SSH terminal makes the whole IDE target that remote host.
        if (id?.startsWith(SSH_PREFIX)) {
          const connId = id.slice(SSH_PREFIX.length)
          const state = useApp.getState()
          if (!state.streaming && state.active?.id !== `ssh:${connId}`) void state.loadSshData(connId)
          else useApp.setState({ activeSsh: connId })
        }
      }),
      api.onDidRemovePanel((panel) => {
        const s = useApp.getState()
        if (panel.id === 'preview') {
          if (s.previewUrl && s.previewMode === 'docked') s.closePreview()
        } else if (panel.id.startsWith(SSH_PREFIX)) {
          const connId = panel.id.slice(SSH_PREFIX.length)
          if (s.openSshTerminals.includes(connId)) s.closeSshTerminal(connId)
        }
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
  }, [openFilesLen, activeSsh])

  // Mirror the store's preview state into the dock.
  useEffect(() => {
    if (apiRef.current) reconcilePreview(apiRef.current)
  }, [previewUrl, previewMode])

  // Mirror the store's open SSH terminals into the dock.
  useEffect(() => {
    if (apiRef.current) reconcileSsh(apiRef.current)
  }, [openSshTerminals, activeSsh])

  // Surface the terminal when the Explorer asks to run a file in it.
  useEffect(() => {
    if (apiRef.current && terminalRequest) ensureTerminal(apiRef.current)
  }, [terminalRequest])

  // A Blueprint selected in the global rail should focus the singleton studio panel.
  useEffect(() => {
    if (apiRef.current && blueprintRequest > 0) focusOrOpen(apiRef.current, 'blueprint')
  }, [blueprintRequest])

  const open = (id: 'explorer' | 'git' | 'chat' | 'blueprint' | 'blueprintHub'): void => {
    if (apiRef.current) focusOrOpen(apiRef.current, id)
  }

  return (
    <div className="workspace" style={{ display: 'flex' }}>
      <div className="activity-bar">
        <button
          className={`activity-btn${activeId === 'chat' ? ' active' : ''}`}
          title={tr(appLanguage, 'dock.chat')}
          onClick={() => open('chat')}
        >
          <Icon name="message" size={19} />
        </button>
        <button
          className={`activity-btn${activeId === 'explorer' ? ' active' : ''}`}
          title={tr(appLanguage, 'dock.explorer')}
          onClick={() => open('explorer')}
        >
          <Icon name="folder" size={19} />
        </button>
        <button
          className={`activity-btn${activeId === 'git' ? ' active' : ''}`}
          title={tr(appLanguage, 'dock.sourceControl')}
          onClick={() => open('git')}
        >
          <Icon name="gitBranch" size={19} />
        </button>
        <button
          className={`activity-btn${activeId === 'blueprintHub' ? ' active' : ''}`}
          title={tr(appLanguage, 'dock.blueprint')}
          onClick={() => {
            useApp.setState({ view: 'blueprint' })
            open('blueprintHub')
          }}
        >
          <Icon name="blueprint" size={19} />
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
