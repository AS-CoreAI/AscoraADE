import { app, BrowserWindow, safeStorage } from 'electron'
import { createHash, createHmac, generateKeyPairSync, randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { access, chmod, mkdir, readFile, readlink, rename, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { isIP } from 'node:net'
import { createConnection } from 'node:net'
import path from 'node:path'
import { IPC, type VpnAccountTier, type VpnAuthRequest, type VpnAuthResult, type VpnConfigureRequest, type VpnConnectRequest, type VpnDependencyStatus, type VpnPaymentCheckout, type VpnPaymentCreateResult, type VpnPaymentPlanCode, type VpnPaymentSyncResult, type VpnProtocol, type VpnServer, type VpnServersResult, type VpnSettings, type VpnStatus, type VpnTrafficResult, type VpnTrafficStats } from '../../shared/ipc'
import { getPublicIpStatus } from '../network/public-ip'

const DEFAULT_API_URL = 'https://wandrounikvpn.asted.cloud'
const REQUEST_TIMEOUT_MS = 15_000
const SERVER_CACHE_MS = 60_000
const TUNNEL_NAME = 'ascora-wandrounik'
const ANONYMOUS_DAILY_LIMIT = 100 * 1024 * 1024
const USAGE_POLL_MS = 30_000

type ApiRecord = Record<string, unknown>

interface StoredSession {
  protocol: VpnProtocol
  peerId: number | null
  anonymousSessionId: string | null
  serverId: string | null
  serverLabel: string | null
  endpoint: string | null
  assignedIp: string | null
  connectedAt: number
  processPid?: number
}

interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

type OpenvpnWindowsDriver = 'wintun' | 'tap-windows6'

interface TokenPair {
  accessToken: string
  refreshToken: string
  email: string
  tier: Exclude<VpnAccountTier, 'anonymous'>
}

interface EncryptedTokenPair {
  accessToken: string
  refreshToken: string
  email: string
  tier: Exclude<VpnAccountTier, 'anonymous'>
}

interface AnonymousUsageData {
  date: string
  usedBytes: number
}

class VpnApiError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
  }
}

let settings: VpnSettings = {
  protocol: 'wireguard',
  serverId: null,
  apiBaseUrl: process.env.WANDROUNIK_API_URL?.trim() || DEFAULT_API_URL
}
let current: VpnStatus = {
  state: 'disconnected',
  protocol: settings.protocol,
  serverId: null,
  serverLabel: null,
  endpoint: null,
  assignedIp: null,
  connectedAt: null,
  settings,
  account: { authenticated: false, email: null, tier: 'anonymous' },
  dependencies: {
    wireguard: { available: false, executable: null },
    openvpn: { available: false, executable: null }
  }
}
let session: StoredSession | null = null
let initialized: Promise<void> | null = null
let operation: Promise<VpnStatus> | null = null
let openVpnProcess: ChildProcess | null = null
let serverCache: { at: number; servers: VpnServer[] } | null = null
let dependencyCache: { at: number; value: VpnStatus['dependencies'] } | null = null
let tokens: TokenPair | null = null
let tokenRefresh: Promise<boolean> | null = null
let anonymousUsage: AnonymousUsageData | null = null
let anonymousBaseline: number | null = null
let usageTimer: ReturnType<typeof setInterval> | null = null
let usageTickRunning = false

function vpnDir(): string {
  return path.join(app.getPath('userData'), 'vpn')
}

function settingsPath(): string {
  return path.join(vpnDir(), 'settings.json')
}

function sessionPath(): string {
  return path.join(vpnDir(), 'session.json')
}

function tokensPath(): string {
  return path.join(vpnDir(), 'tokens.json')
}

function devicePath(): string {
  return path.join(vpnDir(), 'device.json')
}

function usagePath(): string {
  return path.join(vpnDir(), 'anonymous-usage.json')
}

function wireguardConfigPath(): string {
  return path.join(vpnDir(), `${TUNNEL_NAME}.conf`)
}

function openvpnConfigPath(): string {
  return path.join(vpnDir(), `${TUNNEL_NAME}.ovpn`)
}

function openvpnLogPath(): string {
  return path.join(vpnDir(), `${TUNNEL_NAME}.log`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function publish(patch: Partial<VpnStatus>): VpnStatus {
  current = { ...current, ...patch, settings: { ...settings } }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.vpn.statusChanged, current)
  }
  return current
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600).catch(() => undefined)
}

function normalizeTier(value: unknown): Exclude<VpnAccountTier, 'anonymous'> {
  return ['paid', 'premium', 'pro', 'advanced'].includes(string(value).toLowerCase()) ? 'paid' : 'free'
}

function accessTokenExpiresSoon(accessToken: string, skewSeconds = 30): boolean {
  try {
    const [, encodedPayload] = accessToken.split('.')
    if (!encodedPayload) return false
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1000) + skewSeconds
  } catch {
    // Opaque/non-JWT access tokens are refreshed through the normal 401 path.
    return false
  }
}

function encryptToken(value: string): string {
  return safeStorage.encryptString(value).toString('base64')
}

function decryptToken(value: string): string {
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

async function persistTokens(next: TokenPair): Promise<void> {
  tokens = next
  if (!safeStorage.isEncryptionAvailable()) {
    await rm(tokensPath(), { force: true }).catch(() => undefined)
    return
  }
  const encrypted: EncryptedTokenPair = {
    accessToken: encryptToken(next.accessToken),
    refreshToken: encryptToken(next.refreshToken),
    email: encryptToken(next.email),
    tier: next.tier
  }
  await writePrivateJson(tokensPath(), encrypted)
}

async function loadTokens(): Promise<TokenPair | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  const stored = await readJson<EncryptedTokenPair>(tokensPath())
  if (!stored?.accessToken || !stored.refreshToken || !stored.email) return null
  try {
    return {
      accessToken: decryptToken(stored.accessToken),
      refreshToken: decryptToken(stored.refreshToken),
      email: decryptToken(stored.email),
      tier: normalizeTier(stored.tier)
    }
  } catch {
    await rm(tokensPath(), { force: true }).catch(() => undefined)
    return null
  }
}

async function clearTokens(): Promise<void> {
  tokens = null
  await rm(tokensPath(), { force: true }).catch(() => undefined)
  publish({ account: { authenticated: false, email: null, tier: 'anonymous' } })
}

async function deviceFingerprint(): Promise<string> {
  let stored = await readJson<{ id?: string }>(devicePath())
  if (!stored?.id) {
    stored = { id: randomUUID() }
    await writePrivateJson(devicePath(), stored)
  }
  return createHash('sha256').update(`ascora-wandrounik:${stored.id}`).digest('hex')
}

const execFileAsync = promisify(execFile)

// Shared secret proving the request comes from an official client app.
// Must match CLIENT_API_SHARED_SECRET on the Wandrounik Control Panel (and
// the copy in the Wandrounik VPN client).
const VPN_CLIENT_API_SECRET =
  process.env.WANDROUNIK_CLIENT_SECRET ?? 'REMOVED_DEPLOYMENT_SECRET'

