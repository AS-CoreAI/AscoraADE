import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import { useBlueprints } from '@/state/blueprints'
import { tr } from '@/language'

export function BlueprintRail(): JSX.Element {
  const items = useBlueprints((state) => state.items)
  const activeId = useBlueprints((state) => state.activeId)
  const init = useBlueprints((state) => state.init)
  const open = useBlueprints((state) => state.open)
  const createBlueprint = useBlueprints((state) => state.createBlueprint)
  const removeBlueprint = useBlueprints((state) => state.removeBlueprint)
  const service = useApp((state) => state.wproviderService)
  const appLanguage = useApp((state) => state.appLanguage)
  const [blueprintToDelete, setBlueprintToDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const selectedForDelete = items.find((item) => item.id === blueprintToDelete) ?? null

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!selectedForDelete) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !deleting) setBlueprintToDelete(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [deleting, selectedForDelete])

  const show = (id: string): void => {
    open(id)
    useApp.setState({ view: 'blueprint' })
  }

  const create = async (): Promise<void> => {
    const blueprint = await createBlueprint('team', service)
    show(blueprint.id)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!selectedForDelete || deleting) return
    setDeleting(true)
    try {
      await removeBlueprint(selectedForDelete.id)
      setBlueprintToDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="blueprint-rail">
      <div className="rail-section">
        {t('blueprint.railTitle')}
        <span className="actions">
          <button title={t('blueprint.new')} onClick={() => void create()}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      </div>
      <div className="blueprint-rail-list">
        {items.length === 0 ? (
          <button className="task-item" style={{ paddingLeft: 14 }} onClick={() => void create()}>
            <Icon name="blueprint" size={14} />
            <span className="name">{t('blueprint.createFirst')}</span>
          </button>
        ) : (
          items.map((blueprint) => {
            const status = blueprint.lastRun?.status ?? 'idle'
            const dot = status === 'running' ? 'running' : status === 'failed' ? 'error' : 'idle'
            return (
              <div
                className={`blueprint-rail-item${activeId === blueprint.id ? ' active' : ''}`}
                key={blueprint.id}
                role="button"
                tabIndex={0}
                title={blueprint.description || blueprint.name}
                onClick={() => show(blueprint.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    show(blueprint.id)
                  }
                }}
              >
                <span className={`task-dot ${dot}`} />
                <Icon name="blueprint" size={14} />
                <span className="name">{blueprint.name}</span>
                {blueprint.schedule.enabled && (
                  <span className="blueprint-scheduled" title={t('blueprint.scheduleEnabled')}>
                    <Icon name="clock" size={11} />
                  </span>
                )}
                <button
                  className="task-delete"
                  title={t('common.delete')}
                  aria-label={t('blueprint.delete')}
                  onClick={(event) => {
                    event.stopPropagation()
                    setBlueprintToDelete(blueprint.id)
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            )
          })
        )}
      </div>
      {selectedForDelete && createPortal(
        <div
          className="modal-backdrop workspace-archive-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) setBlueprintToDelete(null)
          }}
        >
          <div
            className="modal workspace-archive-modal blueprint-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="blueprint-delete-title"
            aria-describedby="blueprint-delete-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close workspace-archive-close"
              title={t('common.close')}
              aria-label={t('common.close')}
              disabled={deleting}
              onClick={() => setBlueprintToDelete(null)}
            >
              <Icon name="x" size={15} />
            </button>
            <div className="workspace-archive-hero">
              <span className="workspace-archive-symbol blueprint-delete-symbol">
                <Icon name="blueprint" size={22} />
              </span>
              <div>
                <h2 id="blueprint-delete-title">{t('blueprint.delete')}</h2>
                <p>{selectedForDelete.name}</p>
              </div>
            </div>
            <div className="workspace-archive-content">
              <p className="workspace-archive-question">
                {t('blueprint.deleteConfirm', { name: selectedForDelete.name })}
              </p>
              <p id="blueprint-delete-description" className="workspace-archive-description">
                {t('blueprint.deleteDescription')}
              </p>
              <div className="blueprint-delete-summary">
                <Icon name="blueprint" size={14} />
                <div>
                  <strong>{selectedForDelete.name}</strong>
                  {selectedForDelete.description && <span>{selectedForDelete.description}</span>}
                </div>
              </div>
            </div>
            <div className="workspace-archive-actions">
              <button
                className="btn"
                autoFocus
                disabled={deleting}
                onClick={() => setBlueprintToDelete(null)}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn workspace-archive-submit"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                <Icon name="trash" size={14} />
                {t('blueprint.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
