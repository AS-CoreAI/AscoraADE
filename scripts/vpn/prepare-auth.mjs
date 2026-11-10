// Operator-only input. The resulting resource is ignored by Git and packaged
// separately from the public source; do not log or commit its contents.
import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(root, '.build/vpn-client-auth.json')
try {
  let secret = process.env.WANDROUNIK_CLIENT_SECRET?.trim()
  if (!secret) {
    const input = process.env.WANDROUNIK_CLIENT_AUTH_FILE || output
    const config = JSON.parse(await readFile(input, 'utf8'))
    if (typeof config.clientSecret === 'string') secret = config.clientSecret.trim()
  }
  if (!secret) throw new Error('Missing credential')
  await mkdir(dirname(output), { recursive: true })
  const temp = `${output}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify({ clientSecret: secret }) + '\n', { mode: 0o600 })
  await rename(temp, output)
  await chmod(output, 0o600)
  console.log('[vpn:auth] Private client authorization resource is ready.')
} catch {
  console.error('[vpn:auth] Configure WANDROUNIK_CLIENT_SECRET or WANDROUNIK_CLIENT_AUTH_FILE before building a Windows release. No credential was written to source code.')
  process.exitCode = 1
}