async function hardwareMachineIdentifier(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('reg.exe', [
        'query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'
      ], { windowsHide: true, timeout: 4000 })
      return stdout.match(/MachineGuid\s+REG_SZ\s+(.+)/i)?.[1]?.trim() ?? null
    }
    if (process.platform === 'linux') {
      return (await readFile('/etc/machine-id', 'utf8')).trim() || null
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 4000 })
      return stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? null
    }
  } catch {
    return null
  }
  return null
}

let cachedMachineId: string | null = null

// Stable per-physical-machine identifier shared by every Wandrounik-family
// product (Wandrounik VPN, Ascora ADE): the server enforces the shared daily
// traffic limit by this value, so the derivation must stay identical across
// products (see Wandrounik client src/main/device.ts).
async function getMachineId(): Promise<string> {
  if (!cachedMachineId) {
    const stableId = (await hardwareMachineIdentifier()) ?? (await deviceFingerprint())
    cachedMachineId = createHash('sha256')
      .update(`wandrounik-machine:${stableId.trim().toLowerCase()}`)
      .digest('hex')
  }
  return cachedMachineId
}

async function clientProofHeaders(body: string): Promise<Record<string, string>> {
  const machineId = await getMachineId()
  const ts = Math.floor(Date.now() / 1000).toString()
  const proof = createHmac('sha256', VPN_CLIENT_API_SECRET)
    .update(`${ts}.${machineId}.${body}`)
    .digest('hex')
  return { 'X-Machine-Id': machineId, 'X-Client-Ts': ts, 'X-Client-Proof': proof }
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value.trim())
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('The VPN API URL must use HTTPS (HTTP is allowed only for localhost).')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The VPN API URL cannot contain credentials, a query, or a fragment.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

function isProtocol(value: unknown): value is VpnProtocol {
  return value === 'wireguard' || value === 'openvpn'
}

async function saveSettings(): Promise<void> {
  await writePrivateJson(settingsPath(), settings)
}

async function saveSession(next: StoredSession): Promise<void> {
  session = next
  await writePrivateJson(sessionPath(), next)
}

async function clearSession(): Promise<void> {
  session = null
  await rm(sessionPath(), { force: true }).catch(() => undefined)
}

async function executable(pathname: string | undefined): Promise<string | null> {
  if (!pathname) return null
  try {
    await access(pathname, fsConstants.X_OK)
    return pathname
  } catch {
    return null
  }
}

async function firstExecutable(candidates: Array<string | undefined>): Promise<string | null> {
  for (const candidate of candidates) {
    const found = await executable(candidate)
    if (found) return found
  }
  return null
}

function pathCandidates(command: string): string[] {
  const extensions = process.platform === 'win32' ? ['', '.exe'] : ['']
  return (process.env.PATH ?? '').split(path.delimiter).flatMap((directory) =>
    extensions.map((extension) => path.join(directory, `${command}${extension}`))
  )
}

async function detectDependencies(force = false): Promise<VpnStatus['dependencies']> {
  if (!force && dependencyCache && Date.now() - dependencyCache.at < 30_000) return dependencyCache.value
  const bundled = bundledVpnRoot()
  const wireguard = await firstExecutable([
    bundled ? path.join(bundled, 'wireguard', 'wireguard.exe') : undefined,
    process.env.WIREGUARD_EXE,
    process.platform === 'win32' ? 'C:\\Program Files\\WireGuard\\wireguard.exe' : undefined,
    ...pathCandidates(process.platform === 'win32' ? 'wireguard' : 'wg-quick')
  ])
  const openvpn = await firstExecutable([
    bundled ? path.join(bundled, 'openvpn', 'openvpn.exe') : undefined,
    process.env.OPENVPN_EXE,
    process.platform === 'win32' ? 'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe' : undefined,
    ...pathCandidates('openvpn')
  ])
  const value: VpnStatus['dependencies'] = {
    wireguard: dependency(wireguard, 'WireGuard'),
    openvpn: dependency(openvpn, 'OpenVPN')
  }
  dependencyCache = { at: Date.now(), value }
  return value
}

function dependency(executablePath: string | null, name: string): VpnDependencyStatus {
  return executablePath
    ? { available: true, executable: executablePath }
    : { available: false, executable: null, hint: `Install ${name} or configure its executable path in the environment.` }
}

function runProcess(executablePath: string, args: string[], timeoutMs = 15_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, { windowsHide: true, shell: false })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const append = (currentText: string, chunk: Buffer): string => `${currentText}${chunk.toString('utf8')}`.slice(-32_000)
    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    child.once('error', reject)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/**
 * Root of the VPN backends vendored by scripts/vpn/vendor.mjs (Windows only):
 * vpn/wireguard/wireguard.exe (portable, drivers embedded) and
 * vpn/openvpn/openvpn.exe with its runtime DLLs and wintun.dll.
 */
function bundledVpnRoot(): string | null {
  if (process.platform !== 'win32') return null
  return app.isPackaged
    ? path.join(process.resourcesPath, 'vpn')
    : path.join(app.getAppPath(), '.build', 'vpn')
}

function isBundledOpenvpn(executablePath: string): boolean {
  const root = bundledVpnRoot()
  if (!root) return false
  return path.resolve(executablePath).toLowerCase() === path.resolve(root, 'openvpn', 'openvpn.exe').toLowerCase()
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

let elevationCheck: Promise<boolean> | null = null

function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return Promise.resolve(typeof process.getuid === 'function' && process.getuid() === 0)
  }
  if (!elevationCheck) {
    elevationCheck = runProcess('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
    ], 10_000)
      .then((result) => result.code === 0 && /true/i.test(result.stdout))
      .catch(() => false)
  }
  return elevationCheck
}

const UAC_DECLINED_EXIT = 223

/**
 * Runs a short PowerShell script elevated via a single UAC prompt. The script
 * file lives in the private vpn dir; results must be exchanged through files
 * because an elevated process cannot share stdio with this one.
 */
async function runElevatedPs(lines: string[], timeoutMs: number): Promise<void> {
  const dir = vpnDir()
  await mkdir(dir, { recursive: true })
  const scriptFile = path.join(dir, `elevate-${randomUUID()}.ps1`)
  await writeFile(scriptFile, `${lines.join('\r\n')}\r\n`, 'utf8')
  try {
    const command =
      `try { $p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ${psQuote(`"${scriptFile}"`)}) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { exit ${UAC_DECLINED_EXIT} }`
    const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], timeoutMs)
    if (result.timedOut) throw new Error('Timed out waiting for the Windows administrator prompt.')
    if (result.code === UAC_DECLINED_EXIT) {
      throw new Error('Ascora needs administrator permission for this VPN operation, but the Windows prompt was declined.')
    }
    if (result.code !== 0) throw new Error(`The elevated VPN helper exited with code ${result.code}.`)
  } finally {
    await rm(scriptFile, { force: true }).catch(() => undefined)
  }
}

