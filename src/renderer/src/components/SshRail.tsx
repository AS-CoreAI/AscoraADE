import type { JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'

/** SSH hosts section in the left rail, shown under Workspaces. */
export function SshRail(): JSX.Element {
  const connections = useApp((s) => s.sshConnections)
  const activeSsh = useApp((s) => s.activeSsh)
  const openSshModal = useApp((s) => s.openSshModal)
  const openSshTerminal = useApp((s) => s.openSshTerminal)
  const deleteSshConnection = useApp((s) => s.deleteSshConnection)

  return (
    <div className="ssh-rail">
      <div className="rail-section">
        SSH
        <span className="actions">
          <button title="Add SSH connection" onClick={() => openSshModal()}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      </div>
      <div className="ssh-rail-list">
        {connections.length === 0 ? (
          <button className="task-item" style={{ paddingLeft: 14 }} onClick={() => openSshModal()}>
            <Icon name="plus" size={14} />
            <span className="name">Add a host…</span>
          </button>
        ) : (
          connections.map((conn) => (
            <div
              className={`ssh-item${activeSsh === conn.id ? ' active' : ''}`}
              key={conn.id}
              role="button"
              tabIndex={0}
              title={`${conn.username}@${conn.host}:${conn.port || 22}`}
              onClick={() => openSshTerminal(conn.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openSshTerminal(conn.id)
                }
              }}
            >
              <Icon name="terminal" size={14} />
              <span className="name">{conn.name}</span>
              {activeSsh === conn.id && <span className="ssh-active-dot" title="Agent target" />}
              <button
                className="task-delete"
                title="Edit"
                aria-label="Edit connection"
                onClick={(e) => {
                  e.stopPropagation()
                  openSshModal(conn)
                }}
              >
                <Icon name="settings" size={13} />
              </button>
              <button
                className="task-delete"
                title="Delete"
                aria-label="Delete connection"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`Delete SSH connection “${conn.name}”?`)) {
                    deleteSshConnection(conn.id)
                  }
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
