import type { JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import { tr } from '@/language'

/** SSH hosts section in the left rail, shown under Workspaces. */
export function SshRail(): JSX.Element {
  const connections = useApp((s) => s.sshConnections)
  const activeSsh = useApp((s) => s.activeSsh)
  const openSshModal = useApp((s) => s.openSshModal)
  const openSshTerminal = useApp((s) => s.openSshTerminal)
  const deleteSshConnection = useApp((s) => s.deleteSshConnection)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)

  return (
    <div className="ssh-rail">
      <div className="rail-section">
        SSH
        <span className="actions">
          <button title={t('ssh.addConnection')} onClick={() => openSshModal()}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      </div>
      <div className="ssh-rail-list">
        {connections.length === 0 ? (
          <button className="task-item" style={{ paddingLeft: 14 }} onClick={() => openSshModal()}>
            <Icon name="plus" size={14} />
            <span className="name">{t('ssh.addHost')}</span>
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
              {activeSsh === conn.id && <span className="ssh-active-dot" title={t('ssh.activeContext')} />}
              <button
                className="task-delete"
                title={t('common.edit')}
                aria-label={t('ssh.editConnection')}
                onClick={(e) => {
                  e.stopPropagation()
                  openSshModal(conn)
                }}
              >
                <Icon name="settings" size={13} />
              </button>
              <button
                className="task-delete"
                title={t('common.delete')}
                aria-label={t('ssh.deleteConnection')}
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(t('ssh.deleteConfirm', { name: conn.name }))) {
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