/** runProcess, transparently elevated through UAC when this process is not admin. */
async function runProcessElevated(executablePath: string, args: string[], timeoutMs = 120_000): Promise<ProcessResult> {
  if (process.platform !== 'win32' || (await isElevated())) return runProcess(executablePath, args, timeoutMs)
  const id = randomUUID()
  const outFile = path.join(vpnDir(), `elevate-${id}.out`)
  const codeFile = path.join(vpnDir(), `elevate-${id}.code`)
  try {
    await runElevatedPs([
      "$ErrorActionPreference = 'Continue'",
      // Out-File instead of `>`: PowerShell 5 redirects native output as UTF-16.
      `& ${psQuote(executablePath)} ${args.map((arg) => psQuote(arg)).join(' ')} 2>&1 | Out-File -FilePath ${psQuote(outFile)} -Encoding UTF8`,
      `Set-Content -Path ${psQuote(codeFile)} -Value $LASTEXITCODE`
    ], timeoutMs)
    const stdout = (await readFile(outFile, 'utf8').catch(() => '')).replace(/^\uFEFF/, '')
    const code = Number((await readFile(codeFile, 'utf8').catch(() => '')).replace(/^\uFEFF/, '').trim())
    return { code: Number.isInteger(code) ? code : null, stdout, stderr: '', timedOut: false }
  } finally {
    await Promise.all([outFile, codeFile].map((file) => rm(file, { force: true }).catch(() => undefined)))
  }
}

function localDateKey(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nextLocalMidnight(): string {
  const date = new Date()
  date.setHours(24, 0, 0, 0)
  return date.toISOString()
}

async function networkByteTotal(): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const command = "$s=Get-NetAdapterStatistics; (($s | Measure-Object -Property ReceivedBytes -Sum).Sum + ($s | Measure-Object -Property SentBytes -Sum).Sum)"
      const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 8_000)
      const total = Number(result.stdout.trim())
      return result.code === 0 && Number.isFinite(total) && total >= 0 ? total : null
    }
    if (process.platform === 'linux') {
      const lines = (await readFile('/proc/net/dev', 'utf8')).split(/\r?\n/).slice(2)
      let total = 0
      for (const line of lines) {
        const parts = line.trim().split(/[:\s]+/)
        if (parts.length < 11) continue
        const received = Number(parts[1])
        const sent = Number(parts[9])
        if (Number.isFinite(received) && Number.isFinite(sent)) total += received + sent
      }
      return total
    }
    const result = await runProcess('netstat', ['-ibn'], 8_000)
    if (result.code !== 0) return null
    const lines = result.stdout.split(/\r?\n/).filter(Boolean)
    const header = lines[0]?.trim().split(/\s+/) ?? []
    const nameIndex = header.indexOf('Name')
    const inIndex = header.indexOf('Ibytes')
    const outIndex = header.indexOf('Obytes')
    if (nameIndex < 0 || inIndex < 0 || outIndex < 0) return null
    const byInterface = new Map<string, number>()
    for (const line of lines.slice(1)) {
      const parts = line.trim().split(/\s+/)
      const received = Number(parts[inIndex])
      const sent = Number(parts[outIndex])
      if (!parts[nameIndex] || !Number.isFinite(received) || !Number.isFinite(sent)) continue
      byInterface.set(parts[nameIndex], Math.max(byInterface.get(parts[nameIndex]) ?? 0, received + sent))
    }
    return [...byInterface.values()].reduce((sum, value) => sum + value, 0)
  } catch {
    return null
  }
}

async function ensureAnonymousUsage(): Promise<AnonymousUsageData> {
  const today = localDateKey()
  if (!anonymousUsage) anonymousUsage = await readJson<AnonymousUsageData>(usagePath())
  if (!anonymousUsage || anonymousUsage.date !== today || !Number.isFinite(anonymousUsage.usedBytes)) {
    anonymousUsage = { date: today, usedBytes: 0 }
    anonymousBaseline = current.state === 'connected' && current.account.tier === 'anonymous'
      ? await networkByteTotal()
      : null
    await writePrivateJson(usagePath(), anonymousUsage)
  }
  return anonymousUsage
}

async function anonymousTraffic(): Promise<VpnTrafficStats> {
  const saved = await ensureAnonymousUsage()
  const total = await networkByteTotal()
  const sessionBytes = anonymousBaseline !== null && total !== null ? Math.max(0, total - anonymousBaseline) : 0
  const usedBytes = Math.max(0, saved.usedBytes + sessionBytes)
  return {
    source: 'anonymous',
    todayBytes: usedBytes,
    weekBytes: usedBytes,
    monthBytes: usedBytes,
    allTimeBytes: usedBytes,
    limitBytes: ANONYMOUS_DAILY_LIMIT,
    usedBytes,
    remainingBytes: Math.max(0, ANONYMOUS_DAILY_LIMIT - usedBytes),
    limitExceeded: usedBytes >= ANONYMOUS_DAILY_LIMIT,
    resetAt: nextLocalMidnight()
  }
}

async function startAnonymousUsage(): Promise<void> {
  await ensureAnonymousUsage()
  anonymousBaseline = await networkByteTotal()
  startUsageMonitor()
}

async function finishAnonymousUsage(): Promise<void> {
  if (anonymousBaseline === null) return
  const saved = await ensureAnonymousUsage()
  const total = await networkByteTotal()
  if (total !== null) saved.usedBytes += Math.max(0, total - anonymousBaseline)
  anonymousBaseline = null
  await writePrivateJson(usagePath(), saved)
}

function stopUsageMonitor(): void {
  if (usageTimer) clearInterval(usageTimer)
  usageTimer = null
}

function startUsageMonitor(): void {
  stopUsageMonitor()
  usageTimer = setInterval(() => {
    if (usageTickRunning || current.state !== 'connected' || current.account.tier !== 'anonymous') return
    usageTickRunning = true
    void anonymousTraffic()
      .then((traffic) => {
        if (traffic.limitExceeded && !operation) void disconnectVpn()
      })
      .finally(() => { usageTickRunning = false })
  }, USAGE_POLL_MS)
}

