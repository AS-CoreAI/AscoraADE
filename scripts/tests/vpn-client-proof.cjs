// node --test scripts/tests/vpn-client-proof.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { createClientProofHeaders, readClientProofSecret, requiresClientProof } = loadTypeScript('src/main/vpn/client-proof.ts')
const fs = require('node:fs/promises')
const path = require('node:path')

test('VPN proof refuses empty deployment credentials and has no built-in fallback', () => {
  for (const secret of ['', ' ', '\n\t']) {
    assert.throws(() => createClientProofHeaders('device', '{}', secret), /not configured/)
  }
  const saved = process.env.WANDROUNIK_CLIENT_SECRET
  try {
    delete process.env.WANDROUNIK_CLIENT_SECRET
    assert.throws(() => createClientProofHeaders('device', '{}'), /not configured/)
  } finally {
    if (saved === undefined) delete process.env.WANDROUNIK_CLIENT_SECRET
    else process.env.WANDROUNIK_CLIENT_SECRET = saved
  }
})

test('VPN proof remains compatible with the server protocol without disclosing the key', () => {
  const secret = 'local-test-fixture-only'
  const machineId = 'a'.repeat(64)
  const body = JSON.stringify({ protocol: 'wireguard', server_id: 1 })
  const now = 1800000000123
  const expected = createHmac('sha256', secret).update(`1800000000.${machineId}.${body}`).digest('hex')
  const headers = createClientProofHeaders(machineId, body, secret, now)
  assert.deepEqual(headers, {
    'X-Machine-Id': machineId,
    'X-Client-Ts': '1800000000',
    'X-Client-Proof': expected
  })
  assert.ok(!JSON.stringify(headers).includes(secret))
  for (const changed of [
    createClientProofHeaders('b'.repeat(64), body, secret, now),
    createClientProofHeaders(machineId, body + ' ', secret, now),
    createClientProofHeaders(machineId, body, secret, now + 1000)
  ]) assert.notEqual(changed['X-Client-Proof'], expected)
})

test('Only tunnel and traffic routes require the legacy proof', () => {
  for (const route of ['/api/client/connect', '/api/client/disconnect', '/api/client/traffic']) assert.equal(requiresClientProof(route), true)
  for (const route of ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout', '/api/client/me', '/api/client/servers', '/api/client/device/register', '/api/portal/payments']) assert.equal(requiresClientProof(route), false)
})

test('Private release credentials load outside source, allow rotation and reject missing/invalid resources', async t => {
  const root = path.resolve(__dirname, '../../.build')
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(path.join(root, 'vpn-proof-'))
  t.after(async () => { assert.equal(path.dirname(dir), root); await fs.rm(dir, { recursive: true, force: true }) })
  const file = path.join(dir, 'client-auth.json')
  await assert.rejects(readClientProofSecret(file, ''), /authorization is missing/)
  assert.equal(await readClientProofSecret(file, ' runtime-fixture '), 'runtime-fixture')
  await fs.writeFile(file, JSON.stringify({ clientSecret: ' release-fixture ' }))
  assert.equal(await readClientProofSecret(file, ''), 'release-fixture')
  assert.equal(await readClientProofSecret(file, 'rotated-fixture'), 'rotated-fixture')
  await fs.writeFile(file, 'invalid')
  await assert.rejects(readClientProofSecret(file, ''), /resource is invalid/)
})
