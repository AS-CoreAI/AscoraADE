import { useEffect, useRef, useState, type JSX } from 'react'
import type { TaskSummary, Workspace } from '@shared/ipc'
import { Icon } from './Icon'
import { SshRail } from './SshRail'
import { useApp, type ThemePreference } from '@/state/store'

/** A workspace row plus the tasks to show under it (filtered while searching). */
interface VisibleWorkspace {
  ws: Workspace
  tasks: TaskSummary[]
  collapsed: boolean
}

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
  // While an SSH host is the active context, the workspace/task highlight steps
  // aside so only one thing reads as "active" at a time.
  const activeSsh = useApp((s) => s.activeSsh)
  const collapsedWorkspaces = useApp((s) => s.collapsedWorkspaces)
  const openFolder = useApp((s) => s.openFolder)
  const openWorkspace = useApp((s) => s.openWorkspace)
  const toggleWorkspaceCollapsed = useApp((s) => s.toggleWorkspaceCollapsed)
  const reorderWorkspaces = useApp((s) => s.reorderWorkspaces)
  const openTask = useApp((s) => s.openTask)
  const deleteTask = useApp((s) => s.deleteTask)
  const newTask = useApp((s) => s.newTask)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const view = useApp((s) => s.view)
  const openAnalytics = useApp((s) => s.openAnalytics)
  const closeAnalytics = useApp((s) => s.closeAnalytics)
  const setSkillsOpen = useApp((s) => s.setSkillsOpen)
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

  const openSearch = (): void => {
    setSearchOpen(true)
    // Focus after the input has mounted/rendered.
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  const closeSearch = (): void => {
    setSearchOpen(false)
    setSearch('')
  }

  // Ctrl/Cmd+K opens the workspace search and focuses the field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.focus())
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const query = search.trim().toLowerCase()
  const isSearching = query.length > 0
  // While searching, keep only workspaces that match by name or hold a matching
  // task, force the group open, and narrow the task list to the matches.
  const visibleWorkspaces: VisibleWorkspace[] = workspaces.flatMap((ws) => {
    const tasks = tasksByWorkspace[ws.id] ?? []
    if (!isSearching) return [{ ws, tasks, collapsed: !!collapsedWorkspaces[ws.id] }]
    const nameMatch = ws.name.toLowerCase().includes(query)
    const matchedTasks = tasks.filter((task) => task.title.toLowerCase().includes(query))
    if (!nameMatch && matchedTasks.length === 0) return []
    return [{ ws, tasks: nameMatch ? tasks : matchedTasks, collapsed: false }]
  })

  return (
    <div className="rail">
      <div className="rail-actions">
        <button className="rail-action" onClick={newTask}>
          <Icon name="plus" size={16} />
          New task
          <span className="kbd">Ctrl+N</span>
        </button>
        <button className="rail-action search" onClick={openSearch}>
          <Icon name="search" size={16} />
          Search
          <span className="kbd">Ctrl+K</span>
        </button>
        <button className="rail-action" onClick={() => setSkillsOpen(true)}>
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
          <button
            className={searchOpen ? 'active' : undefined}
            title="Search workspaces"
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
          >
            <Icon name="search" size={13} />
          </button>
          <button title="Archived">
            <Icon name="archive" size={13} />
          </button>
        </span>
      </div>

      {searchOpen && (
        <div className="rail-search">
          <Icon name="search" size={13} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search workspaces & tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch()
            }}
          />
          <button
            className="rail-search-clear"
            title="Close search"
            aria-label="Close search"
            onClick={closeSearch}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      <div className="rail-scroll">
        {workspaces.length === 0 && !isSearching && (
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

        {isSearching && visibleWorkspaces.length === 0 && (
          <div className="task-empty">No matches for “{search.trim()}”</div>
        )}

        {visibleWorkspaces.map(({ ws, tasks, collapsed }) => {
          return (
            <div className="ws-group" key={ws.id}>
              <div
                className={`ws-item${active?.id === ws.id && !activeSsh ? ' active' : ''}${
                  dragId === ws.id ? ' dragging' : ''
                }${dragOverId === ws.id && dragId !== ws.id ? ' drag-over' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDragId(ws.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragId && dragOverId !== ws.id) setDragOverId(ws.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId) reorderWorkspaces(dragId, ws.id)
                  setDragId(null)
                  setDragOverId(null)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDragOverId(null)
                }}
                onClick={() => openWorkspace(ws)}
                title={ws.path}
              >
                <span
                  className="ws-twisty"
                  role="button"
                  aria-label={collapsed ? 'Expand folder' : 'Collapse folder'}
                  title={collapsed ? 'Expand' : 'Collapse'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleWorkspaceCollapsed(ws.id)
                  }}
                >
                  <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                </span>
                <Icon name="folder" size={15} />
                <span className="name">{ws.name}</span>
              </div>
              {!collapsed &&
                tasks.map((task) => (
                  <div
                    className={`task-item${activeTaskId === task.id && !activeSsh ? ' active' : ''}`}
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openTask(ws, task.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openTask(ws, task.id)
                      }
                    }}
                    title={task.title}
                  >
                    <span className={`task-dot ${task.status}`} />
                    <span className="name">{task.title}</span>
                    <span className="time">{formatTaskTime(task.updatedAt)}</span>
                    <button
                      className="task-delete"
                      title="Delete task"
                      aria-label="Delete task"
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteTask(ws, task.id)
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              {!collapsed && tasks.length === 0 && (
                <div className="task-empty">No tasks yet</div>
              )}
            </div>
          )
        })}
      </div>

      <SshRail />

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
          className={`rail-settings${view === 'analytics' ? ' active' : ''}`}
          title="Analytics"
          aria-label="Analytics"
          onClick={() => (view === 'analytics' ? closeAnalytics() : openAnalytics())}
        >
          <Icon name="barChart" size={17} />
        </button>
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
