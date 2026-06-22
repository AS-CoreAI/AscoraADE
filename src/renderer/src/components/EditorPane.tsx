import { useEffect, useState, type JSX, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import Editor from '@monaco-editor/react'
import { Icon } from './Icon'
import { FileIcon } from './FileIcon'
import { useApp } from '@/state/store'
import '@/monaco-setup'

/** Estimated menu box, used to keep it inside the window when opened near an edge. */
const MENU_W = 170
const MENU_H = 116

export function EditorPane(): JSX.Element {
  const openFiles = useApp((s) => s.openFiles)
  const activeFile = useApp((s) => s.activeFile)
  const resolvedTheme = useApp((s) => s.resolvedTheme)
  const setActiveFile = useApp((s) => s.setActiveFile)
  const closeFile = useApp((s) => s.closeFile)
  const closeOtherFiles = useApp((s) => s.closeOtherFiles)
  const closeFilesToRight = useApp((s) => s.closeFilesToRight)
  const closeAllFiles = useApp((s) => s.closeAllFiles)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  const current = openFiles.find((f) => f.path === activeFile)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    // Any outside click/scroll/resize dismisses the menu.
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const openMenu = (e: MouseEvent, path: string): void => {
    e.preventDefault()
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(e.clientY, window.innerHeight - MENU_H - 8),
      path
    })
  }

  /** Run a close action and dismiss the menu. */
  const run = (action: () => void): void => {
    action()
    setMenu(null)
  }

  const menuIndex = menu ? openFiles.findIndex((f) => f.path === menu.path) : -1
  const hasRight = menuIndex !== -1 && menuIndex < openFiles.length - 1
  const hasOthers = openFiles.length > 1

  return (
    <div className="panel">
      <div className="tabs">
        {openFiles.map((f) => (
          <div
            key={f.path}
            className={`tab${activeFile === f.path ? ' active' : ''}`}
            onClick={() => setActiveFile(f.path)}
            onContextMenu={(e) => openMenu(e, f.path)}
            title={f.path}
          >
            <FileIcon name={f.name} size={13} />
            {f.name}
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                closeFile(f.path)
              }}
            >
              <Icon name="x" size={12} />
            </span>
          </div>
        ))}
      </div>

      {menu &&
        createPortal(
          <div
            className="context-menu"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
          <button
            type="button"
            role="menuitem"
            className="context-item"
            disabled={!hasRight}
            onClick={() => run(() => closeFilesToRight(menu.path))}
          >
            Close to the Right
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-item"
            disabled={!hasOthers}
            onClick={() => run(() => closeOtherFiles(menu.path))}
          >
            Close Others
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-item"
            onClick={() => run(closeAllFiles)}
          >
            Close All
          </button>
          </div>,
          document.body
        )}

      {current ? (
        <div className="editor-host">
          <Editor
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
            path={current.path}
            language={current.language}
            value={current.content}
            options={{
              readOnly: true,
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              renderWhitespace: 'selection',
              automaticLayout: true
            }}
          />
        </div>
      ) : (
        <div className="editor-empty">
          Select a file in the Explorer to view it here.
        </div>
      )}
    </div>
  )
}
