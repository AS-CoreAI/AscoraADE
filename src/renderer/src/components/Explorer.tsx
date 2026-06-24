import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode } from '@shared/ipc'
import { Icon } from './Icon'
import { FileIcon } from './FileIcon'
import { useApp } from '@/state/store'
import { api } from '@/lib/api'

/** An in-tree edit: renaming an existing node, or typing a new child's name. */
type EditSession =
  | { mode: 'rename'; node: TreeNode }
  | { mode: 'create'; parentPath: string; type: 'file' | 'directory' }

/**
 * VS Code-style inline name editor rendered as a tree row. Electron doesn't
 * support `window.prompt`, so rename/create are done with this input instead.
 * Enter commits, Escape cancels, blur commits (an empty value is a no-op).
 */
function InlineInput({
  depth,
  type,
  initialValue,
  selectBasename,
  onSubmit,
  onCancel
}: {
  depth: number
  type: 'file' | 'directory'
  initialValue: string
  selectBasename: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (!initialValue) return
    const dot = initialValue.lastIndexOf('.')
    if (selectBasename && dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initialValue, selectBasename])

  const finish = (commit: boolean): void => {
    if (doneRef.current) return
    doneRef.current = true
    if (commit) onSubmit(value)
    else onCancel()
  }

  return (
    <div className="tree-row tree-row-edit" style={{ paddingLeft: 8 + depth * 12 }}>
      <span className="twisty" />
      <span className="ic">
        {type === 'directory' ? (
          <Icon name="folder" size={15} />
        ) : (
          <FileIcon name={value || 'file'} size={15} />
        )}
      </span>
      <input
        ref={inputRef}
        className="tree-edit-input"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  )
}

