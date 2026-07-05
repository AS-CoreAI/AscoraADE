import { useEffect, useRef, useState, type DragEvent, type JSX, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode } from '@shared/ipc'
import { Icon } from './Icon'
import { FileIcon } from './FileIcon'
import { useApp, isRunnableFile } from '@/state/store'
import { api } from '@/lib/api'
import { tr } from '@/language'

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
  draggingPath,
  dropTargetPath,
  onItemContextMenu,
  onSubmitEdit,
  onCancelEdit,
  onDragStartNode,
  onDragOverNode,
  onDragLeaveNode,
  onDropNode,
  onDragEndNode
}: {
  node: TreeNode
  depth: number
  editSession: EditSession | null
  draggingPath: string | null
  dropTargetPath: string | null
  onItemContextMenu: (event: MouseEvent, node: TreeNode) => void
  onSubmitEdit: (value: string) => void
  onCancelEdit: () => void
  onDragStartNode: (event: DragEvent<HTMLDivElement>, node: TreeNode) => void
  onDragOverNode: (event: DragEvent<HTMLDivElement>, node: TreeNode) => void
  onDragLeaveNode: (event: DragEvent<HTMLDivElement>, node: TreeNode) => void
  onDropNode: (event: DragEvent<HTMLDivElement>, node: TreeNode) => void
  onDragEndNode: () => void
}): JSX.Element {
  const isDir = node.type === 'directory'
  const expanded = useApp((s) => !!s.expanded[node.path])
  const children = useApp((s) => s.childrenByPath[node.path])
  const activeFile = useApp((s) => s.activeFile)
  const toggleDir = useApp((s) => s.toggleDir)
  const openFile = useApp((s) => s.openFile)

  const isRenaming = editSession?.mode === 'rename' && editSession.node.path === node.path
  const isDragging = draggingPath === node.path
  const isDropTarget = dropTargetPath === node.path
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
          className={`tree-row${!isDir && activeFile === node.path ? ' active' : ''}${
            isDragging ? ' dragging' : ''
          }${isDropTarget ? ' drop-target' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          draggable
          onDragStart={(event) => onDragStartNode(event, node)}
          onDragOver={(event) => onDragOverNode(event, node)}
          onDragLeave={(event) => onDragLeaveNode(event, node)}
          onDrop={(event) => onDropNode(event, node)}
          onDragEnd={onDragEndNode}
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
              draggingPath={draggingPath}
              dropTargetPath={dropTargetPath}
              onItemContextMenu={onItemContextMenu}
              onSubmitEdit={onSubmitEdit}
              onCancelEdit={onCancelEdit}
              onDragStartNode={onDragStartNode}
              onDragOverNode={onDragOverNode}
              onDragLeaveNode={onDragLeaveNode}
              onDropNode={onDropNode}
              onDragEndNode={onDragEndNode}
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
  const treeError = useApp((s) => s.treeError)
  const openFolder = useApp((s) => s.openFolder)
  const refreshDirectory = useApp((s) => s.refreshDirectory)
  const goUpDirectory = useApp((s) => s.goUpDirectory)
  const toggleSshElevation = useApp((s) => s.toggleSshElevation)
  const elevated = useApp((s) => (s.activeSsh ? !!s.sshElevated[s.activeSsh] : false))
  const createFile = useApp((s) => s.createFile)
  const createDirectory = useApp((s) => s.createDirectory)
  const renamePath = useApp((s) => s.renamePath)
  const movePath = useApp((s) => s.movePath)
  const deleteFilePath = useApp((s) => s.deleteFilePath)
  const deleteDirectoryPath = useApp((s) => s.deleteDirectoryPath)
  const renameOpenFile = useApp((s) => s.renameOpenFile)
  const renameOpenPathPrefix = useApp((s) => s.renameOpenPathPrefix)
  const openFile = useApp((s) => s.openFile)
  const runFile = useApp((s) => s.runFile)
  const closeFile = useApp((s) => s.closeFile)
  const closeFilesUnder = useApp((s) => s.closeFilesUnder)
  const toggleDir = useApp((s) => s.toggleDir)
  const expanded = useApp((s) => s.expanded)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    node: TreeNode
    workspaceRoot?: boolean
  } | null>(null)
  const [edit, setEdit] = useState<EditSession | null>(null)
  const [dragNode, setDragNode] = useState<TreeNode | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

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
    // Approximate menu height for off-screen clamping: a runnable local file gets
    // an extra "Run" row (~36px) on top of the usual three file items.
    const fileHeight = !activeSsh && isRunnableFile(node.name) ? 144 : 108
    const height = node.type === 'file' ? fileHeight : workspaceRoot ? 108 : 168
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - height),
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

  const runMenuFile = (): void => {
    if (!menu || menu.node.type !== 'file') return
    const node = menu.node
    setMenu(null)
    runFile(node)
  }

  const parentPath = (path: string): string => {
    const trimmed = path.replace(/[\\/]+$/, '')
    if (!trimmed) return path
    const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    if (index < 0) return path
    if (index === 0) return trimmed.slice(0, 1)
    const parent = trimmed.slice(0, index)
    return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent
  }

  const comparablePath = (path: string): string => {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return activeSsh || api.system.platform !== 'win32' ? normalized : normalized.toLowerCase()
  }

  const isSamePath = (a: string, b: string): boolean => comparablePath(a) === comparablePath(b)

  const isPathInside = (parent: string, child: string): boolean => {
    const normalizedParent = comparablePath(parent)
    return comparablePath(child).startsWith(`${normalizedParent}/`)
  }

  const canMoveToDirectory = (source: TreeNode | null, targetDirectoryPath: string): boolean => {
    if (!source) return false
    if (isSamePath(source.path, targetDirectoryPath)) return false
    if (isSamePath(parentPath(source.path), targetDirectoryPath)) return false
    if (source.type === 'directory' && isPathInside(source.path, targetDirectoryPath)) return false
    return true
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

  const finishDrag = (): void => {
    setDragNode(null)
    setDropTargetPath(null)
  }

  const moveNodeToDirectory = async (source: TreeNode, target: TreeNode): Promise<void> => {
    const sourceParent = parentPath(source.path)
    const result = await movePath(source.path, target.path)
    if (!result.ok || !result.path) {
      window.alert(result.error ?? `Failed to move ${source.type}.`)
      return
    }
    if (source.type === 'file') renameOpenFile(source.path, result.path, source.name)
    else renameOpenPathPrefix(source.path, result.path)
    await refreshDirectory(sourceParent)
    await refreshDirectory(target.path)
    if (!expanded[target.path]) await toggleDir(target)
  }

  const startNodeDrag = (event: DragEvent<HTMLDivElement>, node: TreeNode): void => {
    setMenu(null)
    setEdit(null)
    setDragNode(node)
    setDropTargetPath(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-ascora-tree-path', node.path)
    event.dataTransfer.setData('text/plain', node.path)
  }

  const dragOverNode = (event: DragEvent<HTMLDivElement>, node: TreeNode): void => {
    if (node.type !== 'directory' || !canMoveToDirectory(dragNode, node.path)) {
      if (dragNode) event.dataTransfer.dropEffect = 'none'
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (dropTargetPath !== node.path) setDropTargetPath(node.path)
  }

  const leaveDragNode = (event: DragEvent<HTMLDivElement>, node: TreeNode): void => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    if (dropTargetPath === node.path) setDropTargetPath(null)
  }

  const dropOnNode = (event: DragEvent<HTMLDivElement>, node: TreeNode): void => {
    const source = dragNode
    if (!source || node.type !== 'directory' || !canMoveToDirectory(source, node.path)) {
      finishDrag()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    finishDrag()
    void moveNodeToDirectory(source, node)
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
                  ? t('explorer.runRootOn')
                  : t('explorer.runRootOff')
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
                  title={t('explorer.upOneLevel')}
                  disabled={!canGoUp}
                  style={{ opacity: canGoUp ? 1 : 0.4 }}
                  onClick={() => void goUpDirectory()}
                >
                  <Icon name="arrowUp" size={14} />
                </button>
              )
            })()}
            <button title={t('explorer.refreshRemote')} onClick={() => active?.path && void refreshDirectory(active.path)}>
              <Icon name="refresh" size={14} />
            </button>
          </>
        ) : (
          <button title={t('explorer.openFolder')} onClick={openFolder}>
            <Icon name="folder" size={14} />
          </button>
        )}
      </div>
      <div className="panel-body" onContextMenu={openPanelContextMenu}>
        {loading && <div className="tree-empty">{t('explorer.loading')}</div>}
        {!loading && activeSsh && treeError && (
          <div className="tree-error" title={treeError}>
            {treeError}
            {/elevation|permission|denied|not permitted|sudo/i.test(treeError) && !elevated && (
              <>
                {' '}
                <button type="button" className="tree-error-action" onClick={() => void toggleSshElevation()}>
                  {t('explorer.tryAsRoot')}
                </button>
              </>
            )}
          </div>
        )}
        {!loading && roots.length === 0 && !edit && (
          <div className="tree-empty">
            {activeSsh ? t('explorer.noRemoteFiles') : t('explorer.noFiles')}
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
              draggingPath={dragNode?.path ?? null}
              dropTargetPath={dropTargetPath}
              onItemContextMenu={openContextMenu}
              onSubmitEdit={submitEdit}
              onCancelEdit={cancelEdit}
              onDragStartNode={startNodeDrag}
              onDragOverNode={dragOverNode}
              onDragLeaveNode={leaveDragNode}
              onDropNode={dropOnNode}
              onDragEndNode={finishDrag}
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
                {t('explorer.openInFileExplorer')}
              </button>
            )}
            {menu.node.type === 'file' && (
              <>
                {!activeSsh && isRunnableFile(menu.node.name) && (
                  <button type="button" role="menuitem" className="context-item" onClick={runMenuFile}>
                    {t('explorer.run')}
                  </button>
                )}
                <button type="button" role="menuitem" className="context-item" onClick={beginRename}>
                  {t('explorer.rename')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-item context-item-danger"
                  onClick={() => void deleteFile()}
                >
                  {t('common.delete')}
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
                  {t('explorer.newFile')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="context-item"
                  onClick={() => void beginCreate('directory')}
                >
                  {t('explorer.newFolder')}
                </button>
                {!menu.workspaceRoot && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="context-item"
                      onClick={beginRename}
                    >
                      {t('explorer.rename')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="context-item context-item-danger"
                      onClick={() => void deleteDirectory()}
                    >
                      {t('common.delete')}
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
