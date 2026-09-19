import { tr, type LanguageCode, type TranslationKey } from './index'

const WINDOW_KEYS: Record<string, TranslationKey> = {
  session: 'settings.limitSession',
  daily: 'settings.limitDaily',
  weekly: 'settings.limitWeekly',
  monthly: 'settings.limitMonthly',
  usage: 'settings.limitUsage'
}

/** Translate labels emitted by our CLI adapters, preserving provider/model names. */
export function usageWindowLabel(language: LanguageCode, label: string): string {
  const weeklyModel = /^weekly (Opus|Sonnet) limit$/i.exec(label)
  if (weeklyModel) return tr(language, 'settings.limitWeeklyModel', { model: weeklyModel[1] })
  const known = /^(?:(.+) )?(session|daily|weekly|monthly|usage) limit$/i.exec(label)
  if (known) return [known[1], tr(language, WINDOW_KEYS[known[2].toLowerCase()])].filter(Boolean).join(' ')
  const duration = /^(?:(.+) )?(\d+)(h|d) limit$/i.exec(label)
  if (duration) return [duration[1], tr(language, duration[3].toLowerCase() === 'h' ? 'settings.limitHours' : 'settings.limitDays', { count: duration[2] })].filter(Boolean).join(' ')
  // An upstream label may be a model ID or a custom account limit.
  return label
}
