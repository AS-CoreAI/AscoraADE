import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** Only these server routes use require_client_proof. Account auth uses JWTs. */
export function requiresClientProof(pathname: string): boolean {
  return ['/api/client/connect', '/api/client/disconnect', '/api/client/traffic'].includes(pathname)
}

/** Private operator-provided release resource; never a source-code fallback. */
export async function readClientProofSecret(file: string, override = process.env.WANDROUNIK_CLIENT_SECRET): Promise<string> {
  if (override?.trim()) return override.trim()
  try {
    const config = JSON.parse(await readFile(file, 'utf8')) as { clientSecret?: unknown }
    if (typeof config.clientSecret === 'string' && config.clientSecret.trim()) return config.clientSecret.trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('The VPN client authorization resource is invalid. Reinstall the application or contact your VPN service operator.')
    }
  }
  throw new Error('VPN client authorization is missing. Reinstall the official build or configure WANDROUNIK_CLIENT_SECRET for a source build.')
}

/**
 * Compatibility with VPN deployments that still require a client HMAC.
 * A shared desktop-client key is not proof of a trusted application and must
 * never replace server-side account authorization, quotas, or rate limits.
 * Deployment credentials must be provided by the operator, never committed.
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
