import { useEffect, useRef, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useApp, type ThemePreference } from '@/state/store'

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' }
]

function formatTaskTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }
  return new Intl.DateTimeFormat(undefined, options).format(date)
}

export function LeftRail(): JSX.Element {
  const workspaces = useApp((s) => s.workspaces)
  const active = useApp((s) => s.active)
  const tasksByWorkspace = useApp((s) => s.tasksByWorkspace)
  const activeTaskId = useApp((s) => s.activeTaskId)
  const openFolder = useApp((s) => s.openFolder)
  const openWorkspace = useApp((s) => s.openWorkspace)
  const openTask = useApp((s) => s.openTask)
  const newTask = useApp((s) => s.newTask)
  const themePreference = useApp((s) => s.themePreference)
  const setThemePreference = useApp((s) => s.setThemePreference)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!themeMenuOpen) return
    const close = (event: MouseEvent): void => {
      if (!themeMenuRef.current?.contains(event.target as Node)) setThemeMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setThemeMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [themeMenuOpen])

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

        {workspaces.map((ws) => {
          const tasks = tasksByWorkspace[ws.id] ?? []
          return (
            <div className="ws-group" key={ws.id}>
              <button
                className={`ws-item${active?.id === ws.id ? ' active' : ''}`}
                onClick={() => openWorkspace(ws)}
                title={ws.path}
              >
                <Icon name="folder" size={15} />
                <span className="name">{ws.name}</span>
              </button>
              {tasks.map((task) => (
                <button
                  className={`task-item${activeTaskId === task.id ? ' active' : ''}`}
                  key={task.id}
                  onClick={() => openTask(ws, task.id)}
                  title={task.title}
                >
                  <span className={`task-dot ${task.status}`} />
                  <span className="name">{task.title}</span>
                  <span className="time">{formatTaskTime(task.updatedAt)}</span>
                </button>
              ))}
              {tasks.length === 0 && <div className="task-empty">No tasks yet</div>}
            </div>
          )
        })}
      </div>

      <div className="rail-footer" ref={themeMenuRef}>
        {themeMenuOpen && (
          <div className="theme-menu" role="menu" aria-label="Theme">
            <div className="theme-menu-label">Theme</div>
            {THEMES.map((theme) => (
              <button
                className="theme-option"
                key={theme.value}
                role="menuitemradio"
                aria-checked={themePreference === theme.value}
                onClick={() => {
                  setThemePreference(theme.value)
                  setThemeMenuOpen(false)
                }}
              >
                <span>{theme.label}</span>
                {themePreference === theme.value && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        )}
        <button
          className={`rail-settings${themeMenuOpen ? ' active' : ''}`}
          title="Appearance settings"
          aria-label="Appearance settings"
          aria-expanded={themeMenuOpen}
          onClick={() => setThemeMenuOpen((open) => !open)}
        >
          <Icon name="settings" size={17} />
        </button>
      </div>
    </div>
  )
}