async function apiRequest(pathname: string, init?: RequestInit, authenticate = true, retryAuth = true): Promise<ApiRecord> {
  if (authenticate && tokens?.accessToken && accessTokenExpiresSoon(tokens.accessToken)) {
    if (!(await refreshAccessToken())) throw new VpnApiError('vpn_session_expired', 401)
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  }
  if (authenticate && tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`
  // Machine identity + HMAC proof: the panel rejects unsigned /connect calls
  // and enforces the daily limit per physical machine across our products.
  Object.assign(headers, await clientProofHeaders(typeof init?.body === 'string' ? init.body : ''))
  let response: Response
  try {
    response = await fetch(`${settings.apiBaseUrl}${pathname}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch {
    throw new VpnApiError('vpn_api_unreachable', 0)
  }
  let body: ApiRecord = {}
  try {
    body = (await response.json()) as ApiRecord
  } catch {
    // The HTTP status still provides a useful error when the upstream returned HTML/plain text.
  }
  if (response.status === 401 && authenticate && retryAuth && tokens && await refreshAccessToken()) {
    return apiRequest(pathname, init, true, false)
  }
  if (!response.ok) {
    const detail = typeof body.error === 'string' ? body.error : `VPN API returned HTTP ${response.status}.`
    throw new VpnApiError(detail, response.status)
  }
  return body
}

async function doRefreshAccessToken(): Promise<boolean> {
  if (!tokens?.refreshToken) return false
  const previous = tokens
  try {
    const body = await apiRequest('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: previous.refreshToken })
    }, false, false)
    const accessToken = string(body.access_token)
    const refreshToken = string(body.refresh_token)
    if (!accessToken || !refreshToken) throw new Error('The VPN API returned invalid session tokens.')
    await persistTokens({
      accessToken,
      refreshToken,
      email: previous.email,
      tier: normalizeTier(body.tier ?? previous.tier)
    })
    publish({ account: { authenticated: true, email: previous.email, tier: tokens?.tier ?? previous.tier } })
    return true
  } catch {
    await clearTokens()
    return false
  }
}

function refreshAccessToken(): Promise<boolean> {
  if (tokenRefresh) return tokenRefresh
  tokenRefresh = doRefreshAccessToken().finally(() => { tokenRefresh = null })
  return tokenRefresh
}

async function syncAccountProfile(): Promise<void> {
  if (!tokens) return
  const body = await apiRequest('/api/client/me')
  if (!tokens) throw new VpnApiError('vpn_session_expired', 401)
  const email = string(body.email, tokens.email)
  const tier = normalizeTier(body.tier ?? tokens.tier)
  await persistTokens({ ...tokens, email, tier })
  publish({ account: { authenticated: true, email, tier } })
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeServer(value: unknown): VpnServer | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as ApiRecord
  const id = string(raw.id).trim()
  const host = string(raw.host).trim()
  if (!id || !host) return null
  const rawStatus = string(raw.status)
  const status: VpnServer['status'] =
    rawStatus === 'online' || rawStatus === 'maintenance' ? rawStatus : 'offline'
  return {
    id,
    country: string(raw.country),
    countryCode: string(raw.country_code).toUpperCase(),
    city: string(raw.city),
    host,
    wireguardPort: number(raw.vpn_port, 51820),
    openvpnPort: number(raw.openvpn_port, 1194),
    load: Math.max(0, Math.min(100, number(raw.load))),
    status,
    freeAllowed: bool(raw.free_allowed, true),
    premiumAllowed: bool(raw.premium_allowed, true),
    supportsWireguard: bool(raw.supports_wireguard, true),
    supportsOpenvpn: bool(raw.supports_openvpn),
    pingMs: null
  }
}

function tcpPing(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now()
    let settled = false
    const socket = createConnection({ host, port })
    const finish = (value: number | null): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(1_800)
    socket.once('connect', () => finish(Math.round(performance.now() - started)))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
  })
}

async function probeServers(servers: VpnServer[]): Promise<VpnServer[]> {
  return Promise.all(servers.map(async (server) => ({
    ...server,
    pingMs: await tcpPing(server.host, server.wireguardPort)
  })))
}

export async function fetchVpnServers(force = false): Promise<VpnServersResult> {
  await ensureInitialized()
  if (!force && serverCache && Date.now() - serverCache.at < SERVER_CACHE_MS) {
    return { ok: true, servers: serverCache.servers }
  }
  try {
    const body = await apiRequest('/api/client/servers')
    const raw = Array.isArray(body.servers) ? body.servers : []
    const servers = await probeServers(raw.map(normalizeServer).filter((server): server is VpnServer => server !== null))
    serverCache = { at: Date.now(), servers }
    return { ok: true, servers }
  } catch (error) {
    return { ok: false, servers: serverCache?.servers ?? [], error: errorMessage(error) }
  }
}

export async function getVpnTraffic(): Promise<VpnTrafficResult> {
  await ensureInitialized()
  if (!current.account.authenticated) {
    try {
      return { ok: true, traffic: await anonymousTraffic() }
    } catch (error) {
      return { ok: false, traffic: null, error: errorMessage(error) }
    }
  }
  try {
    let body = await apiRequest('/api/client/traffic')
    // Older control-panel versions accepted an expired Bearer token as an
    // anonymous request. Detect that identity downgrade and force the normal
    // /me -> refresh flow before trusting quota or traffic data.
    if (current.account.tier === 'paid' && body.free_tier && tokens) {
      await syncAccountProfile()
      body = await apiRequest('/api/client/traffic')
      if (body.free_tier) throw new VpnApiError('vpn_account_not_recognized', 401)
    }
    const stats = body.stats && typeof body.stats === 'object' ? body.stats as ApiRecord : {}
    const freeTier = body.free_tier && typeof body.free_tier === 'object' ? body.free_tier as ApiRecord : null
    const usedBytes = freeTier ? number(freeTier.used_bytes) : null
    const limitBytes = freeTier ? number(freeTier.limit_bytes) : null
    return {
      ok: true,
      traffic: {
        source: 'account',
        todayBytes: number(stats.today),
        weekBytes: number(stats.week),
        monthBytes: number(stats.month),
        allTimeBytes: number(stats.all_time),
        limitBytes,
        usedBytes,
        remainingBytes: freeTier ? number(freeTier.remaining_bytes) : null,
        limitExceeded: freeTier ? bool(freeTier.limit_exceeded) : false,
        resetAt: freeTier ? string(freeTier.reset_at) || null : null
      }
    }
  } catch (error) {
    return { ok: false, traffic: null, error: errorMessage(error) }
  }
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) throw new Error('Could not export the WireGuard key pair.')
  return Buffer.from(value, 'base64url').toString('base64')
}

function wireguardKeyPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('x25519')
  const privateJwk = pair.privateKey.export({ format: 'jwk' }) as { d?: string }
  const publicJwk = pair.publicKey.export({ format: 'jwk' }) as { x?: string }
  return { privateKey: decodeBase64Url(privateJwk.d), publicKey: decodeBase64Url(publicJwk.x) }
}

function safeLine(value: unknown, label: string): string {
  const text = string(value).trim()
  if (!text || text.length > 512 || /[\r\n]/.test(text)) throw new Error(`The VPN API returned an invalid ${label}.`)
  return text
}

function safeWireguardKey(value: unknown): string {
  const key = safeLine(value, 'WireGuard public key')
  if (Buffer.from(key, 'base64').length !== 32) throw new Error('The VPN API returned an invalid WireGuard public key.')
  return key
}

