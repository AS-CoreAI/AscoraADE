import { useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import { tr } from '@/language'

/**
 * Manage the agent's skills — reusable instruction snippets. Enabled skills are
 * folded into the agent's instructions on every task (see store.submitTask).
 */
export function SkillsModal(): JSX.Element | null {
  const open = useApp((s) => s.skillsOpen)
  const setOpen = useApp((s) => s.setSkillsOpen)
  const skills = useApp((s) => s.skills)
  const toggleSkill = useApp((s) => s.toggleSkill)
  const addSkill = useApp((s) => s.addSkill)
  const updateSkill = useApp((s) => s.updateSkill)
  const deleteSkill = useApp((s) => s.deleteSkill)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!open) return null

  const enabledCount = skills.filter((s) => s.enabled).length

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal modal-skills" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {t('rail.skills')}
          <button className="modal-close" onClick={() => setOpen(false)} title={t('common.close')}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-hint">
            {t('skills.hint', { count: enabledCount })}
          </div>

          <div className="skill-list">
            {skills.length === 0 && (
              <div className="skill-empty">{t('skills.empty')}</div>
            )}
            {skills.map((sk) => {
              const editing = editingId === sk.id
              return (
                <div className={`skill-card${sk.enabled ? ' on' : ''}`} key={sk.id}>
                  <div className="skill-row">
                    <label className="skill-toggle" title={sk.enabled ? t('skills.disable') : t('skills.enable')}>
                      <input
                        type="checkbox"
                        checked={sk.enabled}
                        onChange={() => toggleSkill(sk.id)}
                      />
                    </label>
                    <div
                      className="skill-main"
                      role="button"
                      tabIndex={0}
                      onClick={() => setEditingId(editing ? null : sk.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setEditingId(editing ? null : sk.id)
                        }
                      }}
                    >
                      <span className="skill-name">{sk.name || t('skills.untitled')}</span>
                      {sk.description && <span className="skill-desc">{sk.description}</span>}
                    </div>
                    <div className="skill-actions">
                      <button
                        title={editing ? t('rail.collapse') : t('common.edit')}
                        aria-label={t('skills.edit')}
                        onClick={() => setEditingId(editing ? null : sk.id)}
                      >
                        <Icon name={editing ? 'chevronDown' : 'chevronRight'} size={14} />
                      </button>
                      <button
                        title={t('skills.delete')}
                        aria-label={t('skills.delete')}
                        onClick={() => {
                          deleteSkill(sk.id)
                          if (editing) setEditingId(null)
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>

                  {editing && (
                    <div className="skill-editor">
                      <input
                        className="text-input"
                        placeholder={t('skills.namePlaceholder')}
                        value={sk.name}
                        onChange={(e) => updateSkill(sk.id, { name: e.target.value })}
                      />
                      <input
                        className="text-input"
                        placeholder={t('skills.descriptionPlaceholder')}
                        value={sk.description}
                        onChange={(e) => updateSkill(sk.id, { description: e.target.value })}
                      />
                      <textarea
                        className="text-input skill-instructions"
                        rows={5}
                        placeholder={t('skills.instructionsPlaceholder')}
                        value={sk.instructions}
                        onChange={(e) => updateSkill(sk.id, { instructions: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button
            className="btn btn-icon"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setEditingId(addSkill())}
          >
            <Icon name="plus" size={14} /> {t('skills.new')}
          </button>
        </div>
      </div>
    </div>
  )
}
