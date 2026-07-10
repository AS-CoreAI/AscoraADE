import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { TaskSummary, Workspace } from '@shared/ipc'
import { Icon } from './Icon'
import { SshRail } from './SshRail'
import { BlueprintRail } from './BlueprintRail'
import { useApp, type AppLanguage, type ThemePreference } from '@/state/store'
import { api } from '@/lib/api'
import { LANGUAGE_OPTIONS, localeForLanguage, tr, type TranslationKey } from '@/language'

/** A workspace row plus the tasks to show under it (filtered while searching). */
interface VisibleWorkspace {
  ws: Workspace
  tasks: TaskSummary[]
  collapsed: boolean
}

/** How many recent tasks a folder shows before "Show more" reveals the rest. */
const TASK_PREVIEW_COUNT = 5

const THEMES: ThemePreference[] = ['dark', 'light', 'system']
const THEME_LABELS: Record<ThemePreference, TranslationKey> = {
  dark: 'app.theme.dark',
  light: 'app.theme.light',
  system: 'app.theme.system'
}

function formatTaskTime(timestamp: number, language: AppLanguage): string {
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
  const setAllWorkspacesCollapsed = useApp((s) => s.setAllWorkspacesCollapsed)
  const reorderWorkspaces = useApp((s) => s.reorderWorkspaces)
  const renameWorkspace = useApp((s) => s.renameWorkspace)
  const openTask = useApp((s) => s.openTask)
  const deleteTask = useApp((s) => s.deleteTask)
  const restoreTask = useApp((s) => s.restoreTask)
  const newTask = useApp((s) => s.newTask)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number; ws: Workspace } | null>(null)
  const [renamingWorkspace, setRenamingWorkspace] = useState<{ id: string; name: string } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Folders whose full task list is revealed via "Show more" (session-only).
  const [showAllTasks, setShowAllTasks] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archivedTasks, setArchivedTasks] = useState<Record<string, TaskSummary[]>>({})
  const searchInputRef = useRef<HTMLInputElement>(null)
  const view = useApp((s) => s.view)
  const openAnalytics = useApp((s) => s.openAnalytics)
  const closeAnalytics = useApp((s) => s.closeAnalytics)
  const setSkillsOpen = useApp((s) => s.setSkillsOpen)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const themePreference = useApp((s) => s.themePreference)
  const setThemePreference = useApp((s) => s.setThemePreference)
  const appLanguage = useApp((s) => s.appLanguage)
  const setAppLanguage = useApp((s) => s.setAppLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const footerMenuRef = useRef<HTMLDivElement>(null)
  const [aboutOpen, setAboutOpen] = useState(false)

  useEffect(() => {
    if (!themeMenuOpen && !languageMenuOpen) return
    const close = (event: MouseEvent): void => {
      if (footerMenuRef.current?.contains(event.target as Node)) return
      setThemeMenuOpen(false)
      setLanguageMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setThemeMenuOpen(false)
      setLanguageMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [languageMenuOpen, themeMenuOpen])

  useEffect(() => {
    if (!workspaceMenu) return
    const close = (): void => setWorkspaceMenu(null)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [workspaceMenu])

  useEffect(() => {
    if (!renamingWorkspace) return
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }, [renamingWorkspace?.id])

  useEffect(() => {
    if (!aboutOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAboutOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [aboutOpen])

  /** Open an external link in the OS browser (renderer can't navigate away). */
  const openLink = (url: string): void => {
    setAboutOpen(false)
    void api.live.openExternal(url)
  }

  const openSearch = (): void => {
    setSearchOpen(true)
    // Focus after the input has mounted/rendered.
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  const closeSearch = (): void => {
    setSearchOpen(false)
    setSearch('')
  }

  const toggleArchive = async (): Promise<void> => {
    if (archiveOpen) {
      setArchiveOpen(false)
      return
    }
    const entries = await Promise.all(
      workspaces.map(async (workspace) => [workspace.id, await api.workspace.tasks(workspace.id, true)] as const)
    )
    setArchivedTasks(Object.fromEntries(entries))
    setArchiveOpen(true)
  }

  const saveWorkspaceName = async (): Promise<void> => {
    if (!renamingWorkspace) return
    const value = renamingWorkspace.name.trim()
    if (!value) {
      renameInputRef.current?.focus()
      return
    }
    if (await renameWorkspace(renamingWorkspace.id, value)) setRenamingWorkspace(null)
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
  const allWorkspacesCollapsed = workspaces.length > 0 && workspaces.every((ws) => collapsedWorkspaces[ws.id])
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
          {t('rail.newTask')}
          <span className="kbd">Ctrl+N</span>
        </button>
        <button className="rail-action search" onClick={openSearch}>
          <Icon name="search" size={16} />
          {t('rail.search')}
          <span className="kbd">Ctrl+K</span>
        </button>
        <button className="rail-action" onClick={() => setSkillsOpen(true)}>
          <Icon name="sparkles" size={16} />
          {t('rail.skills')}
        </button>
      </div>

      <div className="rail-section">
        {t('rail.workspaces')}
        <span className="actions">
          <button title={t('rail.addFolder')} onClick={openFolder}>
            <Icon name="plus" size={14} />
          </button>
          <button
            title={t(allWorkspacesCollapsed ? 'rail.expandAll' : 'rail.collapseAll')}
            aria-label={t(allWorkspacesCollapsed ? 'rail.expandAll' : 'rail.collapseAll')}
            disabled={workspaces.length === 0}
            onClick={() => setAllWorkspacesCollapsed(!allWorkspacesCollapsed)}
          >
            <Icon name="collapse" size={13} />
          </button>
          <button
            className={searchOpen ? 'active' : undefined}
            title={t('rail.searchWorkspaces')}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
          >
            <Icon name="search" size={13} />
          </button>
          <button className={archiveOpen ? 'active' : undefined} title={t('rail.archived')} onClick={() => void toggleArchive()}>
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
            placeholder={t('rail.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch()
            }}
          />
          <button
            className="rail-search-clear"
            title={t('rail.closeSearch')}
            aria-label={t('rail.closeSearch')}
            onClick={closeSearch}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      <div className="rail-scroll">
        {archiveOpen && (
          <div className="archive-task-list">
            <div className="archive-task-heading"><Icon name="archive" size={13} /> {t('rail.archived')}</div>
            {workspaces.flatMap((ws) => (archivedTasks[ws.id] ?? []).map((task) => (
              <div className={`task-item archived${activeTaskId === task.id ? ' active' : ''}`} key={task.id} role="button" tabIndex={0} onClick={() => void openTask(ws, task.id, true)} onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openTask(ws, task.id, true) }
              }} title={`${ws.name} · ${task.title}`}>
                <Icon name="archive" size={12} />
                <span className="name">{task.title}</span>
                <span className="time">{formatTaskTime(task.deletedAt ?? task.updatedAt, appLanguage)}</span>
                <button className="task-restore" title="Восстановить задачу" aria-label="Восстановить задачу" onClick={(event) => {
                  event.stopPropagation()
                  void restoreTask(ws, task.id).then(() => setArchivedTasks((current) => ({
                    ...current,
                    [ws.id]: (current[ws.id] ?? []).filter((item) => item.id !== task.id)
                  })))
                }}><Icon name="refresh" size={13} /></button>
              </div>
            )))}
            {workspaces.every((ws) => (archivedTasks[ws.id] ?? []).length === 0) && <div className="task-empty">Архив пуст</div>}
          </div>
        )}

        {!archiveOpen && <>
        {workspaces.length === 0 && !isSearching && (
          <button
            className="task-item"
            style={{ paddingLeft: 14 }}
            onClick={openFolder}
            title={t('rail.openProjectFolder')}
          >
            <Icon name="plus" size={14} />
            <span className="name">{t('rail.openFolder')}</span>
          </button>
        )}

        {isSearching && visibleWorkspaces.length === 0 && (
          <div className="task-empty">
            {t('rail.noMatchesFor')} "{search.trim()}"
          </div>
        )}

        {visibleWorkspaces.map(({ ws, tasks, collapsed }) => {
          // While searching, all matches stay visible; otherwise cap at the
          // preview count until the user asks for more.
          const expanded = isSearching || !!showAllTasks[ws.id]
          const visibleTasks = expanded ? tasks : tasks.slice(0, TASK_PREVIEW_COUNT)
          const hiddenCount = tasks.length - visibleTasks.length
          return (
            <div className="ws-group" key={ws.id}>
              <div
                className={`ws-item${active?.id === ws.id && !activeSsh ? ' active' : ''}${
                  dragId === ws.id ? ' dragging' : ''
                }${dragOverId === ws.id && dragId !== ws.id ? ' drag-over' : ''}`}
                draggable={renamingWorkspace?.id !== ws.id}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setWorkspaceMenu({
                    x: Math.min(event.clientX, window.innerWidth - 180),
                    y: Math.min(event.clientY, window.innerHeight - 44),
                    ws
                  })
                }}
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
                  aria-label={collapsed ? t('rail.expandFolder') : t('rail.collapseFolder')}
                  title={collapsed ? t('rail.expand') : t('rail.collapse')}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleWorkspaceCollapsed(ws.id)
                  }}
                >
                  <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                </span>
                <Icon name="folder" size={15} />
                {renamingWorkspace?.id === ws.id ? (
                  <input
                    ref={renameInputRef}
                    className="ws-rename-input"
                    value={renamingWorkspace.name}
                    aria-label={t('rail.renameProject')}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenamingWorkspace({ id: ws.id, name: event.target.value })}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') void saveWorkspaceName()
                      if (event.key === 'Escape') setRenamingWorkspace(null)
                    }}
                    onBlur={() => void saveWorkspaceName()}
                  />
                ) : <span className="name">{ws.name}</span>}
              </div>
              {!collapsed &&
                visibleTasks.map((task) => (
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
                    <span className="time">{formatTaskTime(task.updatedAt, appLanguage)}</span>
                    <button
                      className="task-delete"
                      title={t('rail.deleteTask')}
                      aria-label={t('rail.deleteTask')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteTask(ws, task.id)
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              {!collapsed && hiddenCount > 0 && (
                <button
                  className="task-show-more"
                  onClick={() => setShowAllTasks((s) => ({ ...s, [ws.id]: true }))}
                >
                  {t('rail.showMore', { count: hiddenCount })}
                </button>
              )}
              {!collapsed && expanded && !isSearching && tasks.length > TASK_PREVIEW_COUNT && (
                <button
                  className="task-show-more"
                  onClick={() => setShowAllTasks((s) => ({ ...s, [ws.id]: false }))}
                >
                  {t('rail.showLess')}
                </button>
              )}
              {!collapsed && tasks.length === 0 && (
                <div className="task-empty">{t('rail.noTasksYet')}</div>
              )}
            </div>
          )
        })}
        </>}
      </div>

      {workspaceMenu && createPortal(
        <div
          className="context-menu"
          style={{ left: workspaceMenu.x, top: workspaceMenu.y }}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button className="context-item" role="menuitem" onClick={() => {
            setRenamingWorkspace({ id: workspaceMenu.ws.id, name: workspaceMenu.ws.name })
            setWorkspaceMenu(null)
          }}>{t('rail.renameProject')}</button>
        </div>,
        document.body
      )}

      <BlueprintRail />

      <SshRail />

      <div className="rail-footer" ref={footerMenuRef}>
        {themeMenuOpen && (
          <div className="theme-menu" role="menu" aria-label={t('app.theme.label')}>
            <div className="theme-menu-label">{t('app.theme.label')}</div>
            {THEMES.map((theme) => (
              <button
                className="theme-option"
                key={theme}
                role="menuitemradio"
                aria-checked={themePreference === theme}
                onClick={() => {
                  setThemePreference(theme)
                  setThemeMenuOpen(false)
                }}
              >
                <span>{t(THEME_LABELS[theme])}</span>
                {themePreference === theme && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        )}
        {languageMenuOpen && (
          <div className="theme-menu" role="menu" aria-label={t('app.language.label')}>
            <div className="theme-menu-label">{t('app.language.label')}</div>
            {LANGUAGE_OPTIONS.map((language) => (
              <button
                className="theme-option"
                key={language.value}
                role="menuitemradio"
                aria-checked={appLanguage === language.value}
                onClick={() => {
                  setAppLanguage(language.value)
                  setLanguageMenuOpen(false)
                }}
              >
                <span>{t(language.labelKey)}</span>
                {appLanguage === language.value && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        )}
        <button
          className={`rail-settings${view === 'analytics' ? ' active' : ''}`}
          title={t('rail.analytics')}
          aria-label={t('rail.analytics')}
          onClick={() => (view === 'analytics' ? closeAnalytics() : openAnalytics())}
        >
          <Icon name="barChart" size={17} />
        </button>
        <button
          className="rail-settings"
          title={t('rail.agentBackendSettings')}
          aria-label={t('rail.agentBackendSettings')}
          onClick={() => {
            setThemeMenuOpen(false)
            setLanguageMenuOpen(false)
            setAboutOpen(false)
            setSettingsOpen(true)
          }}
        >
          <Icon name="message" size={17} />
        </button>
        <button
          className={`rail-settings${themeMenuOpen ? ' active' : ''}`}
          title={t('rail.appearanceSettings')}
          aria-label={t('rail.appearanceSettings')}
          aria-expanded={themeMenuOpen}
          onClick={() => {
            setLanguageMenuOpen(false)
            setAboutOpen(false)
            setThemeMenuOpen((open) => !open)
          }}
        >
          <Icon name="settings" size={17} />
        </button>
        <button
          className={`rail-settings${languageMenuOpen ? ' active' : ''}`}
          title={t('app.language.settings')}
          aria-label={t('app.language.settings')}
          aria-expanded={languageMenuOpen}
          onClick={() => {
            setThemeMenuOpen(false)
            setAboutOpen(false)
            setLanguageMenuOpen((open) => !open)
          }}
        >
          <Icon name="globe" size={17} />
        </button>
        <span style={{ flex: 1 }} />
        <div
          className="about-wrap"
          onMouseEnter={() => {
            setThemeMenuOpen(false)
            setLanguageMenuOpen(false)
            setAboutOpen(true)
          }}
          onMouseLeave={() => setAboutOpen(false)}
        >
          {aboutOpen && (
            <div className="about-menu" role="dialog" aria-label={t('rail.about')}>
              <div className="about-title">Ascora ADE</div>
              <div className="about-version">{t('rail.version')}</div>
              <p>
                {t('rail.createdAt')} —{' '}
                <a onClick={() => openLink('https://ascoreai.com')}>ascoreai.com</a>
              </p>
              <p>
                {t('rail.author')} —{' '}
                <a onClick={() => openLink('https://strazewicz.com/')}>strazewicz.com</a>
              </p>
              <p>
                {t('rail.website')}{' '}
                <a onClick={() => openLink('https://ade.ascoreai.com')}>ade.ascoreai.com</a>
              </p>
              <div className="about-copyright">{t('rail.copyright')}</div>
            </div>
          )}
          <button
            className={`rail-settings${aboutOpen ? ' active' : ''}`}
            title={t('rail.about')}
            aria-label={t('rail.about')}
            aria-expanded={aboutOpen}
            onClick={() => {
              setThemeMenuOpen(false)
              setLanguageMenuOpen(false)
              setAboutOpen((open) => !open)
            }}
          >
            <Icon name="info" size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