function buildWireguardConfig(privateKey: string, body: ApiRecord): string {
  const assignedIp = safeLine(body.assigned_ip, 'assigned IP')
  if (!isIP(assignedIp)) throw new Error('The VPN API returned an invalid assigned IP.')
  const dns = (Array.isArray(body.dns) ? body.dns : ['1.1.1.1'])
    .map((entry) => string(entry).trim())
    .filter((entry) => isIP(entry))
  const endpoint = safeLine(body.server_endpoint, 'server endpoint')
  const serverKey = safeWireguardKey(body.server_public_key)
  const prefix = isIP(assignedIp) === 6 ? 128 : 32
  return [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${assignedIp}/${prefix}`,
    `DNS = ${(dns.length ? dns : ['1.1.1.1']).join(', ')}`,
    '',
    '[Peer]',
    `PublicKey = ${serverKey}`,
    `Endpoint = ${endpoint}`,
    'AllowedIPs = 0.0.0.0/0, ::/0',
    'PersistentKeepalive = 25',
    ''
  ].join('\n')
}

async function writePrivateConfig(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, { encoding: 'utf8', mode: 0o600 })
  await chmod(file, 0o600).catch(() => undefined)
}

async function wireguardConnected(): Promise<boolean> {
  const executablePath = current.dependencies.wireguard.executable
  if (!executablePath) return false
  if (process.platform === 'win32') {
    const result = await runProcess('sc.exe', ['query', `WireGuardTunnel$${TUNNEL_NAME}`], 5_000).catch(() => null)
    return !!result && result.code === 0 && (/\bRUNNING\b/i.test(result.stdout) || /STATE\s*:\s*4\b/i.test(result.stdout))
  }
  const wg = await firstExecutable(pathCandidates('wg'))
  if (!wg) return false
  const result = await runProcess(wg, ['show', TUNNEL_NAME], 5_000).catch(() => null)
  return !!result && result.code === 0
}

function processExists(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but is elevated above us (openvpn started via UAC).
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function openvpnProcessConnected(pid: number | undefined): Promise<boolean> {
  if (!pid || !processExists(pid)) return false
  if (openVpnProcess?.pid === pid && openVpnProcess.exitCode === null) return true
  try {
    if (process.platform === 'win32') {
      const command = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ExecutablePath`
      const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 5_000)
      return result.code === 0 && path.basename(result.stdout.trim()).toLowerCase() === 'openvpn.exe'
    }
    if (process.platform === 'linux') {
      return path.basename(await readlink(`/proc/${pid}/exe`)).toLowerCase().includes('openvpn')
    }
    const result = await runProcess('ps', ['-p', String(pid), '-o', 'comm='], 5_000)
    return result.code === 0 && path.basename(result.stdout.trim()).toLowerCase().includes('openvpn')
  } catch {
    return false
  }
}

async function sessionConnected(stored: StoredSession): Promise<boolean> {
  return stored.protocol === 'wireguard' ? wireguardConnected() : openvpnProcessConnected(stored.processPid)
}

async function installWireguard(config: string): Promise<void> {
  const executablePath = current.dependencies.wireguard.executable
  if (!executablePath) throw new Error(current.dependencies.wireguard.hint ?? 'WireGuard is not installed.')
  const configFile = wireguardConfigPath()
  await writePrivateConfig(configFile, config)
  if (process.platform === 'win32') {
    const result = await runProcessElevated(executablePath, ['/installtunnelservice', configFile], 120_000)
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'WireGuard could not install the tunnel service.')
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await wireguardConnected()) return
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    throw new Error('WireGuard was installed, but its tunnel service did not start.')
  }
  const result = await runProcess(executablePath, ['up', configFile], 20_000)
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'wg-quick could not start the tunnel.')
}

async function uninstallWireguard(): Promise<void> {
  const executablePath = current.dependencies.wireguard.executable
  if (!executablePath) return
  if (process.platform === 'win32') {
    // Skip the UAC prompt when the tunnel service does not exist at all.
    const query = await runProcess('sc.exe', ['query', `WireGuardTunnel$${TUNNEL_NAME}`], 5_000).catch(() => null)
    if (query && query.code === 0) {
      const result = await runProcessElevated(executablePath, ['/uninstalltunnelservice', TUNNEL_NAME], 120_000)
      if (result.code !== 0 && !/not exist|not found|1060/i.test(`${result.stdout}\n${result.stderr}`)) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || 'WireGuard could not stop the tunnel service.')
      }
    }
  } else {
    const result = await runProcess(executablePath, ['down', wireguardConfigPath()], 20_000).catch(() => null)
    if (result && result.code !== 0 && !/not a wireguard interface|does not exist/i.test(`${result.stdout}\n${result.stderr}`)) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'wg-quick could not stop the tunnel.')
    }
  }
  await rm(wireguardConfigPath(), { force: true }).catch(() => undefined)
}

/**
 * Starts openvpn.exe elevated through one UAC prompt. The elevated child
 * cannot be a ChildProcess of ours, so its pid comes back through a file and
 * lifecycle tracking falls to the pid-based openvpnProcessConnected path.
 */
async function startOpenvpnElevatedWin(
  executablePath: string,
  configFile: string,
  logFile: string,
  windowsDriver: OpenvpnWindowsDriver
): Promise<number> {
  const pidFile = path.join(vpnDir(), `openvpn-${randomUUID()}.pid`)
  const args = openvpnArguments(executablePath, configFile, logFile, windowsDriver)
  const psArguments = args.map((arg) => psQuote(/\s/.test(arg) ? `"${arg}"` : arg)).join(', ')
  try {
    await runElevatedPs([
      `$p = Start-Process -FilePath ${psQuote(executablePath)} -ArgumentList @(${psArguments}) -WindowStyle Hidden -PassThru`,
      `Set-Content -Path ${psQuote(pidFile)} -Value $p.Id`
    ], 120_000)
    const pid = Number((await readFile(pidFile, 'utf8').catch(() => '')).replace(/^\uFEFF/, '').trim())
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('OpenVPN started without a process identifier.')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    if (!(await openvpnProcessConnected(pid))) {
      throw await openvpnExitError(null)
    }
    return pid
  } finally {
    await rm(pidFile, { force: true }).catch(() => undefined)
  }
}

function openvpnArguments(
  executablePath: string,
  configFile: string,
  logFile: string,
  windowsDriver: OpenvpnWindowsDriver
): string[] {
  // Configure the log before reading the profile so even early config/parser
  // failures are available to the unelevated parent after a UAC launch.
  const args = ['--log', logFile, '--verb', '3', '--config', configFile]
  if (process.platform === 'win32' && isBundledOpenvpn(executablePath)) {
    args.push('--disable-dco', '--windows-driver', windowsDriver)
  }
  return args
}

interface OpenvpnAdapter {
  guid: string
  driver: OpenvpnWindowsDriver
}

