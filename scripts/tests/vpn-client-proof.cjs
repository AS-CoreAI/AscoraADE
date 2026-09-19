// node --test scripts/tests/vpn-client-proof.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { loadTypeScript } = require('./llm-fixture.cjs')
const { createClientProofHeaders } = loadTypeScript('src/main/vpn/client-proof.ts')

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