function Row({
  node,
  depth,
  editSession,
  onItemContextMenu,
  onSubmitEdit,
  onCancelEdit
}: {
  node: TreeNode
  depth: number
  editSession: EditSession | null
  onItemContextMenu: (event: MouseEvent, node: TreeNode) => void
  onSubmitEdit: (value: string) => void
  onCancelEdit: () => void
}): JSX.Element {
  const isDir = node.type === 'directory'
  const expanded = useApp((s) => !!s.expanded[node.path])
  const children = useApp((s) => s.childrenByPath[node.path])
  const activeFile = useApp((s) => s.activeFile)
  const toggleDir = useApp((s) => s.toggleDir)
  const openFile = useApp((s) => s.openFile)

  const isRenaming = editSession?.mode === 'rename' && editSession.node.path === node.path
  const draft =
    editSession?.mode === 'create' && editSession.parentPath === node.path ? editSession : null

  return (
    <>
      {isRenaming ? (
        <InlineInput
          depth={depth}
          type={node.type}
          initialValue={node.name}
          selectBasename={node.type === 'file'}
          onSubmit={onSubmitEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <div
          className={`tree-row${!isDir && activeFile === node.path ? ' active' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (isDir ? toggleDir(node) : openFile(node))}
          onContextMenu={(event) => onItemContextMenu(event, node)}
          title={node.name}
        >
          <span className="twisty">
            {isDir && <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />}
          </span>
          <span className="ic">
            {isDir ? (
              <Icon name={expanded ? 'folderOpen' : 'folder'} size={15} />
            ) : (
              <FileIcon name={node.name} size={15} />
            )}
          </span>
          <span>{node.name}</span>
        </div>
      )}
      {isDir && expanded && (
        <>
          {draft && (
            <InlineInput
              depth={depth + 1}
              type={draft.type}
              initialValue=""
              selectBasename={false}
              onSubmit={onSubmitEdit}
              onCancel={onCancelEdit}
            />
          )}
          {(children ?? []).map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              editSession={editSession}
              onItemContextMenu={onItemContextMenu}
              onSubmitEdit={onSubmitEdit}
              onCancelEdit={onCancelEdit}
            />
          ))}
        </>
      )}
    </>
  )
}

export function Explorer(): JSX.Element {
  const active = useApp((s) => s.active)
  const activeSsh = useApp((s) => s.activeSsh)
  const roots = useApp((s) => s.treeRoots)
  const loading = useApp((s) => s.treeLoading)
  const openFolder = useApp((s) => s.openFolder)
  const refreshDirectory = useApp((s) => s.refreshDirectory)
  const goUpDirectory = useApp((s) => s.goUpDirectory)
  const toggleSshElevation = useApp((s) => s.toggleSshElevation)
  const elevated = useApp((s) => (s.activeSsh ? !!s.sshElevated[s.activeSsh] : false))
  const createFile = useApp((s) => s.createFile)
  const createDirectory = useApp((s) => s.createDirectory)
  const renamePath = useApp((s) => s.renamePath)
  const deleteFilePath = useApp((s) => s.deleteFilePath)
  const deleteDirectoryPath = useApp((s) => s.deleteDirectoryPath)
  const renameOpenFile = useApp((s) => s.renameOpenFile)
  const renameOpenPathPrefix = useApp((s) => s.renameOpenPathPrefix)
  const openFile = useApp((s) => s.openFile)
  const closeFile = useApp((s) => s.closeFile)
  const closeFilesUnder = useApp((s) => s.closeFilesUnder)
  const toggleDir = useApp((s) => s.toggleDir)
  const expanded = useApp((s) => s.expanded)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    node: TreeNode
    workspaceRoot?: boolean
  } | null>(null)
  const [edit, setEdit] = useState<EditSession | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const openContextMenu = (event: MouseEvent, node: TreeNode, workspaceRoot = false): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(
        event.clientY,
        window.innerHeight - (node.type === 'file' ? 108 : workspaceRoot ? 108 : 168)
      ),
      node,
      workspaceRoot
    })
  }

  const openPanelContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('.tree-row') || !active?.path) return
    openContextMenu(event, { name: active.name, path: active.path, type: 'directory' }, true)
  }

  const openInFileExplorer = (): void => {
    if (!menu || activeSsh) return
    const path = menu.node.path
    setMenu(null)
    void api.fs.openPath(path)
  }

  const parentPath = (path: string): string => {
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return index > 0 ? path.slice(0, index) : path
  }

  const cancelEdit = (): void => setEdit(null)

  const beginRename = (): void => {
    if (!menu || (menu.node.type === 'directory' && menu.workspaceRoot)) return
    const node = menu.node
    setMenu(null)
    setEdit({ mode: 'rename', node })
  }

  const beginCreate = async (type: 'file' | 'directory'): Promise<void> => {
    if (!menu || menu.node.type !== 'directory') return
    const node = menu.node
    const isWorkspaceRoot = menu.workspaceRoot
    setMenu(null)
    // Expand the target so its new draft row is visible. The workspace root's
    // children render at the top level, so it never needs expanding.
    if (!isWorkspaceRoot && !expanded[node.path]) await toggleDir(node)
    setEdit({ mode: 'create', parentPath: node.path, type })
  }

  const submitEdit = async (rawName: string): Promise<void> => {
    const session = edit
    setEdit(null)
    if (!session) return
    const name = rawName.trim()

    if (session.mode === 'rename') {
      const node = session.node
      if (!name || name === node.name) return
      const result = await renamePath(node.path, name, node.type)
      if (!result.ok || !result.path) {
        window.alert(result.error ?? `Failed to rename ${node.type}.`)
        return
      }
      if (node.type === 'file') renameOpenFile(node.path, result.path, name)
      else {
        renameOpenPathPrefix(node.path, result.path)
      }
      await refreshDirectory(parentPath(node.path))
      return
    }

    // create
    if (!name) return
    if (session.type === 'directory') {
      const result = await createDirectory(session.parentPath, name)
      if (!result.ok) {
        window.alert(result.error ?? 'Failed to create folder.')
        return
      }
      await refreshDirectory(session.parentPath)
    } else {
      const result = await createFile(session.parentPath, name)
      if (!result.ok || !result.path) {
        window.alert(result.error ?? 'Failed to create file.')
        return
      }
      await refreshDirectory(session.parentPath)
      await openFile({ name, path: result.path, type: 'file' })
    }
  }

  const deleteFile = async (): Promise<void> => {
    if (!menu || menu.node.type !== 'file') return
    const node = menu.node
    setMenu(null)
    if (!window.confirm(`Delete ${node.name}? This cannot be undone.`)) return
    const result = await deleteFilePath(node.path)
    if (!result.ok) {
      window.alert(result.error ?? 'Failed to delete file.')
      return
    }
    closeFile(node.path)
    await refreshDirectory(parentPath(node.path))
  }

  const deleteDirectory = async (): Promise<void> => {
    if (!menu || menu.node.type !== 'directory' || menu.workspaceRoot) return
    const node = menu.node
    setMenu(null)
    const confirmed = window.confirm(
      `Delete folder ${node.name} and all of its contents? This cannot be undone.`
    )
    if (!confirmed) return
    const result = await deleteDirectoryPath(node.path)
    if (!result.ok) {
      window.alert(result.error ?? 'Failed to delete folder.')
      return
    }
    closeFilesUnder(node.path)
    await refreshDirectory(parentPath(node.path))
  }

  // A "new file/folder" being typed directly at the workspace root (its children
  // are the top-level tree rows, so the draft renders here rather than in a Row).
  const rootDraft =
    edit?.mode === 'create' && active?.path && edit.parentPath === active.path ? edit : null

  return (
    <div className="panel panel-side">
      <div className="panel-header">
        {active?.name ?? 'Explorer'}
        <span className="spacer" />
        {activeSsh ? (
          <>
            <button
              title={
                elevated
                  ? 'Running remote file operations as root (sudo). Click to disable.'
                  : 'Run remote file operations as root (sudo). Requires passwordless sudo or your saved password.'
              }
              aria-pressed={elevated}
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: elevated ? 'var(--accent)' : undefined,
                background: elevated ? 'var(--accent-dim)' : undefined
              }}
              onClick={() => void toggleSshElevation()}
            >
              root
            </button>
            {(() => {
              // Can climb only while the remote root is an absolute path below "/".
              // Stripping trailing slashes turns "/" into "", so it's excluded.
              const canGoUp = (active?.path ?? '').replace(/\/+$/, '').startsWith('/')
              return (
                <button
                  title="Up one level"
                  disabled={!canGoUp}
                  style={{ opacity: canGoUp ? 1 : 0.4 }}
                  onClick={() => void goUpDirectory()}
                >
                  <Icon name="arrowUp" size={14} />
                </button>
              )
            })()}
            <button title="Refresh remote files" onClick={() => active?.path && void refreshDirectory(active.path)}>
              <Icon name="refresh" size={14} />
            </button>
          </>
        ) : (
          <button title="Open folder" onClick={openFolder}>
            <Icon name="folder" size={14} />
          </button>
        )}
      </div>
      <div className="panel-body" onContextMenu={openPanelContextMenu}>
        {loading && <div className="tree-empty">Loading…</div>}
        {!loading && roots.length === 0 && !edit && (
          <div className="tree-empty">
            {activeSsh ? 'No remote files to show.' : 'No files to show. Open a project folder to get started.'}
          </div>
        )}
        {!loading && rootDraft && (
          <InlineInput
            depth={0}
            type={rootDraft.type}
            initialValue=""
            selectBasename={false}
            onSubmit={submitEdit}
            onCancel={cancelEdit}
          />
        )}
        {!loading &&
          roots.map((node) => (
            <Row
              key={node.path}
              node={node}
              depth={0}
              editSession={edit}
              onItemContextMenu={openContextMenu}
              onSubmitEdit={submitEdit}
              onCancelEdit={cancelEdit}
            />
          ))}
      </div>
      {menu &&
        createPortal(
          <div
            className="context-menu"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {!activeSsh && (
              <button
                type="button"
                role="menuitem"
                className="context-item"
                onClick={openInFileExplorer}
              >
                Open in File Explorer
              </button>
            )}
            {menu.node.type === 'file' && (
              <>
                <button type="button" role="menuitem" className="context-item" onClick={beginRename}>
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-item context-item-danger"
                  onClick={() => void deleteFile()}
                >
                  Delete
                </button>
              </>
            )}
            {menu.node.type === 'directory' && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="context-item"
                  onClick={() => void beginCreate('file')}
                >
                  New File
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-item"
                  onClick={() => void beginCreate('directory')}
                >
                  New Folder
                </button>
                {!menu.workspaceRoot && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="context-item"
                      onClick={beginRename}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="context-item context-item-danger"
                      onClick={() => void deleteDirectory()}
                    >
                      Delete
                    </button>
                  </>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
