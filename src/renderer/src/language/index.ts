import en, { type Translation, type TranslationKey } from './en'
import ru from './ru'
import uk from './uk'
import de from './de'
import fr from './fr'
import it from './it'
import zh from './zh'
import ko from './ko'
import ja from './ja'
import pl from './pl'
import hi from './hi'

export { type TranslationKey }

export const LANGUAGE_CODES = ['en', 'ru', 'uk', 'de', 'fr', 'it', 'pl', 'zh', 'ko', 'ja', 'hi'] as const
export type LanguageCode = (typeof LANGUAGE_CODES)[number]

export const LANGUAGE_OPTIONS: { value: LanguageCode; labelKey: TranslationKey }[] = [
  { value: 'en', labelKey: 'app.language.english' },
  { value: 'ru', labelKey: 'app.language.russian' },
  { value: 'uk', labelKey: 'app.language.ukrainian' },
  { value: 'de', labelKey: 'app.language.german' },
  { value: 'fr', labelKey: 'app.language.french' },
  { value: 'it', labelKey: 'app.language.italian' },
  { value: 'pl', labelKey: 'app.language.polish' },
  { value: 'zh', labelKey: 'app.language.chinese' },
  { value: 'ko', labelKey: 'app.language.korean' },
  { value: 'ja', labelKey: 'app.language.japanese' },
  { value: 'hi', labelKey: 'app.language.hindi' }
]

const dictionaries: Record<LanguageCode, Translation> = { en, ru, uk, de, fr, it, pl, zh, ko, ja, hi }

const LOCALE_BY_LANGUAGE: Record<LanguageCode, string> = {
  en: 'en',
  ru: 'ru',
  uk: 'uk',
  de: 'de',
  fr: 'fr',
  it: 'it',
  pl: 'pl',
  zh: 'zh-CN',
  ko: 'ko',
  ja: 'ja',
  hi: 'hi'
}

export function isLanguageCode(value: unknown): value is LanguageCode {
  return LANGUAGE_CODES.some((language) => language === value)
}

export function localeForLanguage(language: LanguageCode): string {
  return LOCALE_BY_LANGUAGE[language]
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
