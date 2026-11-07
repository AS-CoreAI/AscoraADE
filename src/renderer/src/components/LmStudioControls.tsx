import { useEffect, useState, type JSX } from 'react'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'
import { tr, type TranslationKey } from '@/language'
import type { LmStudioModelInfo, LmStudioReasoning } from '@shared/ipc'

const labels: Record<LmStudioReasoning, TranslationKey> = {
  off: 'composer.reasoning.off', on: 'composer.reasoning.on',
  minimal: 'composer.reasoning.minimal', low: 'composer.reasoning.low',
  medium: 'composer.reasoning.medium', high: 'composer.reasoning.high', xhigh: 'composer.reasoning.veryHigh'
}

export function LmStudioControls({ settings = false, disabled = false }: { settings?: boolean; disabled?: boolean }): JSX.Element {
  const language = useApp(s => s.appLanguage)
  const model = useApp(s => s.model)
  const baseUrl = useApp(s => s.baseUrl)
  const reasoning = useApp(s => s.lmStudioReasoning)
  const setReasoning = useApp(s => s.setLmStudioReasoning)
  const [info, setInfo] = useState<LmStudioModelInfo | null>(null)
  const t = (key: TranslationKey): string => tr(language, key)
  useEffect(() => {
    let active = true
    let pending = false
    setInfo(null)
    const refresh = async (): Promise<void> => {
      if (pending) return
      pending = true
      const next = model ? await api.llm.modelInfo(model).catch(() => null) : null
      if (active) setInfo(next)
      pending = false
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 15_000)
    window.addEventListener('focus', refresh)
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [model, baseUrl])
  const options = info?.reasoningOptions ?? []
  const context = info?.contextLength
    ? tr(language, 'composer.contextWindow', { count: info.contextLength.toLocaleString(language) })
    : t('composer.contextUnknown')
  const select = <select
    className={settings ? 'text-input lmstudio-reasoning' : 'composer-select lmstudio-reasoning'}
    value={reasoning}
    disabled={disabled || options.length === 0}
    aria-label={t('composer.reasoningEffort')}
    title={options.length ? t('composer.reasoningEffort') : t('composer.reasoningUnavailable')}
    onChange={event => setReasoning(event.target.value as LmStudioReasoning | '')}>
    <option value="">{t('composer.reasoningAuto')}{info?.reasoningDefault ? ` (${t(labels[info.reasoningDefault])})` : ''}</option>
    {reasoning && !options.includes(reasoning) && <option value={reasoning} disabled>{t(labels[reasoning])} — {t('composer.reasoningUnavailable')}</option>}
    {options.map(option => <option key={option} value={option}>{t(labels[option])}</option>)}
  </select>
  return settings
    ? <label className="field"><span className="field-label">{t('composer.reasoningEffort')}</span>{select}<span className="field-hint lmstudio-context">{context}</span></label>
    : <>{select}<span className="field-hint lmstudio-context" title={context}>{context}</span></>
}
