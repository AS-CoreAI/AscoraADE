import type { JSX } from 'react'
import { useApp } from '@/state/store'
import { tr, type TranslationKey } from '@/language'
import { GIGACHAT_REASONING_LEVELS, type GigachatReasoning } from '@shared/ipc'

const labels: Record<GigachatReasoning, TranslationKey> = {
  low: 'composer.reasoning.low', medium: 'composer.reasoning.medium', high: 'composer.reasoning.high'
}

export function GigachatControls({ settings = false, disabled = false }: { settings?: boolean; disabled?: boolean }): JSX.Element {
  const language = useApp(s => s.appLanguage)
  const reasoning = useApp(s => s.gigachatReasoning)
  const setReasoning = useApp(s => s.setGigachatReasoning)
  const t = (key: TranslationKey): string => tr(language, key)
  const select = <select
    className={settings ? 'text-input' : 'composer-select'}
    value={reasoning}
    disabled={disabled}
    aria-label={t('composer.reasoningEffort')}
    title={t('composer.reasoningEffort')}
    onChange={event => setReasoning(event.target.value as GigachatReasoning | '')}>
    <option value="">{t('composer.reasoning.off')}</option>
    {GIGACHAT_REASONING_LEVELS.map(level => <option key={level} value={level}>{t(labels[level])}</option>)}
  </select>
  return settings
    ? <label className="field"><span className="field-label">{t('composer.reasoningEffort')}</span>{select}<span className="field-hint">{t('settings.gigachatReasoningHint')}</span></label>
    : <>{select}</>
}
