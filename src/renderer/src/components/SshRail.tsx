import type { JSX } from 'react'
import { Icon } from './Icon'
import { useApp, sshWorkspaceId, type AppLanguage } from '@/state/store'
import { localeForLanguage, tr } from '@/language'

function formatChatTime(timestamp: number, language: AppLanguage): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }
  return new Intl.DateTimeFormat(localeForLanguage(language), options).format(date)
}

/** SSH hosts section in the left rail, shown under Workspaces. */
export function SshRail(): JSX.Element {
  const connections = useApp((s) => s.sshConnections)
  const activeSsh = useApp((s) => s.activeSsh)
  const activeTaskId = useApp((s) => s.activeTaskId)
  const tasksByWorkspace = useApp((s) => s.tasksByWorkspace)
  const collapsedWorkspaces = useApp((s) => s.collapsedWorkspaces)
  const toggleWorkspaceCollapsed = useApp((s) => s.toggleWorkspaceCollapsed)
  const openSshModal = useApp((s) => s.openSshModal)
  const openSshTerminal = useApp((s) => s.openSshTerminal)
  const deleteSshConnection = useApp((s) => s.deleteSshConnection)
  const openSshTask = useApp((s) => s.openSshTask)
  const newSshTask = useApp((s) => s.newSshTask)
  const deleteSshTask = useApp((s) => s.deleteSshTask)
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
          connections.map((conn) => {
            const wsId = sshWorkspaceId(conn.id)
            const chats = tasksByWorkspace[wsId] ?? []
            const collapsed = !!collapsedWorkspaces[wsId]
            return (
              <div className="ws-group" key={conn.id}>
                <div
                  className={`ssh-item${activeSsh === conn.id ? ' active' : ''}`}
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
                  <span
                    className="ws-twisty"
                    role="button"
                    aria-label={collapsed ? t('rail.expandFolder') : t('rail.collapseFolder')}
                    title={collapsed ? t('rail.expand') : t('rail.collapse')}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleWorkspaceCollapsed(wsId)
                    }}
                  >
                    <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                  </span>
                  <Icon name="terminal" size={14} />
                  <span className="name">{conn.name}</span>
                  {activeSsh === conn.id && <span className="ssh-active-dot" title={t('ssh.activeContext')} />}
                  <button
                    className="task-delete"
                    title={t('ssh.newChat')}
                    aria-label={t('ssh.newChat')}
                    onClick={(e) => {
                      e.stopPropagation()
                      newSshTask(conn.id)
                    }}
                  >
                    <Icon name="plus" size={13} />
                  </button>
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
                {!collapsed &&
                  chats.map((chat) => (
                    <div
                      className={`task-item${
                        activeTaskId === chat.id && activeSsh === conn.id ? ' active' : ''
                      }`}
                      key={chat.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void openSshTask(conn.id, chat.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void openSshTask(conn.id, chat.id)
                        }
                      }}
                      title={chat.title}
                    >
                      <span className={`task-dot ${chat.status}`} />
                      <span className="name">{chat.title}</span>
                      <span className="time">{formatChatTime(chat.updatedAt, appLanguage)}</span>
                      <button
                        className="task-delete"
                        title={t('ssh.deleteChat')}
                        aria-label={t('ssh.deleteChat')}
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteSshTask(conn.id, chat.id)
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  ))}
                {!collapsed && chats.length === 0 && (
                  <div className="task-empty">{t('ssh.noChatsYet')}</div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
