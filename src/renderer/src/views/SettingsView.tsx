import { useEffect, useState, type JSX } from 'react'
import { ConnectionSettings } from '@/components/ConnectionSettings'
import { DeveloperToolsPage } from '@/components/DeveloperToolsModal'
import { CliLimitsPage } from './CliLimitsPage'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { PROVIDERS, type SettingsSection } from '@/lib/providers'
import { LANGUAGE_OPTIONS, localeForLanguage, tr, type TranslationKey } from '@/language'
import { usageWindowLabel } from '@/language/usage'
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
  const t = (key: TranslationKey, values?: Record<string, string | number>): string => tr(s.appLanguage, key, values)
  const [software, setSoftware] = useState<ProviderSoftwareInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [message, setMessage] = useState('')
  const [messageKey, setMessageKey] = useState<TranslationKey | null>(null)
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
    setMessageKey(null)
    try {
      const result = await api.providerSetup.install(provider)
      setMessageKey(result.ok ? 'settings.installFinished' : result.error ? null : 'tools.installFailed')
      if (!result.ok && result.error) setMessage(result.error)
      await recheck()
    } catch (error) { setMessage(String(error)) }
    finally { setInstalling(false) }
  }

  return <>
    <header className="settings-content-header">
      <div><div className="settings-eyebrow">{t('settings.providersEyebrow')}</div><h1>{name}</h1>
        <p>{t('settings.providerSubtitle')}</p></div>
      <button className="btn" disabled={s.provider === provider || (!!s.activeSsh && !isSshCapableProvider(provider)) || (provider === 'unsloth' && !s.unslothApiKey.trim()) || (provider === 'openrouter' && (!s.openRouterEnabled || !s.openRouterApiKey.trim()))}
        onClick={() => void s.setProvider(provider).catch((error) => setMessage(String(error)))}>
        {s.provider === provider ? t('settings.activeProvider') : t('settings.useInChat')}
      </button>
    </header>
    <label className="settings-card settings-toggle-row">
      <span><strong>{t('settings.showProvider')}</strong>
        <small>{t('settings.showProviderHint')}</small></span>
      <input type="checkbox" role="switch" checked={visible} onChange={(e) => void s.setProviderVisible(provider, e.target.checked)} />
    </label>
    {isCli(provider) && <section className="settings-card">
      <div className="settings-section-heading"><h2>{t('settings.connectionAuthorization')}</h2>
        <button className="btn" disabled={checking || installing} onClick={() => void recheck()}>{checking ? t('common.checking') : t('common.check')}</button></div>
      <div className="settings-status-grid" aria-live="polite">
        <div><small>{t('settings.software')}</small><strong className={check?.installed ? 'settings-ok' : ''}>
          {checking ? '…' : !check ? t('settings.notChecked') : check.installed ? t('tools.installed') : t('settings.softwareMissing')}</strong></div>
        <div><small>{t('settings.authorization')}</small><strong className={check?.loggedIn ? 'settings-ok' : ''}>
          {checking ? '…' : check?.loggedIn ? t('settings.accountSignedIn') : check?.installed ? t('settings.signInRequired') : '—'}</strong></div>
        <div><small>{t('settings.version')}</small><strong>{check?.version || '—'}</strong></div>
      </div>
      {check?.account && <p className="field-hint">{check.account}</p>}
      {check?.authNote && <p className="field-hint">{check.authNote}</p>}
      {check?.error && <p className="settings-error">{check.error}</p>}
      {check?.installed === false && software && <div className="settings-install">
        {software.command && <code>{software.command}</code>}
        {software.error && <p className="field-hint">{software.error}</p>}
        <div className="field-row">
          {software.available && <button className="btn" disabled={installing} onClick={() => void install()}>{installing ? t('tools.installing') : t('settings.installAutomatically')}</button>}
          {software.url && <button className="btn" onClick={() => void api.live.openExternal(software.url!)}>{t('settings.installWebsite')}</button>}
        </div>
      </div>}
    </section>}
    {!isCli(provider) && software?.url && <section className="settings-card settings-install">
      <h2>{t('settings.applicationInstallation')}</h2>
      <p className="field-hint">{t('settings.applicationInstallHint')}</p>
      <div className="field-row">{software.available && <button className="btn" disabled={installing} onClick={() => void install()}>{installing ? t('tools.installing') : t('settings.installAutomatically')}</button>}
        <button className="btn" onClick={() => void api.live.openExternal(software.url!)}>{t('settings.downloadApplication')}</button></div>
    </section>}
    {(message || messageKey) && <p role="status" className="settings-card settings-message">{message || (messageKey && t(messageKey))}</p>}
    <section className="settings-card">
      <div className="settings-section-heading"><h2>{t('settings.remainingLimits')}</h2>
        {['codex', 'claude', 'openrouter', 'antigravity'].includes(provider) && <button className="btn" disabled={refreshingUsage} onClick={() => void refreshUsage()}>{refreshingUsage ? '…' : t('common.refresh')}</button>}</div>
      {provider === 'openrouter' && credits && <p className="field-hint">{credits.ok
        ? [t('settings.keyAllowance', { amount: typeof credits.remaining === 'number' ? new Intl.NumberFormat(localeForLanguage(s.appLanguage), { style: 'currency', currency: 'USD' }).format(credits.remaining) : credits.limit === null ? t('settings.keyNoCap') : t('settings.notReported') }),
          typeof credits.used === 'number' ? t('settings.keyUsed', { amount: new Intl.NumberFormat(localeForLanguage(s.appLanguage), { style: 'currency', currency: 'USD' }).format(credits.used) }) : ''].filter(Boolean).join(' · ')
        : credits.error}</p>}
      {usage?.windows.length ? <div className="settings-usage-list">{usage.windows.map((win) => {
        const remaining = Math.max(0, Math.min(100, 100 - win.percent))
        const label = usageWindowLabel(s.appLanguage, win.label)
        return <div className="usage-item" key={win.label}>
          <div className="usage-item-head"><span>{label}</span><strong>{t('settings.remaining', { percent: remaining })}</strong></div>
          <progress max="100" value={remaining} aria-label={label} />
          {win.resetsAt && <small>{t('settings.resetsAt')}{new Date(win.resetsAt).toLocaleString(localeForLanguage(s.appLanguage))}</small>}
        </div>
      })}</div> : !(provider === 'openrouter' && credits) && <p className="field-hint">{usage?.error || (provider === 'lmstudio' || provider === 'ollama' || provider === 'unsloth'
        ? t('settings.localLimitsUnavailable')
        : t('settings.limitsUnavailable'))}</p>}
      {usageUrl && <button className="btn" onClick={() => void api.live.openExternal(usageUrl)}>{t('settings.openAccountUsage')}</button>}
    </section>
    <section className="settings-card">
      <h2>{t('settings.connectionSettings')}</h2>
      <ConnectionSettings provider={provider} />
    </section>

  </>
}

