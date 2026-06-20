import type { JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'

export function LeftRail(): JSX.Element {
  const workspaces = useApp((s) => s.workspaces)
  const active = useApp((s) => s.active)
  const openFolder = useApp((s) => s.openFolder)
  const openWorkspace = useApp((s) => s.openWorkspace)
  const newTask = useApp((s) => s.newTask)

  return (
    <div className="rail">
      <div className="rail-actions">
        <button className="rail-action" onClick={newTask}>
          <Icon name="plus" size={16} />
          New task
          <span className="kbd">Ctrl+N</span>
        </button>
        <button className="rail-action search">
          <Icon name="search" size={16} />
          Search
          <span className="kbd">Ctrl+K</span>
        </button>
        <button className="rail-action">
          <Icon name="sparkles" size={16} />
          Skills
        </button>
      </div>

      <div className="rail-section">
        Workspaces
        <span className="actions">
          <button title="Add folder" onClick={openFolder}>
            <Icon name="plus" size={14} />
          </button>
          <button title="Filter">
            <Icon name="filter" size={13} />
          </button>
          <button title="Search workspaces">
            <Icon name="search" size={13} />
          </button>
          <button title="Archived">
            <Icon name="archive" size={13} />
          </button>
        </span>
      </div>

      <div className="rail-scroll">
        {workspaces.length === 0 && (
          <button
            className="task-item"
            style={{ paddingLeft: 14 }}
            onClick={openFolder}
            title="Open a project folder"
          >
            <Icon name="plus" size={14} />
            <span className="name">Open a folder…</span>
          </button>
        )}

        {workspaces.map((ws) => (
          <div className="ws-group" key={ws.id}>
            <button
              className={`ws-item${active?.id === ws.id ? ' active' : ''}`}
              onClick={() => openWorkspace(ws)}
              title={ws.path}
            >
              <Icon name="folder" size={15} />
              <span className="name">{ws.name}</span>
            </button>
            <div className="task-empty">No tasks yet</div>
          </div>
        ))}
      </div>

      <div className="update-banner">
        <span className="dot" />
        v0.1.0 — Milestone 1 skeleton
      </div>
    </div>
  )
}
