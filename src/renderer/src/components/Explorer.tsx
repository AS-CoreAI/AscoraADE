import type { JSX } from 'react'
import type { TreeNode } from '@shared/ipc'
import { Icon } from './Icon'
import { FileIcon } from './FileIcon'
import { useApp } from '@/state/store'

function Row({ node, depth }: { node: TreeNode; depth: number }): JSX.Element {
  const isDir = node.type === 'directory'
  const expanded = useApp((s) => !!s.expanded[node.path])
  const children = useApp((s) => s.childrenByPath[node.path])
  const activeFile = useApp((s) => s.activeFile)
  const toggleDir = useApp((s) => s.toggleDir)
  const openFile = useApp((s) => s.openFile)

  return (
    <>
      <div
        className={`tree-row${!isDir && activeFile === node.path ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => (isDir ? toggleDir(node) : openFile(node))}
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
      {isDir &&
        expanded &&
        (children ?? []).map((child) => <Row key={child.path} node={child} depth={depth + 1} />)}
    </>
  )
}

export function Explorer(): JSX.Element {
  const active = useApp((s) => s.active)
  const roots = useApp((s) => s.treeRoots)
  const loading = useApp((s) => s.treeLoading)
  const openFolder = useApp((s) => s.openFolder)

  return (
    <div className="panel panel-side">
      <div className="panel-header">
        {active?.name ?? 'Explorer'}
        <span className="spacer" />
        <button title="Open folder" onClick={openFolder}>
          <Icon name="folder" size={14} />
        </button>
      </div>
      <div className="panel-body">
        {loading && <div className="tree-empty">Loading…</div>}
        {!loading && roots.length === 0 && (
          <div className="tree-empty">No files to show. Open a project folder to get started.</div>
        )}
        {!loading && roots.map((node) => <Row key={node.path} node={node} depth={0} />)}
      </div>
    </div>
  )
}
