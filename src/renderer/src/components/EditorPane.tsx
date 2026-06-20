import type { JSX } from 'react'
import Editor from '@monaco-editor/react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import '@/monaco-setup'

export function EditorPane(): JSX.Element {
  const openFiles = useApp((s) => s.openFiles)
  const activeFile = useApp((s) => s.activeFile)
  const resolvedTheme = useApp((s) => s.resolvedTheme)
  const setActiveFile = useApp((s) => s.setActiveFile)
  const closeFile = useApp((s) => s.closeFile)

  const current = openFiles.find((f) => f.path === activeFile)

  return (
    <div className="panel">
      <div className="tabs">
        {openFiles.map((f) => (
          <div
            key={f.path}
            className={`tab${activeFile === f.path ? ' active' : ''}`}
            onClick={() => setActiveFile(f.path)}
            title={f.path}
          >
            <Icon name="file" size={13} />
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
