// node --test scripts/tests/vpn-auth.cjs — no real account or tunnel is used.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { promisify } = require('node:util')
const { createHmac } = require('node:crypto')
const { loadTypeScript } = require('./llm-fixture.cjs')
const proof = loadTypeScript('src/main/vpn/client-proof.ts')

async function fixture(t) {
  const root = path.resolve(__dirname, '../../.build')
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(path.join(root, 'vpn-auth-test-'))
  const execFile = () => {}
  execFile[promisify.custom] = async () => ({ stdout: 'MachineGuid REG_SZ fixture-machine', stderr: '' })
  const calls = []
  let rejectLogin = false
  t.mock.method(global, 'fetch', async (url, init) => {
    const pathname = new URL(url).pathname
    calls.push({ pathname, headers: init.headers, body: init.body ? JSON.parse(init.body) : null })
    if (pathname.startsWith('/api/auth/')) {
      assert.equal(init.headers['X-Client-Proof'], undefined)
      assert.equal(init.headers.Authorization, undefined)
      if (rejectLogin) return new Response('{"error":"Invalid credentials"}', { status: 401 })
      if (pathname.endsWith('/logout')) return new Response('{}')
      return new Response(JSON.stringify({ access_token: 'account-fixture', refresh_token: 'refresh-fixture', tier: 'paid' }))
    }
    if (pathname === '/api/client/servers') return new Response('{"servers":[]}')
    if (pathname === '/api/client/me') return new Response('{"email":"test@example.invalid","tier":"paid"}')
    if (pathname === '/api/client/device/register') return new Response('{}')
    if (pathname === '/api/client/traffic') {
      const headers = init.headers
      assert.equal(headers.Authorization, 'Bearer account-fixture')
      const expected = createHmac('sha256', 'release-fixture').update(`${headers['X-Client-Ts']}.${headers['X-Machine-Id']}.`).digest('hex')
      assert.equal(headers['X-Client-Proof'], expected)
      return new Response('{"stats":{"today":42}}')
    }
    throw Error('Unexpected route: ' + pathname)
  })
  const service = loadTypeScript('src/main/vpn/service.ts', {
    '../../shared/ipc': loadTypeScript('src/shared/ipc.ts'),
    './client-proof': { ...proof, readClientProofSecret: file => proof.readClientProofSecret(file, '') },
    '../network/public-ip': { getPublicIpStatus: async () => ({}) },
    electron: { app: { isPackaged: false, getPath: () => dir, getAppPath: () => dir }, BrowserWindow: { getAllWindows: () => [] },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() } },
    'node:child_process': { execFile, spawn: () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}
      process.nextTick(() => child.emit('close', 1)); return child
    } }
  })
  t.after(async () => { assert.equal(path.dirname(dir), root); await fs.rm(dir, { recursive: true, force: true }) })
  return { service, dir, calls, rejectLogin: () => { rejectLogin = true } }
}

test('Login and model-independent server discovery work without a client proof credential', async t => {
  const f = await fixture(t)
  assert.equal((await f.service.fetchVpnServers()).ok, true)
  const result = await f.service.loginVpnAccount({ email: 'test@example.invalid', password: 'test-password' })
  assert.equal(result.ok, true)
  assert.equal(result.status.account.authenticated, true)
  assert.equal(result.status.account.tier, 'paid')
  const login = f.calls.find(c => c.pathname === '/api/auth/login')
  assert.deepEqual(login.body, { email: 'test@example.invalid', password: 'test-password' })
  const missing = await f.service.getVpnTraffic()
  assert.equal(missing.ok, false)
  assert.match(missing.error, /authorization is missing/)
  assert.equal(f.calls.some(c => c.pathname === '/api/client/traffic'), false, 'Protected traffic cannot omit the proof')
  await fs.mkdir(path.join(f.dir, '.build'))
  await fs.writeFile(path.join(f.dir, '.build/vpn-client-auth.json'), JSON.stringify({ clientSecret: 'release-fixture' }))
  const traffic = await f.service.getVpnTraffic()
  assert.equal(traffic.ok, true)
  assert.equal(traffic.traffic.todayBytes, 42)
  assert.equal((await f.service.logoutVpnAccount()).ok, true)
})

test('Invalid login credentials return the server error without requiring a deployment secret', async t => {
  const f = await fixture(t); f.rejectLogin()
  const result = await f.service.loginVpnAccount({ email: 'test@example.invalid', password: 'wrong-password' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'Invalid credentials')
  assert.equal(result.status.account.authenticated, false)
})

test('Saved accounts refresh expired tokens without a client proof credential', async t => {
  const f = await fixture(t)
  const expired = `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`
  await fs.mkdir(path.join(f.dir, 'vpn'), { recursive: true })
  await fs.writeFile(path.join(f.dir, 'vpn/tokens.json'), JSON.stringify({
    accessToken: Buffer.from(expired).toString('base64'),
    refreshToken: Buffer.from('old-refresh-fixture').toString('base64'),
    email: Buffer.from('test@example.invalid').toString('base64'), tier: 'paid'
  }))
  const status = await f.service.getVpnStatus()
  assert.equal(status.account.authenticated, true)
  assert.equal(status.account.tier, 'paid')
  assert.equal(f.calls.filter(c => c.pathname === '/api/auth/refresh').length, 1)
  assert.equal(f.calls.find(c => c.pathname === '/api/client/me').headers.Authorization, 'Bearer account-fixture')
})