async function selectOpenvpnWindowsDriver(executablePath: string): Promise<OpenvpnWindowsDriver> {
  if (process.platform !== 'win32' || !isBundledOpenvpn(executablePath)) return 'wintun'

  const shown = await runProcess(executablePath, ['--show-adapters'], 5_000).catch(() => null)
  const adapters: OpenvpnAdapter[] = []
  for (const match of (shown?.stdout ?? '').matchAll(/^'.*?'\s+\{([0-9a-f-]+)\}\s+(wintun|tap-windows6)\s*$/gim)) {
    adapters.push({ guid: match[1].toLowerCase(), driver: match[2].toLowerCase() as OpenvpnWindowsDriver })
  }

  // A Wintun adapter can only be owned by one tunnel at a time. Prefer a
  // disconnected adapter, and let a free TAP instance coexist with another
  // VPN that is already holding Wintun (for example PlanetVPN/tun2socks).
  const statusResult = await runProcess('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Get-NetAdapter -IncludeHidden | ForEach-Object { '{0}|{1}' -f $_.InterfaceGuid, $_.Status }"
  ], 5_000).catch(() => null)
  const statuses = new Map<string, string>()
  for (const line of (statusResult?.stdout ?? '').split(/\r?\n/)) {
    const [guid, status] = line.trim().split('|', 2)
    if (guid && status) statuses.set(guid.replace(/[{}]/g, '').toLowerCase(), status.toLowerCase())
  }
  const isFree = (adapter: OpenvpnAdapter): boolean => {
    const status = statuses.get(adapter.guid)
    return !!status && !['up', 'disabled', 'not present'].includes(status)
  }

  if (adapters.some((adapter) => adapter.driver === 'wintun' && isFree(adapter))) return 'wintun'
  if (adapters.some((adapter) => adapter.driver === 'tap-windows6' && isFree(adapter))) return 'tap-windows6'
  // If adapter status could not be queried, TAP is the safer coexistence
  // fallback; otherwise retain the bundled Wintun default for diagnostics.
  if (!statuses.size && adapters.some((adapter) => adapter.driver === 'tap-windows6')) return 'tap-windows6'
  return 'wintun'
}

function openvpnLogDetail(raw: string): string | null {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return null

  const meaningful = lines.filter((line) =>
    /options error|error:|failed|cannot|fatal|wintun|adapter|certificate|private key|tls/i.test(line)
  )
  const specific = meaningful.filter((line) => !/exiting due to fatal error/i.test(line))
  const selected = specific.at(-1) ?? meaningful.at(-1) ?? lines.at(-1)
  if (!selected) return null
  return selected
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, '')
    .slice(0, 800)
}

async function openvpnExitError(code: number | null, capturedOutput = ''): Promise<Error> {
  const log = await readFile(openvpnLogPath(), 'utf8').catch(() => '')
  const detail = openvpnLogDetail(`${capturedOutput}\n${log}`)
  if (detail) return new Error(`OpenVPN: ${detail}`)
  return new Error(`OpenVPN exited before the tunnel was ready (code ${code ?? 'unknown'}). See ${openvpnLogPath()}.`)
}

async function startOpenvpn(config: string): Promise<number> {
  const executablePath = current.dependencies.openvpn.executable
  if (!executablePath) throw new Error(current.dependencies.openvpn.hint ?? 'OpenVPN is not installed.')
  const configFile = openvpnConfigPath()
  const logFile = openvpnLogPath()
  await rm(logFile, { force: true }).catch(() => undefined)
  await writePrivateConfig(configFile, config)
  const windowsDriver = await selectOpenvpnWindowsDriver(executablePath)
  if (process.platform === 'win32' && !(await isElevated())) {
    return startOpenvpnElevatedWin(executablePath, configFile, logFile, windowsDriver)
  }
  const child = spawn(executablePath, openvpnArguments(executablePath, configFile, logFile, windowsDriver), {
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  openVpnProcess = child
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let output = ''
    const append = (chunk: Buffer): void => { output = `${output}${chunk.toString('utf8')}`.slice(-32_000) }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(), 1_200)
    child.once('error', (error) => finish(error))
    child.once('exit', (code) => {
      clearTimeout(timer)
      void openvpnExitError(code, output).then((error) => finish(error), (error) => finish(error))
    })
  })
  if (!child.pid) throw new Error('OpenVPN started without a process identifier.')
  return child.pid
}

