import { useRef, type JSX } from 'react'
import { useApp } from '@/state/store'
import { tr, type TranslationKey } from '@/language'
import type { LlmConfig } from '@shared/ipc'

export function AntLingControls({ settings = false, disabled = false }: { settings?: boolean; disabled?: boolean }): JSX.Element {
  const language = useApp(s => s.appLanguage)
  const reasoning = useApp(s => s.antlingReasoning)
  const temperature = useApp(s => s.antlingTemperature)
  const setReasoning = useApp(s => s.setAntLingReasoning)
  const setTemperature = useApp(s => s.setAntLingTemperature)
  const manualTemperature = useRef(0.7)
  if (temperature !== null) manualTemperature.current = temperature
  const t = (key: TranslationKey): string => tr(language, key)
  const reasoningSelect = <select
    className={`${settings ? 'text-input' : 'composer-select'} antling-reasoning`}
    value={reasoning} disabled={disabled}
    aria-label={t('composer.reasoningEffort')} title={t('composer.reasoningEffort')}
    onChange={event => setReasoning(event.target.value as LlmConfig['antlingReasoning'])}>
    <option value="">{t('composer.reasoningAuto')} ({t('composer.reasoning.on')})</option>
    <option value="off">{t('composer.reasoning.off')}</option>
    <option value="on">{t('composer.reasoning.on')}</option>
  </select>
  const temperatureControls = <div className="antling-temperature-controls">
    <select className={`${settings ? 'text-input' : 'composer-select'} antling-temperature-mode`}
      value={temperature === null ? 'auto' : 'manual'} disabled={disabled}
      aria-label={t('composer.temperature')} title={t('composer.temperature')}
      onChange={event => setTemperature(event.target.value === 'auto' ? null : manualTemperature.current)}>
      <option value="auto">{t('composer.temperatureAuto')}</option>
      <option value="manual">{t('composer.temperatureManual')}</option>
    </select>
    {temperature !== null && <label className="antling-temperature-slider">
      <input type="range" min="0" max="1" step="0.05" value={temperature} disabled={disabled}
        aria-label={t('composer.temperature')} aria-valuetext={temperature.toFixed(2)}
        onChange={event => setTemperature(Number(event.target.value))} />
      <output>{temperature.toFixed(2)}</output>
    </label>}
  </div>
  return settings ? <>
    <label className="field"><span className="field-label">{t('composer.reasoningEffort')}</span>{reasoningSelect}</label>
    <div className="field"><span className="field-label">{t('composer.temperature')}</span>{temperatureControls}
      <span className="field-hint">{t('settings.antlingTemperatureHint')}</span></div>
  </> : <>{reasoningSelect}{temperatureControls}</>
}
