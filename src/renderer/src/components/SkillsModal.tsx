import { useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'

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
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!open) return null

  const enabledCount = skills.filter((s) => s.enabled).length

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal modal-skills" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Skills
          <button className="modal-close" onClick={() => setOpen(false)} title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-hint">
            Enabled skills are added to the agent&apos;s instructions for every task —{' '}
            {enabledCount} active.
          </div>

          <div className="skill-list">
            {skills.length === 0 && (
              <div className="skill-empty">No skills yet — add one below.</div>
            )}
            {skills.map((sk) => {
              const editing = editingId === sk.id
              return (
                <div className={`skill-card${sk.enabled ? ' on' : ''}`} key={sk.id}>
                  <div className="skill-row">
                    <label className="skill-toggle" title={sk.enabled ? 'Disable' : 'Enable'}>
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
                      <span className="skill-name">{sk.name || 'Untitled skill'}</span>
                      {sk.description && <span className="skill-desc">{sk.description}</span>}
                    </div>
                    <div className="skill-actions">
                      <button
                        title={editing ? 'Collapse' : 'Edit'}
                        aria-label="Edit skill"
                        onClick={() => setEditingId(editing ? null : sk.id)}
                      >
                        <Icon name={editing ? 'chevronDown' : 'chevronRight'} size={14} />
                      </button>
                      <button
                        title="Delete skill"
                        aria-label="Delete skill"
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
                        placeholder="Name"
                        value={sk.name}
                        onChange={(e) => updateSkill(sk.id, { name: e.target.value })}
                      />
                      <input
                        className="text-input"
                        placeholder="Short description"
                        value={sk.description}
                        onChange={(e) => updateSkill(sk.id, { description: e.target.value })}
                      />
                      <textarea
                        className="text-input skill-instructions"
                        rows={5}
                        placeholder="Instructions the agent follows while this skill is enabled…"
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
            <Icon name="plus" size={14} /> New skill
          </button>
        </div>
      </div>
    </div>
  )
}
