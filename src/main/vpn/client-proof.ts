import { createHmac } from 'node:crypto'

/**
 * Compatibility with VPN deployments that still require a client HMAC.
 * A shared desktop-client key is not proof of a trusted application and must
 * never replace server-side account authorization, quotas, or rate limits.
 * Deployment secrets must be supplied at runtime, never committed or bundled.
 */
export function createClientProofHeaders(
  machineId: string,
  body: string,
  secret = process.env.WANDROUNIK_CLIENT_SECRET,
  now = Date.now()
): Record<string, string> {
  const key = secret?.trim()
  if (!key) {
    throw new Error('VPN client authorization is not configured for this build. Contact your VPN service operator.')
  }
  const ts = Math.floor(now / 1000).toString()
  const proof = createHmac('sha256', key)
    .update(`${ts}.${machineId}.${body}`)
    .digest('hex')
  return { 'X-Machine-Id': machineId, 'X-Client-Ts': ts, 'X-Client-Proof': proof }
}
