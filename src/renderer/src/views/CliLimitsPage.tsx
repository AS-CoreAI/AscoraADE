import { useEffect, useState, type JSX } from 'react'
import { api } from '@/lib/api'
import { CLI_PROVIDERS, PROVIDERS, type CliProvider } from '@/lib/providers'
import { useApp } from '@/state/store'
import type { CodexCheckResult, UsageLimitResult } from '@shared/ipc'

interface LimitState {
  provider: CliProvider
  loading: boolean
  check?: CodexCheckResult
  usage?: UsageLimitResult
  checkedAt?: string
  updatedAt?: string
  error?: string
}

const usageReaders: Partial<Record<CliProvider, () => Promise<UsageLimitResult>>> = {
  codex: () => api.codex.usage(),
  claude: () => api.claude.usage(),
  antigravity: () => api.antigravity.usage()
}

// Each probe is independent: an unresponsive CLI must not block the other cards.
function bounded<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI check timed out (30s).')), 30_000)
    request.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

export function CliLimitsPage(): JSX.Element {
  const language = useApp((state) => state.appLanguage)
  const ru = language === 'ru'
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
          result = { ...result, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
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
  const failed = limits.filter((entry) => (entry.error && !entry.check) || (entry.check?.ok === false && !entry.check.loggedIn))
  const date = (value: string | undefined): JSX.Element | string => value && Number.isFinite(Date.parse(value))
    ? <time dateTime={value}>{new Date(value).toLocaleString(language)}</time>
    : (ru ? 'Не сообщается' : 'Not reported')
  const openProvider = (provider: CliProvider): void => useApp.setState({ settingsSection: 'providers', settingsProvider: provider })

  return <>
    <header className="settings-content-header">
      <div><div className="settings-eyebrow">{ru ? 'УЧЁТНЫЕ ЗАПИСИ CLI' : 'CLI ACCOUNTS'}</div><h1>{ru ? 'Лимиты' : 'Usage limits'}</h1>
        <p>{ru ? 'Остатки и даты сброса лимитов установленных CLI с выполненным входом, включая скрытые из списка провайдеров.' : 'Remaining allowances and reset dates for installed, signed-in CLIs, including providers hidden from the menu.'}</p></div>
      <button className="btn" disabled={checking} onClick={() => setRefresh((value) => value + 1)}>{checking ? (ru ? 'Проверка…' : 'Checking…') : (ru ? 'Обновить всё' : 'Refresh all')}</button>
    </header>
    <div className="settings-limits-summary" role="status">
      <span>{ru ? `Авторизовано CLI: ${authorized.length}` : `Signed-in CLIs: ${authorized.length}`}{checking ? (ru ? ' · Получаем данные…' : ' · Loading…') : ''}</span>
      <small>{ru ? 'Автообновление раз в минуту' : 'Refreshes every minute'}</small>
    </div>
    {!checking && !authorized.length && !failed.length && <div className="settings-card"><h2>{ru ? 'Нет авторизованных CLI' : 'No signed-in CLIs'}</h2>
      <p className="field-hint">{ru ? 'Установите CLI и войдите в учётную запись в разделе «Провайдеры агентов».' : 'Install a CLI and sign in under Agent providers.'}</p>
      <button className="btn" onClick={() => openProvider('codex')}>{ru ? 'Открыть провайдеры' : 'Open providers'}</button></div>}
    <div className="settings-limits-grid">{authorized.map((entry) => {
      const name = PROVIDERS.find((provider) => provider.id === entry.provider)!.name
      const windows = entry.usage?.ok ? entry.usage.windows.filter((window) => Number.isFinite(window.percent)) : []
      return <section className="settings-card settings-limit-card" key={entry.provider} data-provider={entry.provider} aria-busy={entry.loading}>
        <div className="settings-section-heading"><h2>{name}</h2><button className="btn" onClick={() => openProvider(entry.provider)}>{ru ? 'Настройки' : 'Settings'}</button></div>
        {entry.check?.account && <p className="field-hint">{entry.check.account}</p>}
        {entry.loading ? <p className="field-hint" role="status">{ru ? 'Получаем лимиты…' : 'Loading limits…'}</p>
          : entry.error || entry.usage?.error ? <p className="settings-error">{entry.error || entry.usage?.error}</p>
          : windows.length ? <div className="settings-usage-list">{windows.map((window, index) => {
            const remaining = Math.round(Math.max(0, Math.min(100, 100 - window.percent)))
            return <div className={`usage-item severity-${window.severity}`} key={`${window.label}-${index}`}>
              <div className="usage-item-head"><span>{window.label}</span><strong>{remaining}% {ru ? 'осталось' : 'remaining'}</strong></div>
              <progress max="100" value={remaining} aria-label={`${name}: ${window.label}`} />
              <small>{ru ? 'Сброс лимита: ' : 'Resets: '}{date(window.resetsAt)}</small>
            </div>
          })}</div>
          : <p className="field-hint">{entry.usage?.loggedIn === false
            ? (ru ? 'Авторизация истекла. Выполните вход в настройках провайдера.' : 'Authorization expired. Sign in in provider settings.')
            : usageReaders[entry.provider]
              ? (ru ? 'Провайдер не сообщил лимиты для этой учётной записи.' : 'The provider did not report limits for this account.')
              : (ru ? 'Получение лимитов для этого CLI пока не поддерживается. Остаток и дата сброса недоступны.' : 'Usage reporting for this CLI is not supported yet. Remaining allowance and reset date are unavailable.')}</p>}
        {!entry.loading && <footer className="settings-limit-updated">{entry.updatedAt ? (ru ? 'Данные обновлены: ' : 'Updated: ') : (ru ? 'Проверено: ' : 'Checked: ')}{date(entry.updatedAt ?? entry.checkedAt)}</footer>}
      </section>
    })}</div>
    {failed.length > 0 && <section className="settings-card"><h2>{ru ? 'Не удалось проверить CLI' : 'Could not check CLIs'}</h2>{failed.map((entry) => <p className="field-hint" key={entry.provider}>{PROVIDERS.find((provider) => provider.id === entry.provider)!.name}: {entry.error || entry.check?.error}</p>)}</section>}
  </>
}
