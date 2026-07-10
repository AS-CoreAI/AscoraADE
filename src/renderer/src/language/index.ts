import en, { type Translation, type TranslationKey } from './en'
import ru from './ru'
import uk from './uk'

export { type TranslationKey }

export const LANGUAGE_CODES = ['en', 'ru', 'uk'] as const
export type LanguageCode = (typeof LANGUAGE_CODES)[number]

export const LANGUAGE_OPTIONS: { value: LanguageCode; labelKey: TranslationKey }[] = [
  { value: 'en', labelKey: 'app.language.english' },
  { value: 'ru', labelKey: 'app.language.russian' },
  { value: 'uk', labelKey: 'app.language.ukrainian' }
]

const dictionaries: Record<LanguageCode, Translation> = { en, ru, uk }

export function isLanguageCode(value: unknown): value is LanguageCode {
  return LANGUAGE_CODES.some((language) => language === value)
}

export function localeForLanguage(language: LanguageCode): string {
  return language
}

export function tr(
  language: LanguageCode,
  key: TranslationKey,
  values?: Record<string, string | number>
): string {
  let text = dictionaries[language][key]
  if (!values) return text
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}