async function stopOpenvpn(pid: number | undefined): Promise<void> {
  const target = !pid || openVpnProcess?.pid === pid ? openVpnProcess : null
  if (target && target.exitCode === null) {
    target.kill()
    await Promise.race([
      new Promise<void>((resolve) => target.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000))
    ])
  }
  if (pid && await openvpnProcessConnected(pid)) {
    if (process.platform === 'win32') {
      const killed = await runProcess('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 10_000).catch(() => null)
      if ((!killed || killed.code !== 0) && (await openvpnProcessConnected(pid))) {
        // The elevated openvpn.exe cannot be killed from a non-admin process.
        await runProcessElevated('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 120_000)
      }
    } else {
      try { process.kill(pid, 'SIGTERM') } catch { /* process already exited */ }
    }
  }
  openVpnProcess = null
  await rm(openvpnConfigPath(), { force: true }).catch(() => undefined)
}

function safeOpenvpnConfig(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The VPN API did not return an OpenVPN configuration.')
  const config = value.trim()
  if (!config || config.length > 1024 * 1024 || config.includes('\0')) {
    throw new Error('The VPN API returned an invalid OpenVPN configuration.')
  }
  return `${config}\n`
}

async function releaseRemoteSession(stored: StoredSession | null): Promise<void> {
  if (!stored) return
  const body: ApiRecord = {}
  if (stored.peerId) body.peer_id = stored.peerId
  if (stored.anonymousSessionId) body.anonymous_session_id = stored.anonymousSessionId
  // An anonymous session must be released with its own session secret even if
  // the local account has since refreshed and become authenticated.
  await apiRequest(
    '/api/client/disconnect',
    { method: 'POST', body: JSON.stringify(body) },
    !stored.anonymousSessionId
  ).catch(() => undefined)
}

function storedSession(body: ApiRecord, request: VpnConnectRequest, processPid?: number): StoredSession {
  const endpoint = safeLine(body.server_endpoint, 'server endpoint')
  const host = endpoint.replace(/^\[/, '').split(/\]:|:/)[0]
  const matched = serverCache?.servers.find((server) => server.host === host || server.id === request.serverId)
  return {
    protocol: request.protocol,
    peerId: typeof body.peer_id === 'number' ? body.peer_id : null,
    anonymousSessionId: typeof body.anonymous_session_id === 'string' ? body.anonymous_session_id : null,
    serverId: matched?.id ?? request.serverId ?? null,
    serverLabel: matched ? [matched.city, matched.country].filter(Boolean).join(', ') : host,
    endpoint,
    assignedIp: typeof body.assigned_ip === 'string' ? body.assigned_ip : null,
    connectedAt: Date.now(),
    processPid
  }
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return initialized
  initialized = (async () => {
    const savedSettings = await readJson<Partial<VpnSettings>>(settingsPath())
    if (savedSettings) {
      settings = {
        protocol: isProtocol(savedSettings.protocol) ? savedSettings.protocol : settings.protocol,
        serverId: typeof savedSettings.serverId === 'string' ? savedSettings.serverId : null,
        apiBaseUrl: typeof savedSettings.apiBaseUrl === 'string'
          ? normalizeApiBaseUrl(savedSettings.apiBaseUrl)
          : normalizeApiBaseUrl(settings.apiBaseUrl)
      }
    } else {
      settings.apiBaseUrl = normalizeApiBaseUrl(settings.apiBaseUrl)
    }
    current = { ...current, protocol: settings.protocol, settings: { ...settings }, dependencies: await detectDependencies() }
    tokens = await loadTokens()
    if (tokens) {
      current = {
        ...current,
        account: { authenticated: true, email: tokens.email, tier: tokens.tier }
      }
      try {
        await syncAccountProfile()
      } catch (error) {
        // Preserve the encrypted session during temporary network outages. A
        // definitive 401 is handled by apiRequest's refresh/clear flow.
        if (error instanceof VpnApiError && error.statusCode === 401) await clearTokens()
      }
    }
    const savedSession = await readJson<StoredSession>(sessionPath())
    if (savedSession && isProtocol(savedSession.protocol)) {
      session = savedSession
      if (current.account.authenticated && savedSession.anonymousSessionId) {
        // Repair a session created by an older Control Panel that silently
        // downgraded an expired account token to anonymous. It cannot be
        // attributed to the account, so tear it down before the next connect.
        if (savedSession.protocol === 'openvpn') await stopOpenvpn(savedSession.processPid).catch(() => undefined)
        else await uninstallWireguard().catch(() => undefined)
        await releaseRemoteSession(savedSession)
        await clearSession()
      } else if (await sessionConnected(savedSession)) {
        current = {
          ...current,
          state: 'connected',
          protocol: savedSession.protocol,
          serverId: savedSession.serverId,
          serverLabel: savedSession.serverLabel,
          endpoint: savedSession.endpoint,
          assignedIp: savedSession.assignedIp,
          connectedAt: savedSession.connectedAt
        }
        if (current.account.tier === 'anonymous') await startAnonymousUsage().catch(() => undefined)
      } else {
        if (savedSession.protocol === 'openvpn') await stopOpenvpn(savedSession.processPid).catch(() => undefined)
        else await uninstallWireguard().catch(() => undefined)
        await releaseRemoteSession(savedSession)
        await clearSession()
      }
    } else if (await wireguardConnected()) {
      const recovered: StoredSession = {
        protocol: 'wireguard',
        peerId: null,
        anonymousSessionId: null,
        serverId: null,
        serverLabel: null,
        endpoint: null,
        assignedIp: null,
        connectedAt: Date.now()
      }
      await saveSession(recovered)
      current = { ...current, state: 'connected', protocol: 'wireguard', connectedAt: recovered.connectedAt }
      if (current.account.tier === 'anonymous') await startAnonymousUsage().catch(() => undefined)
    } else {
      await rm(wireguardConfigPath(), { force: true }).catch(() => undefined)
      await rm(openvpnConfigPath(), { force: true }).catch(() => undefined)
    }
  })()
  return initialized
}

export async function getVpnStatus(forceDependencies = false): Promise<VpnStatus> {
  await ensureInitialized()
  if (forceDependencies) publish({ dependencies: await detectDependencies(true) })
  if (session && current.state === 'connected' && !(await sessionConnected(session))) {
    await releaseRemoteSession(session)
    await clearSession()
    publish({ state: 'disconnected', serverId: null, serverLabel: null, endpoint: null, assignedIp: null, connectedAt: null, error: 'The VPN tunnel stopped unexpectedly.' })
  }
  return current
}

export async function configureVpn(request: VpnConfigureRequest): Promise<VpnStatus> {
  await ensureInitialized()
  if (current.state === 'connected' || current.state === 'connecting' || current.state === 'disconnecting') {
    throw new Error('Disconnect the VPN before changing its settings.')
  }
  if (request.protocol !== undefined) {
    if (!isProtocol(request.protocol)) throw new Error('Unsupported VPN protocol.')
    settings.protocol = request.protocol
  }
  if (request.serverId !== undefined) {
    const nextServer = request.serverId?.trim() || null
    if (nextServer && current.account.tier !== 'paid') {
      throw new Error('Manual VPN server selection requires a Premium account.')
    }
    settings.serverId = nextServer
  }
  if (request.apiBaseUrl !== undefined) {
    const nextApiBaseUrl = normalizeApiBaseUrl(request.apiBaseUrl)
    if (nextApiBaseUrl !== settings.apiBaseUrl) {
      settings.apiBaseUrl = nextApiBaseUrl
      settings.serverId = null
      serverCache = null
      await clearTokens()
    }
  }
  await saveSettings()
  return publish({ protocol: settings.protocol, error: undefined })
}

async function doConnect(request: VpnConnectRequest): Promise<VpnStatus> {
  await ensureInitialized()
  if (!isProtocol(request.protocol)) throw new Error('Unsupported VPN protocol.')
  if (current.state === 'connected') return current
  if (current.account.authenticated) {
    try {
      // /connect accepts anonymous calls, so an expired optional Bearer token
      // used to be silently downgraded and subjected Premium users to the
      // anonymous machine limit. A required-auth preflight prevents that.
      await syncAccountProfile()
    } catch (error) {
      return publish({ state: 'error', error: errorMessage(error), connectedAt: null })
    }
  }
  settings.protocol = request.protocol
  settings.serverId = current.account.tier === 'paid' ? request.serverId?.trim() || null : null
  await saveSettings()
  if (current.account.tier === 'anonymous' && (await anonymousTraffic()).limitExceeded) {
    return publish({ state: 'error', error: 'anonymous_daily_limit_exceeded' })
  }
  const dependencies = await detectDependencies(true)
  publish({
    state: 'connecting',
    protocol: request.protocol,
    serverId: settings.serverId,
    serverLabel: null,
    endpoint: null,
    assignedIp: null,
    connectedAt: null,
    dependencies,
    error: undefined
  })
  if (!dependencies[request.protocol].available) {
    const message = dependencies[request.protocol].hint ?? `${request.protocol} is not installed.`
    return publish({ state: 'error', error: message })
  }

  let provisioned: StoredSession | null = null
  try {
    const body: ApiRecord = { protocol: request.protocol }
    let privateKey = ''
    if (request.protocol === 'wireguard') {
      const pair = wireguardKeyPair()
      privateKey = pair.privateKey
      body.client_pubkey = pair.publicKey
    }
    if (settings.serverId && current.account.tier === 'paid') body.server_id = settings.serverId
    const response = await apiRequest('/api/client/connect', { method: 'POST', body: JSON.stringify(body) })
    provisioned = storedSession(response, request)
    if (current.account.authenticated && provisioned.anonymousSessionId) {
      throw new VpnApiError('vpn_account_not_recognized', 401)
    }
    if (request.protocol === 'wireguard') {
      await installWireguard(buildWireguardConfig(privateKey, response))
    } else {
      const config = safeOpenvpnConfig(response.openvpn_config)
      const pid = await startOpenvpn(config)
      provisioned.processPid = pid
    }
    await saveSession(provisioned)
    if (current.account.tier === 'anonymous') await startAnonymousUsage().catch(() => undefined)
    const next = publish({
      state: 'connected',
      protocol: provisioned.protocol,
      serverId: provisioned.serverId,
      serverLabel: provisioned.serverLabel,
      endpoint: provisioned.endpoint,
      assignedIp: provisioned.assignedIp,
      connectedAt: provisioned.connectedAt,
      error: undefined
    })
    void getPublicIpStatus(true)
    return next
  } catch (error) {
    if (request.protocol === 'wireguard') await uninstallWireguard().catch(() => undefined)
    else await stopOpenvpn(provisioned?.processPid).catch(() => undefined)
    await releaseRemoteSession(provisioned)
    await clearSession()
    return publish({ state: 'error', error: errorMessage(error), connectedAt: null })
  }
}

export function connectVpn(request: VpnConnectRequest): Promise<VpnStatus> {
  if (operation) return operation
  operation = doConnect(request).finally(() => { operation = null })
  return operation
}

async function doDisconnect(): Promise<VpnStatus> {
  await ensureInitialized()
  const stored = session
  if (!stored && current.state === 'disconnected') return current
  publish({ state: 'disconnecting', error: undefined })
  stopUsageMonitor()
  if (current.account.tier === 'anonymous') await finishAnonymousUsage().catch(() => undefined)
  let driverError: string | undefined
  try {
    if (stored?.protocol === 'openvpn') await stopOpenvpn(stored.processPid)
    else await uninstallWireguard()
  } catch (error) {
    driverError = errorMessage(error)
  }
  await releaseRemoteSession(stored)
  await clearSession()
  const next = publish({
    state: driverError ? 'error' : 'disconnected',
    protocol: settings.protocol,
    serverId: null,
    serverLabel: null,
    endpoint: null,
    assignedIp: null,
    connectedAt: null,
    error: driverError
  })
  void getPublicIpStatus(true)
  return next
}

export function disconnectVpn(): Promise<VpnStatus> {
  if (operation) return operation
  operation = doDisconnect().finally(() => { operation = null })
  return operation
}

/** Persist the current anonymous counter without changing tunnel state. */
export async function flushVpnUsage(): Promise<void> {
  if (!initialized) return
  await ensureInitialized()
  stopUsageMonitor()
  if (current.state === 'connected' && current.account.tier === 'anonymous') {
    await finishAnonymousUsage().catch(() => undefined)
  }
}

async function registerCurrentDevice(): Promise<void> {
  try {
    await apiRequest('/api/client/device/register', {
      method: 'POST',
      body: JSON.stringify({
        fingerprint_components: [await deviceFingerprint()],
        platform: process.platform
      })
    })
  } catch {
    // Device registration is best-effort in the original Wandrounik client too.
  }
}

async function authenticateVpnAccount(kind: 'login' | 'register', request: VpnAuthRequest): Promise<VpnAuthResult> {
  await ensureInitialized()
  if (operation || current.state === 'connected' || current.state === 'connecting' || current.state === 'disconnecting') {
    return { ok: false, status: current, error: 'Disconnect the VPN before changing accounts.' }
  }
  const email = request.email.trim().toLowerCase()
  const password = request.password
  if (!email || !email.includes('@') || !password) {
    return { ok: false, status: current, error: 'Enter a valid email address and password.' }
  }
  if (kind === 'register' && password.length < 8) {
    return { ok: false, status: current, error: 'Password must be at least 8 characters.' }
  }
  try {
    const body = await apiRequest(`/api/auth/${kind}`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }, false, false)
    const accessToken = string(body.access_token)
    const refreshToken = string(body.refresh_token)
    if (!accessToken || !refreshToken) throw new Error('The VPN API returned invalid session tokens.')
    const tier = normalizeTier(body.tier)
    await persistTokens({ accessToken, refreshToken, email, tier })
    settings.serverId = null
    await saveSettings()
    serverCache = null
    const next = publish({ account: { authenticated: true, email, tier }, error: undefined })
    void registerCurrentDevice()
    return { ok: true, status: next }
  } catch (error) {
    return { ok: false, status: current, error: errorMessage(error) }
  }
}

