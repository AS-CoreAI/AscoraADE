import { useEffect, type JSX } from 'react'
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
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)

  useEffect(() => {
    void init()
  }, [init])

  const show = (id: string): void => {
    open(id)
    useApp.setState({ view: 'blueprint' })
  }

  const create = async (): Promise<void> => {
    const blueprint = await createBlueprint('team', service)
    show(blueprint.id)
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
                    if (window.confirm(t('blueprint.deleteConfirm', { name: blueprint.name }))) {
                      void removeBlueprint(blueprint.id)
                    }
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