export function SettingsView(): JSX.Element {
  const s = useApp()
  const t = (key: TranslationKey): string => tr(s.appLanguage, key)
  const section = s.settingsSection
  const select = (next: SettingsSection): void => { useApp.setState({ settingsSection: next }) }
  return <div className="settings-view">
    <aside className="settings-nav">
      <div className="settings-nav-title"><Icon name="settings" size={19} /><strong>{t('settings.title')}</strong></div>
      <button className="settings-back" onClick={() => s.setSettingsOpen(false)}><Icon name="arrowLeft" size={14} />{t('settings.backToWork')}</button>
      <nav aria-label={t('settings.sections')}>
        <button data-section="appearance" className={section === 'appearance' ? 'active' : ''} aria-current={section === 'appearance' ? 'page' : undefined} onClick={() => select('appearance')}><Icon name="settings" size={16} />{t('settings.appearance')}</button>
        <button data-section="providers" className={section === 'providers' ? 'active' : ''} aria-current={section === 'providers' ? 'page' : undefined} onClick={() => select('providers')}><Icon name="message" size={16} />{t('settings.agentProviders')}</button>
        {section === 'providers' && <div className="settings-provider-nav">{PROVIDERS.map((provider) => <button key={provider.id} data-provider={provider.id}
          className={s.settingsProvider === provider.id ? 'selected' : ''} aria-current={s.settingsProvider === provider.id ? 'page' : undefined}
          onClick={() => useApp.setState({ settingsProvider: provider.id })}>
          <span>{provider.name}</span><span className={`settings-visibility-dot${s.providerVisibility[provider.id] === false ? ' hidden' : ''}`} aria-label={s.providerVisibility[provider.id] === false ? t('settings.providerHidden') : t('settings.providerVisible')} />
        </button>)}</div>}
        <button data-section="limits" className={section === 'limits' ? 'active' : ''} aria-current={section === 'limits' ? 'page' : undefined} onClick={() => select('limits')}><Icon name="barChart" size={16} />{t('settings.usageLimits')}</button>
        <button data-section="tools" className={section === 'tools' ? 'active' : ''} aria-current={section === 'tools' ? 'page' : undefined} onClick={() => select('tools')}><Icon name="terminal" size={16} />{t('tools.title')}</button>
      </nav>
    </aside>
    <main className="settings-content" key={section === 'providers' ? s.settingsProvider : section}>
      {section === 'appearance' && <>
        <header className="settings-content-header"><div><div className="settings-eyebrow">ASCORA ADE</div><h1>{t('settings.appearance')}</h1><p>{t('settings.appearanceSubtitle')}</p></div></header>
        <section className="settings-card"><h2>{t('app.theme.label')}</h2><div className="settings-theme-options">
          {(['dark', 'light', 'system'] as ThemePreference[]).map((theme) => <button key={theme} data-theme={theme} className={`settings-theme${s.themePreference === theme ? ' selected' : ''}`} aria-pressed={s.themePreference === theme} onClick={() => s.setThemePreference(theme)}>
            <span className={`settings-theme-preview ${theme}`}><i /><i /><i /></span><span>{t(`app.theme.${theme}`)}{s.themePreference === theme && <Icon name="check" size={14} />}</span>
          </button>)}
        </div></section>
        <section className="settings-card"><h2>{t('app.language.label')}</h2><div className="settings-language-options">{LANGUAGE_OPTIONS.map((language) => <button key={language.value} data-language={language.value} className={s.appLanguage === language.value ? 'selected' : ''} aria-pressed={s.appLanguage === language.value} onClick={() => s.setAppLanguage(language.value)}>{t(language.labelKey)}{s.appLanguage === language.value && <Icon name="check" size={14} />}</button>)}</div></section>
      </>}
      {section === 'providers' && <ProviderPage provider={s.settingsProvider} />}
      {section === 'limits' && <CliLimitsPage />}
      <div hidden={section !== 'tools'}>{section === 'tools' && <DeveloperToolsPage />}</div>
    </main>
  </div>
}
