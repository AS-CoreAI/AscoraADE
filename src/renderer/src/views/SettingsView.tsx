import { useEffect, useState, type JSX } from 'react'
import { ConnectionSettings } from '@/components/ConnectionSettings'
import { DeveloperToolsPage } from '@/components/DeveloperToolsModal'
import { CliLimitsPage } from './CliLimitsPage'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { PROVIDERS, type SettingsSection } from '@/lib/providers'
import { LANGUAGE_OPTIONS, tr } from '@/language'
import { useApp, type ThemePreference } from '@/state/store'
import { isSshCapableProvider, type LlmProvider, type UsageLimitResult } from '@shared/ipc'
import type { ProviderCreditInfo, ProviderSoftwareInfo } from '@shared/provider-setup'

const CLI_CHECKS = {
  codex: 'checkCodex', claude: 'checkClaude', copilot: 'checkCopilot',
  gemini: 'checkGemini', grok: 'checkGrok', glm: 'checkGlm', antigravity: 'checkAntigravity'
} as const
type CliProvider = keyof typeof CLI_CHECKS
const isCli = (provider: LlmProvider): provider is CliProvider => Object.hasOwn(CLI_CHECKS, provider)
const USAGE_URLS: Partial<Record<LlmProvider, string>> = {
  codex: 'https://chatgpt.com/codex/settings/usage',
  claude: 'https://claude.ai/settings/usage',
  copilot: 'https://github.com/settings/billing',
  openrouter: 'https://openrouter.ai/settings/credits',
  gemini: 'https://aistudio.google.com/usage'
}