export function loginVpnAccount(request: VpnAuthRequest): Promise<VpnAuthResult> {
  return authenticateVpnAccount('login', request)
}

export function registerVpnAccount(request: VpnAuthRequest): Promise<VpnAuthResult> {
  return authenticateVpnAccount('register', request)
}

export async function logoutVpnAccount(): Promise<VpnAuthResult> {
  await ensureInitialized()
  if (operation) return { ok: false, status: current, error: 'Wait for the current VPN operation to finish.' }
  if (current.state === 'connected' || session) await disconnectVpn()
  const refreshToken = tokens?.refreshToken
  if (refreshToken) {
    await apiRequest('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken })
    }, false, false).catch(() => undefined)
  }
  await clearTokens()
  settings.serverId = null
  await saveSettings()
  serverCache = null
  return { ok: true, status: publish({ error: undefined }) }
}

export async function createVpnPayment(planCode: VpnPaymentPlanCode): Promise<VpnPaymentCreateResult> {
  await ensureInitialized()
  if (!current.account.authenticated) return { ok: false, payment: null, error: 'Sign in before purchasing Unlimited.' }
  try {
    const body = await apiRequest('/api/portal/payments', {
      method: 'POST', body: JSON.stringify({ plan_code: planCode, source: 'ascora' })
    })
    const raw = body.payment
    if (!raw || typeof raw !== 'object') throw new Error('The VPN API returned an invalid payment.')
    const value = raw as ApiRecord
    const payment: VpnPaymentCheckout = {
      id: string(value.id),
      plan_code: string(value.plan_code) === 'plus_year' ? 'plus_year' : 'plus_month',
      amount: number(value.amount),
      currency: string(value.currency, 'RUB'),
      status: string(value.status, 'pending'),
      confirmation_token: string(value.confirmation_token)
    }
    if (!payment.id || !payment.confirmation_token) throw new Error('The VPN API returned an invalid payment token.')
    return { ok: true, payment }
  } catch (error) {
    return { ok: false, payment: null, error: errorMessage(error) }
  }
}

export async function syncVpnPayment(paymentId: string): Promise<VpnPaymentSyncResult> {
  await ensureInitialized()
  if (!current.account.authenticated) return { ok: false, payment: null, status: current, error: 'Sign in before checking a payment.' }
  try {
    const body = await apiRequest(`/api/portal/payments/${encodeURIComponent(paymentId)}/sync`, {
      method: 'POST', body: JSON.stringify({})
    })
    const raw = body.payment
    if (!raw || typeof raw !== 'object') throw new Error('The VPN API returned an invalid payment.')
    const value = raw as ApiRecord
    const payment = { id: string(value.id), status: string(value.status) }
    if (payment.status === 'succeeded' && tokens) {
      const profile = await apiRequest('/api/client/me')
      const tier = normalizeTier(profile.tier)
      await persistTokens({ ...tokens, tier })
      serverCache = null
      publish({ account: { authenticated: true, email: tokens.email, tier }, error: undefined })
    }
    return { ok: true, payment, status: current }
  } catch (error) {
    return { ok: false, payment: null, status: current, error: errorMessage(error) }
  }
}
