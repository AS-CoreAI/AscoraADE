import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import type { PublicIpStatus, VpnProtocol, VpnServer, VpnStatus, VpnTrafficStats } from '@shared/ipc'
import { Icon } from '@/components/Icon'
import { tr, type TranslationKey } from '@/language'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'

const EMPTY_IP: PublicIpStatus = {
  state: 'checking',
  ip: null,
  countryCode: null,
  vpnRecommended: false,
  checkedAt: null
}

function countryName(code: string | null, language: string): string {
  if (!code) return '—'
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

function stateKey(state: VpnStatus['state']): TranslationKey {
  if (state === 'connected') return 'vpn.connected'
  if (state === 'connecting') return 'vpn.connecting'
  if (state === 'disconnecting') return 'vpn.disconnecting'
  if (state === 'error') return 'vpn.error'
  return 'vpn.disconnected'
}

function protocolSupported(server: VpnServer, protocol: VpnProtocol): boolean {
  return protocol === 'wireguard' ? server.supportsWireguard : server.supportsOpenvpn
}

function formatBytes(bytes: number, language: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes < 1024 * 1024) return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(bytes / 1024 / 1024 / 1024)} GB`
}

function friendlyError(message: string | undefined, translate: (key: TranslationKey) => string): string | null {
  if (!message) return null
  if (/vpn_api_unreachable|fetch failed|enotfound|getaddrinfo|unknown host|host is unknown/i.test(message)) {
    return translate('vpn.apiUnavailable')
  }
  if (message === 'anonymous_daily_limit_exceeded') return translate('vpn.limitReached')
  return message
}

export function VpnView(): JSX.Element {
  const language = useApp((state) => state.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(language, key, values)
  const [status, setStatus] = useState<VpnStatus | null>(null)
  const [publicIp, setPublicIp] = useState<PublicIpStatus>(EMPTY_IP)
  const [servers, setServers] = useState<VpnServer[]>([])
  const [loadingServers, setLoadingServers] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [apiUrl, setApiUrl] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [traffic, setTraffic] = useState<VpnTrafficStats | null>(null)

  useEffect(() => {
    let alive = true
    const offVpn = api.vpn.onStatusChanged((next) => {
      if (!alive) return
      setStatus(next)
      setApiUrl(next.settings.apiBaseUrl)
    })
    const offNetwork = api.network.onStatusChanged((next) => {
      if (alive) setPublicIp(next)
    })
    void api.vpn.status().then((next) => {
      if (!alive) return
      setStatus(next)
      setApiUrl(next.settings.apiBaseUrl)
    }).catch((error: unknown) => alive && setActionError(error instanceof Error ? error.message : String(error)))
    void api.network.publicIp().then((next) => alive && setPublicIp(next))
    void api.vpn.servers().then((result) => {
      if (!alive) return
      setServers(result.servers)
      setLoadingServers(false)
      if (!result.ok) setActionError(result.error ?? t('vpn.noServers'))
    })
    const refreshTraffic = (): void => {
      void api.vpn.traffic().then((result) => {
        if (alive && result.ok) setTraffic(result.traffic)
      })
    }
    refreshTraffic()
    const trafficTimer = setInterval(refreshTraffic, 30_000)
    return () => {
      alive = false
      clearInterval(trafficTimer)
      offVpn()
      offNetwork()
    }
  // Translation changes should not recreate native subscriptions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const protocol = status?.settings.protocol ?? 'wireguard'
  const busy = status?.state === 'connecting' || status?.state === 'disconnecting'
  const connected = status?.state === 'connected'
  const compatibleServers = useMemo(
    () => servers.filter((server) => protocolSupported(server, protocol)),
    [protocol, servers]
  )
  const onlineServers = compatibleServers.filter((server) => server.status === 'online')
  const country = countryName(publicIp.countryCode, language)
  const activeDependency = status?.dependencies[protocol]
  const canSelectServer = status?.account.tier === 'paid'

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    setActionError(null)
    try {
      const [nextStatus, nextIp, result, trafficResult] = await Promise.all([
        api.vpn.status(true),
        api.network.publicIp(true),
        api.vpn.servers(true),
        api.vpn.traffic()
      ])
      setStatus(nextStatus)
      setApiUrl(nextStatus.settings.apiBaseUrl)
      setPublicIp(nextIp)
      setServers(result.servers)
      if (trafficResult.ok) setTraffic(trafficResult.traffic)
      if (!result.ok) setActionError(result.error ?? t('vpn.noServers'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRefreshing(false)
      setLoadingServers(false)
    }
  }

  const setProtocol = async (nextProtocol: VpnProtocol): Promise<void> => {
    if (busy || connected || nextProtocol === protocol) return
    setActionError(null)
    try {
      setStatus(await api.vpn.configure({ protocol: nextProtocol }))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const setServer = async (serverId: string): Promise<void> => {
    if (busy || connected) return
    setActionError(null)
    try {
      setStatus(await api.vpn.configure({ serverId: serverId || null }))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const saveEndpoint = async (): Promise<void> => {
    if (!status || busy || connected || apiUrl === status.settings.apiBaseUrl) return
    setActionError(null)
    try {
      const next = await api.vpn.configure({ apiBaseUrl: apiUrl })
      setStatus(next)
      setLoadingServers(true)
      const result = await api.vpn.servers(true)
      setServers(result.servers)
      if (!result.ok) setActionError(result.error ?? t('vpn.noServers'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingServers(false)
    }
  }

  const toggleVpn = async (): Promise<void> => {
    if (!status || busy) return
    setActionError(null)
    try {
      const next = connected
        ? await api.vpn.disconnect()
        : await api.vpn.connect({ protocol, serverId: status.settings.serverId })
      setStatus(next)
      if (next.error) setActionError(next.error)
      const trafficResult = await api.vpn.traffic()
      if (trafficResult.ok) setTraffic(trafficResult.traffic)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const submitAuth = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (authBusy || !authEmail.trim() || !authPassword) return
    setAuthBusy(true)
    setActionError(null)
    try {
      const result = authMode === 'login'
        ? await api.vpn.login({ email: authEmail, password: authPassword })
        : await api.vpn.register({ email: authEmail, password: authPassword })
      setStatus(result.status)
      if (!result.ok) {
        setActionError(result.error ?? t('vpn.error'))
      } else {
        setAuthOpen(false)
        setAuthPassword('')
        const refreshed = await api.vpn.servers(true)
        setServers(refreshed.servers)
        const trafficResult = await api.vpn.traffic()
        if (trafficResult.ok) setTraffic(trafficResult.traffic)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setAuthBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    if (authBusy || busy) return
    setAuthBusy(true)
    setActionError(null)
    try {
      const result = await api.vpn.logout()
      setStatus(result.status)
      if (!result.ok) setActionError(result.error ?? t('vpn.error'))
      else {
        setAuthEmail('')
        setAuthPassword('')
        const trafficResult = await api.vpn.traffic()
        if (trafficResult.ok) setTraffic(trafficResult.traffic)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setAuthBusy(false)
    }
  }

  const trafficUsed = traffic?.usedBytes ?? traffic?.todayBytes ?? 0
  const trafficPercent = traffic?.limitBytes
    ? Math.min(100, Math.round((trafficUsed / traffic.limitBytes) * 100))
    : 0
  const trafficReset = traffic?.resetAt
    ? new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(new Date(traffic.resetAt))
    : null

  return (
    <div className="vpn-view">
      <div className="vpn-page">
        <header className="vpn-page-head">
          <div className="vpn-page-heading">
            <span className="vpn-page-icon"><Icon name="shield" size={21} /></span>
            <div>
              <h1>{t('vpn.title')}</h1>
              <p>{t('vpn.subtitle')}</p>
            </div>
          </div>
          <button className="btn vpn-refresh" type="button" disabled={refreshing || busy} onClick={() => void refresh()}>
            <Icon name="refresh" size={14} />
            {t('vpn.refreshDiagnostics')}
          </button>
        </header>

        <section className={`vpn-hero ${status?.state ?? 'disconnected'}`}>
          <div className="vpn-hero-orbit" aria-hidden="true"><Icon name="shield" size={36} /></div>
          <div className="vpn-hero-copy">
            <span className="vpn-eyebrow">Wandrounik VPN</span>
            <h2>{status ? t(stateKey(status.state)) : t('common.checking')}</h2>
            <p>{status?.serverLabel ?? (connected ? status?.endpoint : t('vpn.connectionHint'))}</p>
          </div>
          <label className={`vpn-master-switch${connected ? ' checked' : ''}${busy ? ' busy' : ''}`}>
            <input
              type="checkbox"
              role="switch"
              checked={connected}
              disabled={!status || busy}
              aria-label={connected ? t('vpn.disconnect') : t('vpn.connect')}
              onChange={() => void toggleVpn()}
            />
            <span className="vpn-master-track"><span /></span>
            <strong>{connected ? t('vpn.disconnect') : busy ? t(stateKey(status?.state ?? 'connecting')) : t('vpn.connect')}</strong>
          </label>
        </section>

        {friendlyError(actionError ?? status?.error, t) && (
          <div className="vpn-notice error" role="alert">
            <Icon name="info" size={17} />
            <div><strong>{t('vpn.error')}</strong><span>{friendlyError(actionError ?? status?.error, t)}</span></div>
          </div>
        )}

        {publicIp.state === 'ready' && (
          <div className={`vpn-notice ${publicIp.vpnRecommended ? 'restricted' : 'safe'}`}>
            <Icon name={publicIp.vpnRecommended ? 'info' : 'shield'} size={17} />
            <span>
              {publicIp.vpnRecommended
                ? t('vpn.restrictedNotice', { country })
                : t('vpn.safeNotice')}
            </span>
          </div>
        )}

        <section className="vpn-stat-grid">
          <article><span>{t('vpn.publicIp')}</span><strong>{publicIp.ip ?? '—'}</strong><small>{publicIp.state === 'checking' ? t('common.checking') : country}</small></article>
          <article><span>{t('vpn.country')}</span><strong>{publicIp.countryCode ?? '—'}</strong><small>{country}</small></article>
          <article><span>{t('vpn.driver')}</span><strong>{protocol === 'wireguard' ? 'WireGuard' : 'OpenVPN'}</strong><small className={activeDependency?.available ? 'good' : 'bad'}>{activeDependency?.available ? t('vpn.ready') : t('vpn.missing')}</small></article>
          <article><span>{t('vpn.currentServer')}</span><strong>{status?.serverLabel ?? '—'}</strong><small>{status?.endpoint ?? t('vpn.automatic')}</small></article>
        </section>

        {traffic && (
          <section className="vpn-panel vpn-traffic-panel">
            <div className="vpn-panel-title"><div><strong>{t('vpn.traffic')}</strong><span>{t('vpn.trafficHint')}</span></div><span className={`vpn-traffic-source${traffic.source === 'anonymous' ? ' anonymous' : ''}`}>{traffic.source === 'anonymous' ? t('vpn.anonymous') : status?.account.tier === 'paid' ? t('vpn.premium') : t('vpn.free')}</span></div>
            {traffic.limitBytes !== null && (
              <div className={`vpn-traffic-limit${traffic.limitExceeded ? ' exceeded' : ''}`}>
                <div><span>{t('vpn.dailyLimit')}</span><strong>{formatBytes(trafficUsed, language)} / {formatBytes(traffic.limitBytes, language)}</strong></div>
                <div className="vpn-traffic-track"><span style={{ width: `${trafficPercent}%` }} /></div>
                <small>{traffic.limitExceeded ? t('vpn.limitReached') : trafficReset ? t('vpn.resetsAt', { time: trafficReset }) : ''}</small>
              </div>
            )}
            <div className={`vpn-traffic-grid${traffic.source === 'anonymous' ? ' compact' : ''}`}>
              <article><span>{t('vpn.today')}</span><strong>{formatBytes(traffic.todayBytes, language)}</strong></article>
              {traffic.source === 'account' && <article><span>{t('vpn.thisWeek')}</span><strong>{formatBytes(traffic.weekBytes, language)}</strong></article>}
              {traffic.source === 'account' && <article><span>{t('vpn.thisMonth')}</span><strong>{formatBytes(traffic.monthBytes, language)}</strong></article>}
              {traffic.source === 'account' && <article><span>{t('vpn.allTime')}</span><strong>{formatBytes(traffic.allTimeBytes, language)}</strong></article>}
              {traffic.remainingBytes !== null && <article><span>{t('vpn.remaining')}</span><strong>{formatBytes(traffic.remainingBytes, language)}</strong></article>}
            </div>
          </section>
        )}

        <div className="vpn-layout">
          <section className="vpn-panel vpn-connection-panel">
            <div className="vpn-panel-title"><div><strong>{t('vpn.connection')}</strong><span>{t('vpn.connectionHint')}</span></div></div>
            <div className="vpn-form">
              <label>
                <span>{t('vpn.protocol')}</span>
                <div className="vpn-protocol-picker">
                  {(['wireguard', 'openvpn'] as VpnProtocol[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={protocol === item ? 'active' : ''}
                      disabled={busy || connected}
                      onClick={() => void setProtocol(item)}
                    >
                      <Icon name={item === 'wireguard' ? 'shield' : 'globe'} size={15} />
                      {item === 'wireguard' ? 'WireGuard' : 'OpenVPN'}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>{t('vpn.server')}</span>
                <select
                  className="text-input"
                  value={status?.settings.serverId ?? ''}
                  disabled={!status || busy || connected || !canSelectServer}
                  onChange={(event) => void setServer(event.target.value)}
                >
                  <option value="">{t('vpn.automatic')}</option>
                  {onlineServers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.countryCode} · {server.city || server.country} · {server.load}%
                    </option>
                  ))}
                </select>
                {!canSelectServer && <small className="vpn-premium-hint"><Icon name="key" size={12} />{t('vpn.serverPremium')}</small>}
              </label>
              <label>
                <span>{t('vpn.apiEndpoint')}</span>
                <div className="vpn-endpoint-row">
                  <input
                    className="text-input"
                    value={apiUrl}
                    disabled={!status || busy || connected}
                    spellCheck={false}
                    onChange={(event) => setApiUrl(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void saveEndpoint() }}
                  />
                  <button className="btn" type="button" disabled={!status || busy || connected || apiUrl === status.settings.apiBaseUrl} onClick={() => void saveEndpoint()}>{t('common.save')}</button>
                </div>
              </label>
            </div>
          </section>

          <section className="vpn-panel vpn-dependencies-panel">
            <div className="vpn-panel-title"><div><strong>{t('vpn.dependencies')}</strong><span>{t('vpn.dependenciesHint')}</span></div></div>
            <div className="vpn-dependency-list">
              {status && (['wireguard', 'openvpn'] as VpnProtocol[]).map((item) => {
                const dependency = status.dependencies[item]
                return (
                  <article key={item} className={dependency.available ? 'ready' : 'missing'}>
                    <span><Icon name={item === 'wireguard' ? 'shield' : 'globe'} size={17} /></span>
                    <div><strong>{item === 'wireguard' ? 'WireGuard' : 'OpenVPN'}</strong><small title={dependency.executable ?? dependency.hint}>{dependency.executable ?? t('vpn.installDriver', { name: item === 'wireguard' ? 'WireGuard' : 'OpenVPN' })}</small></div>
                    <em>{dependency.available ? t('vpn.ready') : t('vpn.missing')}</em>
                  </article>
                )
              })}
            </div>
            <div className="vpn-account-card">
              <div className="vpn-account-head">
                <span className="vpn-account-icon"><Icon name="users" size={16} /></span>
                <div>
                  <strong>{t('vpn.account')}</strong>
                  <small>{status?.account.authenticated ? status.account.email : t('vpn.accountHint')}</small>
                </div>
                <em className={status?.account.tier === 'paid' ? 'premium' : ''}>
                  {status?.account.tier === 'paid' ? t('vpn.premium') : status?.account.tier === 'free' ? t('vpn.free') : t('vpn.anonymous')}
                </em>
              </div>
              {status?.account.authenticated ? (
                <button className="btn vpn-account-action" type="button" disabled={authBusy || busy} onClick={() => void logout()}>{t('vpn.signOut')}</button>
              ) : authOpen ? (
                <form className="vpn-auth-form" onSubmit={(event) => void submitAuth(event)}>
                  <input className="text-input" type="email" autoComplete="username" placeholder={t('vpn.email')} value={authEmail} disabled={authBusy} onChange={(event) => setAuthEmail(event.target.value)} />
                  <input className="text-input" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={authMode === 'register' ? 8 : undefined} placeholder={t('vpn.password')} value={authPassword} disabled={authBusy} onChange={(event) => setAuthPassword(event.target.value)} />
                  <div className="vpn-auth-actions">
                    <button className="btn primary" type="submit" disabled={authBusy || !authEmail.trim() || !authPassword}>{authMode === 'login' ? t('vpn.signIn') : t('vpn.register')}</button>
                    <button className="vpn-auth-mode" type="button" disabled={authBusy} onClick={() => { setAuthMode((mode) => mode === 'login' ? 'register' : 'login'); setAuthPassword('') }}>{authMode === 'login' ? t('vpn.switchToRegister') : t('vpn.switchToSignIn')}</button>
                  </div>
                </form>
              ) : (
                <>
                  <button className="btn vpn-account-action" type="button" onClick={() => setAuthOpen(true)}>{t('vpn.signIn')} / {t('vpn.register')}</button>
                  <div className="vpn-anonymous-note"><Icon name="info" size={15} /><span>{t('vpn.anonymousDetail')}</span></div>
                </>
              )}
            </div>
          </section>
        </div>

        <section className="vpn-panel vpn-servers-panel">
          <div className="vpn-panel-title"><div><strong>{t('vpn.servers')}</strong><span>{t('vpn.serversHint')}</span></div><span className="vpn-count">{compatibleServers.length}</span></div>
          {loadingServers ? (
            <div className="vpn-empty"><span className="vpn-spinner" />{t('common.checking')}</div>
          ) : compatibleServers.length === 0 ? (
            <div className="vpn-empty"><Icon name="server" size={22} />{t('vpn.noServers')}</div>
          ) : (
            <div className="vpn-server-grid">
              {compatibleServers.map((server) => (
                <button
                  type="button"
                  key={server.id}
                  disabled={busy || connected || !canSelectServer || server.status !== 'online'}
                  className={`${status?.settings.serverId === server.id ? 'selected ' : ''}${server.status}`.trim()}
                  onClick={() => void setServer(server.id)}
                >
                  <span className="vpn-country-code">{server.countryCode || '—'}</span>
                  <span className="vpn-server-copy"><strong>{server.city || server.country}</strong><small>{server.country} · {server.host}</small></span>
                  <span className="vpn-server-metrics"><em>{server.status === 'online' ? `${server.load}% ${t('vpn.load')}` : t('vpn.offline')}</em><small>{server.pingMs === null ? '—' : `${server.pingMs} ms ${t('vpn.ping')}`}</small></span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