function ProviderPage({ provider }: { provider: LlmProvider }): JSX.Element {
  const s = useApp()
  const ru = s.appLanguage === 'ru'
  const [software, setSoftware] = useState<ProviderSoftwareInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [message, setMessage] = useState('')
  const [refreshingUsage, setRefreshingUsage] = useState(false)
  const [credits, setCredits] = useState<ProviderCreditInfo | null>(null)
  const [antigravityUsage, setAntigravityUsage] = useState<UsageLimitResult | null>(null)
  const check = isCli(provider) ? s[`${provider}Check`] : null
  const checking = isCli(provider) ? s[`${provider}Checking`] : false
  const usage = check?.loggedIn === false ? null : provider === 'codex' ? s.codexUsage : provider === 'claude' ? s.claudeUsage : provider === 'antigravity' ? antigravityUsage : null
  const usageUrl = USAGE_URLS[provider]
  const name = PROVIDERS.find((item) => item.id === provider)!.name
  const visible = s.providerVisibility[provider] !== false

  const recheck = async (): Promise<void> => {
    if (isCli(provider)) await useApp.getState()[CLI_CHECKS[provider]]()
  }
  const refreshUsage = async (): Promise<void> => {
    setRefreshingUsage(true)
    try {
      if (provider === 'codex') await s.refreshCodexUsage()
      if (provider === 'claude') await s.refreshClaudeUsage()
      if (provider === 'antigravity') setAntigravityUsage(await api.antigravity.usage())
      if (provider === 'openrouter') {
        const key = s.openRouterApiKey
        const result = await api.providerSetup.credits(provider)
        if (useApp.getState().openRouterApiKey === key) setCredits(result)
      }
    } catch (error) {
      setMessage(String(error))
    } finally { setRefreshingUsage(false) }
  }

  useEffect(() => {
    if (provider === 'antigravity' && check?.loggedIn) void refreshUsage()
  }, [provider, check?.loggedIn])

  useEffect(() => {
    if (provider !== 'openrouter') return
    setCredits(null)
    if (s.openRouterApiKey.trim()) void refreshUsage()
  }, [provider, s.openRouterApiKey])

  useEffect(() => {
    let cancelled = false
    void recheck()
    void api.providerSetup.inspect(provider).then((info) => {
      if (!cancelled) setSoftware(info)
    }).catch((error) => { if (!cancelled) setMessage(String(error)) })
    return () => { cancelled = true }
  }, [provider])

  const install = async (): Promise<void> => {
    setInstalling(true)
    setMessage('')
    try {
      const result = await api.providerSetup.install(provider)
      setMessage(result.ok
        ? (ru ? 'Установка завершена. Проверяем доступность. Если CLI не найден, перезапустите приложение, чтобы обновить PATH.' : 'Installation finished. Checking availability. If the CLI is not found, restart the app to reload PATH.')
        : result.error ?? (ru ? 'Не удалось установить.' : 'Installation failed.'))
      await recheck()
    } catch (error) { setMessage(String(error)) }
    finally { setInstalling(false) }
  }

  return <>
    <header className="settings-content-header">
      <div><div className="settings-eyebrow">{ru ? 'ПРОВАЙДЕРЫ' : 'PROVIDERS'}</div><h1>{name}</h1>
        <p>{ru ? 'Подключение, учётная запись и параметры агента.' : 'Connection, account and agent preferences.'}</p></div>
      <button className="btn" disabled={s.provider === provider || (!!s.activeSsh && !isSshCapableProvider(provider)) || (provider === 'openrouter' && (!s.openRouterEnabled || !s.openRouterApiKey.trim()))}
        onClick={() => void s.setProvider(provider).catch((error) => setMessage(String(error)))}>
        {s.provider === provider ? (ru ? 'Активный провайдер' : 'Active provider') : (ru ? 'Использовать в чате' : 'Use in chat')}
      </button>
    </header>
    <label className="settings-card settings-toggle-row">
      <span><strong>{ru ? 'Показывать в списке провайдеров' : 'Show in the provider menu'}</strong>
        <small>{ru ? 'В выпадающем списке выбора агента в чате.' : 'In the agent dropdown in the chat composer.'}</small></span>
      <input type="checkbox" role="switch" checked={visible} onChange={(e) => void s.setProviderVisible(provider, e.target.checked)} />
    </label>
    {isCli(provider) && <section className="settings-card">
      <div className="settings-section-heading"><h2>{ru ? 'Подключение и авторизация' : 'Connection and authorization'}</h2>
        <button className="btn" disabled={checking || installing} onClick={() => void recheck()}>{checking ? (ru ? 'Проверка…' : 'Checking…') : (ru ? 'Проверить' : 'Check')}</button></div>
      <div className="settings-status-grid" aria-live="polite">
        <div><small>{ru ? 'Программное обеспечение' : 'Software'}</small><strong className={check?.installed ? 'settings-ok' : ''}>
          {checking ? '…' : !check ? (ru ? 'Не проверено' : 'Not checked') : check.installed ? (ru ? 'Установлено' : 'Installed') : (ru ? 'Не найдено / недоступно' : 'Missing / unavailable')}</strong></div>
        <div><small>{ru ? 'Авторизация' : 'Authorization'}</small><strong className={check?.loggedIn ? 'settings-ok' : ''}>
          {checking ? '…' : check?.loggedIn ? (ru ? 'Вход выполнен' : 'Signed in') : check?.installed ? (ru ? 'Требуется вход' : 'Sign in required') : '—'}</strong></div>
        <div><small>{ru ? 'Версия' : 'Version'}</small><strong>{check?.version || '—'}</strong></div>
      </div>
      {check?.account && <p className="field-hint">{check.account}</p>}
      {check?.authNote && <p className="field-hint">{check.authNote}</p>}
      {check?.error && <p className="settings-error">{check.error}</p>}
      {check?.installed === false && software && <div className="settings-install">
        {software.command && <code>{software.command}</code>}
        {software.error && <p className="field-hint">{software.error}</p>}
        <div className="field-row">
          {software.available && <button className="btn" disabled={installing} onClick={() => void install()}>{installing ? (ru ? 'Устанавливаем…' : 'Installing…') : (ru ? 'Установить автоматически' : 'Install automatically')}</button>}
          {software.url && <button className="btn" onClick={() => void api.live.openExternal(software.url!)}>{ru ? 'Сайт установки' : 'Installation website'}</button>}
        </div>
      </div>}
    </section>}
    {!isCli(provider) && software?.url && <section className="settings-card settings-install">
      <h2>{ru ? 'Установка приложения' : 'Application installation'}</h2>
      <p className="field-hint">{ru ? 'Если приложение ещё не установлено, установите его и запустите локальный сервер.' : 'If the application is missing, install it and start its local server.'}</p>
      <div className="field-row">{software.available && <button className="btn" disabled={installing} onClick={() => void install()}>{installing ? (ru ? 'Устанавливаем…' : 'Installing…') : (ru ? 'Установить автоматически' : 'Install automatically')}</button>}
        <button className="btn" onClick={() => void api.live.openExternal(software.url!)}>{ru ? 'Скачать приложение' : 'Download application'}</button></div>
    </section>}
    {message && <p role="status" className="settings-card settings-message">{message}</p>}
    <section className="settings-card">
      <div className="settings-section-heading"><h2>{ru ? 'Остатки лимитов' : 'Remaining limits'}</h2>
        {['codex', 'claude', 'openrouter', 'antigravity'].includes(provider) && <button className="btn" disabled={refreshingUsage} onClick={() => void refreshUsage()}>{refreshingUsage ? '…' : (ru ? 'Обновить' : 'Refresh')}</button>}</div>
      {provider === 'openrouter' && credits && <p className="field-hint">{credits.ok
        ? `${ru ? 'Остаток лимита API-ключа: ' : 'API key allowance remaining: '}${typeof credits.remaining === 'number' ? `$${credits.remaining.toFixed(2)}` : credits.limit === null ? (ru ? 'лимит ключа не задан' : 'no key spending cap') : (ru ? 'не сообщён' : 'not reported')}${typeof credits.used === 'number' ? ` · ${ru ? 'использовано' : 'used'} $${credits.used.toFixed(2)}` : ''}`
        : credits.error}</p>}
      {usage?.windows.length ? <div className="settings-usage-list">{usage.windows.map((win) => {
        const remaining = Math.max(0, Math.min(100, 100 - win.percent))
        return <div className="usage-item" key={win.label}>
          <div className="usage-item-head"><span>{win.label}</span><strong>{remaining}% {ru ? 'осталось' : 'remaining'}</strong></div>
          <progress max="100" value={remaining} aria-label={win.label} />
          {win.resetsAt && <small>{ru ? 'Обновление: ' : 'Resets: '}{new Date(win.resetsAt).toLocaleString(s.appLanguage)}</small>}
        </div>
      })}</div> : !(provider === 'openrouter' && credits) && <p className="field-hint">{usage?.error || (provider === 'lmstudio' || provider === 'ollama'
        ? (ru ? 'Локальный сервер не сообщает лимиты подписки.' : 'The local server does not report subscription limits.')
        : (ru ? 'Лимиты пока не получены. Если провайдер не передаёт их через интеграцию, проверьте остаток в личном кабинете.' : 'Limits are not available yet. If the provider does not expose them through this integration, check your account dashboard.'))}</p>}
      {usageUrl && <button className="btn" onClick={() => void api.live.openExternal(usageUrl)}>{ru ? 'Открыть лимиты в личном кабинете' : 'Open account usage'}</button>}
    </section>
    <section className="settings-card">
      <h2>{ru ? 'Параметры подключения' : 'Connection settings'}</h2>
      <ConnectionSettings provider={provider} />
    </section>

  </>
}

