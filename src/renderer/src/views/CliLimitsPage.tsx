import { useEffect, useState, type JSX } from 'react'
import { api } from '@/lib/api'
import { CLI_PROVIDERS, PROVIDERS, type CliProvider } from '@/lib/providers'
import { useApp } from '@/state/store'
import { localeForLanguage, tr, type TranslationKey } from '@/language'
import { usageWindowLabel } from '@/language/usage'
import type { CodexCheckResult, UsageLimitResult } from '@shared/ipc'

interface LimitState {
  provider: CliProvider
  loading: boolean
  check?: CodexCheckResult
  usage?: UsageLimitResult
  checkedAt?: string
  updatedAt?: string
  error?: string
  errorKey?: TranslationKey
}

const usageReaders: Partial<Record<CliProvider, () => Promise<UsageLimitResult>>> = {
  codex: () => api.codex.usage(),
  claude: () => api.claude.usage(),
  antigravity: () => api.antigravity.usage()
}

// Each probe is independent: an unresponsive CLI must not block the other cards.
class CliCheckTimeout extends Error {}

function bounded<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CliCheckTimeout()), 30_000)
    request.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

export function CliLimitsPage(): JSX.Element {
  const language = useApp((state) => state.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string => tr(language, key, values)
  const [limits, setLimits] = useState<LimitState[]>(() => CLI_PROVIDERS.map((provider) => ({ provider, loading: true })))
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    let running = false
    const update = (result: LimitState): void => {
      if (!cancelled) setLimits((current) => current.map((entry) => entry.provider === result.provider ? result : entry))
    }
    const load = async (): Promise<void> => {
      if (running) return
      running = true
      setLimits((current) => current.map((entry) => ({ ...entry, loading: true })))
      await Promise.all(CLI_PROVIDERS.map(async (provider) => {
        let result: LimitState = { provider, loading: true }
        try {
          const check = await bounded(api[provider].check())
          if (cancelled) return
          result = { ...result, check, checkedAt: new Date().toISOString() }
          const readUsage = usageReaders[provider]
          if (check.installed && check.loggedIn && readUsage) {
            update(result)
            const usage = await bounded(readUsage())
            result = { ...result, usage, checkedAt: new Date().toISOString(), updatedAt: usage.ok ? new Date().toISOString() : undefined }
          }
        } catch (error) {
          result = { ...result, checkedAt: new Date().toISOString(), ...(error instanceof CliCheckTimeout
            ? { errorKey: 'settings.cliCheckTimeout' as const }
            : { error: error instanceof Error ? error.message : String(error) }) }
        }
        update({ ...result, loading: false })
      }))
      running = false
    }
    void load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [refresh])

  const checking = limits.some((entry) => entry.loading)
  const authorized = limits.filter((entry) => entry.check?.installed && entry.check.loggedIn)
  const failed = limits.filter((entry) => ((entry.error || entry.errorKey) && !entry.check) || (entry.check?.ok === false && !entry.check.loggedIn))
  const date = (value: string | undefined): JSX.Element | string => value && Number.isFinite(Date.parse(value))
    ? <time dateTime={value}>{new Date(value).toLocaleString(localeForLanguage(language))}</time>
    : t('settings.notReported')
  const openProvider = (provider: CliProvider): void => useApp.setState({ settingsSection: 'providers', settingsProvider: provider })

  return <>
    <header className="settings-content-header">
      <div><div className="settings-eyebrow">{t('settings.cliAccounts')}</div><h1>{t('settings.usageLimits')}</h1>
        <p>{t('settings.limitsSubtitle')}</p></div>
      <button className="btn" disabled={checking} onClick={() => setRefresh((value) => value + 1)}>{checking ? t('common.checking') : t('settings.refreshAll')}</button>
    </header>
    <div className="settings-limits-summary" role="status">
      <span>{t('settings.authorizedClis', { count: authorized.length })}{checking ? t('settings.loadingLimitsSummary') : ''}</span>
      <small>{t('settings.refreshesEveryMinute')}</small>
    </div>
    {!checking && !authorized.length && !failed.length && <div className="settings-card"><h2>{t('settings.noAuthorizedClis')}</h2>
      <p className="field-hint">{t('settings.noAuthorizedClisHint')}</p>
      <button className="btn" onClick={() => openProvider('codex')}>{t('settings.openProviders')}</button></div>}
    <div className="settings-limits-grid">{authorized.map((entry) => {
      const name = PROVIDERS.find((provider) => provider.id === entry.provider)!.name
      const windows = entry.usage?.ok ? entry.usage.windows.filter((window) => Number.isFinite(window.percent)) : []
      return <section className="settings-card settings-limit-card" key={entry.provider} data-provider={entry.provider} aria-busy={entry.loading}>
        <div className="settings-section-heading"><h2>{name}</h2><button className="btn" onClick={() => openProvider(entry.provider)}>{t('settings.title')}</button></div>
        {entry.check?.account && <p className="field-hint">{entry.check.account}</p>}
        {entry.loading ? <p className="field-hint" role="status">{t('settings.loadingLimits')}</p>
          : entry.errorKey || entry.error || entry.usage?.error ? <p className="settings-error">{entry.errorKey ? t(entry.errorKey) : entry.error || entry.usage?.error}</p>
          : windows.length ? <div className="settings-usage-list">{windows.map((window, index) => {
            const remaining = Math.round(Math.max(0, Math.min(100, 100 - window.percent)))
            const label = usageWindowLabel(language, window.label)
            return <div className={`usage-item severity-${window.severity}`} key={`${window.label}-${index}`}>
              <div className="usage-item-head"><span>{label}</span><strong>{t('settings.remaining', { percent: remaining })}</strong></div>
              <progress max="100" value={remaining} aria-label={`${name}: ${label}`} />
              <small>{t('settings.resetsAt')}{date(window.resetsAt)}</small>
            </div>
          })}</div>
          : <p className="field-hint">{entry.usage?.loggedIn === false
            ? t('settings.authorizationExpired')
            : usageReaders[entry.provider]
              ? t('settings.accountLimitsUnavailable')
              : t('settings.cliLimitsUnsupported')}</p>}
        {!entry.loading && <footer className="settings-limit-updated">{entry.updatedAt ? t('settings.limitsUpdated') : t('settings.limitsChecked')}{date(entry.updatedAt ?? entry.checkedAt)}</footer>}
      </section>
    })}</div>
    {failed.length > 0 && <section className="settings-card"><h2>{t('settings.cliCheckFailed')}</h2>{failed.map((entry) => <p className="field-hint" key={entry.provider}>{PROVIDERS.find((provider) => provider.id === entry.provider)!.name}: {entry.errorKey ? t(entry.errorKey) : entry.error || entry.check?.error}</p>)}</section>}
  </>
}
