import en, { type Translation, type TranslationKey } from './en'
import ru from './ru'
import uk from './uk'
import de from './de'
import fr from './fr'
import it from './it'

export { type TranslationKey }

export const LANGUAGE_CODES = ['en', 'ru', 'uk', 'de', 'fr', 'it'] as const
export type LanguageCode = (typeof LANGUAGE_CODES)[number]

export const LANGUAGE_OPTIONS: { value: LanguageCode; labelKey: TranslationKey }[] = [
  { value: 'en', labelKey: 'app.language.english' },
  { value: 'ru', labelKey: 'app.language.russian' },
  { value: 'uk', labelKey: 'app.language.ukrainian' },
  { value: 'de', labelKey: 'app.language.german' },
  { value: 'fr', labelKey: 'app.language.french' },
  { value: 'it', labelKey: 'app.language.italian' }
]

const dictionaries: Record<LanguageCode, Translation> = { en, ru, uk, de, fr, it }

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