export function SettingsView(): JSX.Element {
  const s = useApp()
  const ru = s.appLanguage === 'ru'
  const t = (key: Parameters<typeof tr>[1]): string => tr(s.appLanguage, key)
  const section = s.settingsSection
  const select = (next: SettingsSection): void => { useApp.setState({ settingsSection: next }) }
  return <div className="settings-view">
    <aside className="settings-nav">
      <div className="settings-nav-title"><Icon name="settings" size={19} /><strong>{ru ? 'Настройки' : 'Settings'}</strong></div>
      <button className="settings-back" onClick={() => s.setSettingsOpen(false)}><Icon name="arrowLeft" size={14} />{ru ? 'Вернуться к работе' : 'Back to work'}</button>
      <nav aria-label={ru ? 'Разделы настроек' : 'Settings sections'}>
        <button className={section === 'appearance' ? 'active' : ''} aria-current={section === 'appearance' ? 'page' : undefined} onClick={() => select('appearance')}><Icon name="settings" size={16} />{ru ? 'Язык и внешний вид' : 'Language & appearance'}</button>
        <button className={section === 'providers' ? 'active' : ''} aria-current={section === 'providers' ? 'page' : undefined} onClick={() => select('providers')}><Icon name="message" size={16} />{ru ? 'Провайдеры агентов' : 'Agent providers'}</button>
        {section === 'providers' && <div className="settings-provider-nav">{PROVIDERS.map((provider) => <button key={provider.id}
          className={s.settingsProvider === provider.id ? 'selected' : ''} aria-current={s.settingsProvider === provider.id ? 'page' : undefined}
          onClick={() => useApp.setState({ settingsProvider: provider.id })}>
          <span>{provider.name}</span><span className={`settings-visibility-dot${s.providerVisibility[provider.id] === false ? ' hidden' : ''}`} aria-label={s.providerVisibility[provider.id] === false ? (ru ? 'Скрыт из списка' : 'Hidden from menu') : (ru ? 'Виден в списке' : 'Visible in menu')} />
        </button>)}</div>}
        <button className={section === 'limits' ? 'active' : ''} aria-current={section === 'limits' ? 'page' : undefined} onClick={() => select('limits')}><Icon name="barChart" size={16} />{ru ? 'Лимиты' : 'Usage limits'}</button>
        <button className={section === 'tools' ? 'active' : ''} aria-current={section === 'tools' ? 'page' : undefined} onClick={() => select('tools')}><Icon name="terminal" size={16} />{t('tools.title')}</button>
      </nav>
    </aside>
    <main className="settings-content" key={section === 'providers' ? s.settingsProvider : section}>
      {section === 'appearance' && <>
        <header className="settings-content-header"><div><div className="settings-eyebrow">ASCORA ADE</div><h1>{ru ? 'Язык и внешний вид' : 'Language & appearance'}</h1><p>{ru ? 'Настройте рабочую среду под себя.' : 'Make your workspace feel like home.'}</p></div></header>
        <section className="settings-card"><h2>{t('app.theme.label')}</h2><div className="settings-theme-options">
          {(['dark', 'light', 'system'] as ThemePreference[]).map((theme) => <button key={theme} className={`settings-theme${s.themePreference === theme ? ' selected' : ''}`} aria-pressed={s.themePreference === theme} onClick={() => s.setThemePreference(theme)}>
            <span className={`settings-theme-preview ${theme}`}><i /><i /><i /></span><span>{t(`app.theme.${theme}`)}{s.themePreference === theme && <Icon name="check" size={14} />}</span>
          </button>)}
        </div></section>
        <section className="settings-card"><h2>{t('app.language.label')}</h2><div className="settings-language-options">{LANGUAGE_OPTIONS.map((language) => <button key={language.value} className={s.appLanguage === language.value ? 'selected' : ''} aria-pressed={s.appLanguage === language.value} onClick={() => s.setAppLanguage(language.value)}>{t(language.labelKey)}{s.appLanguage === language.value && <Icon name="check" size={14} />}</button>)}</div></section>
      </>}
      {section === 'providers' && <ProviderPage provider={s.settingsProvider} />}
      {section === 'limits' && <CliLimitsPage />}
      <div hidden={section !== 'tools'}>{section === 'tools' && <DeveloperToolsPage />}</div>
    </main>
  </div>
}
