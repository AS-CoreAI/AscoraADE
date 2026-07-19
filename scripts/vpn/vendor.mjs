// Vendors the pinned VPN backends into .build/vpn for bundling via
// electron-builder extraResources (Windows targets only). Artifact-only:
// official upstream release artifacts are fetched at the exact pinned
// version and never modified.
//
//   wireguard/wireguard.exe  extracted from the official WireGuard MSI via an
//                            administrative image (msiexec /a — no elevation).
//                            The exe is self-contained: the signed WinTun and
//                            WireGuardNT drivers are embedded as resources, so
//                            it runs straight from process.resourcesPath.
//   openvpn/<name>.msi       the unmodified official OpenVPN community MSI.
//                            OpenVPN is NOT portable (driver + interactive
//                            service), so the app silently installs this MSI
//                            (msiexec /qn, one UAC prompt) on first use.
//
// Hash policy is trust-on-first-use: an empty sha256 in pin.json is filled in
// after the first successful download and enforced on every later run.
//
// Usage:
//   node scripts/vpn/vendor.mjs            full vendor
//   node scripts/vpn/vendor.mjs --ensure   skip when the manifest already
//                                          matches pin.json (dist:* fast path)
import crossSpawn from 'cross-spawn'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..', '..')
const PIN_PATH = join(SCRIPT_DIR, 'pin.json')
const STAGING = join(ROOT, '.build', 'vpn-staging')
const OUT = join(ROOT, '.build', 'vpn')
const MANIFEST = join(OUT, 'VENDOR_MANIFEST.json')

function log(msg) {
  console.log(`[vpn:vendor] ${msg}`)
}

function fail(msg) {
  console.error(`[vpn:vendor] ERROR: ${msg}`)
  process.exit(1)
}

if (process.platform !== 'win32') {
  // The VPN resources are bundled only into Windows targets; Linux relies on
  // distro packages (wireguard-tools / openvpn) as before.
  log('non-Windows host — VPN backends are not vendored for this platform')
  process.exit(0)
}

const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
for (const key of ['wireguard', 'openvpn']) {
  if (!pin[key]?.version || !pin[key]?.url) fail(`pin.json must contain ${key}.version and ${key}.url`)
}

if (process.argv.includes('--ensure') && existsSync(MANIFEST)) {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    if (
      manifest.wireguard?.version === pin.wireguard.version &&
      manifest.openvpn?.version === pin.openvpn.version &&
      existsSync(join(OUT, 'wireguard', 'wireguard.exe')) &&
      existsSync(join(OUT, 'openvpn', manifest.openvpn.file))
    ) {
      log(`already vendored (wireguard ${pin.wireguard.version}, openvpn ${pin.openvpn.version}) — nothing to do`)
      process.exit(0)
    }
  } catch {
    // fall through to a full re-vendor
  }
  log('manifest is stale — re-vendoring')
}

rmSync(STAGING, { recursive: true, force: true })
mkdirSync(STAGING, { recursive: true })

async function download(url, target) {
  log(`downloading ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) fail(`GET ${url} returned HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < 1024 * 1024) fail(`${url} returned ${bytes.length} bytes — too small to be the real artifact`)
  writeFileSync(target, bytes)
  return createHash('sha256').update(bytes).digest('hex')
}

function checkHash(name, actual) {
  const pinned = pin[name].sha256
  if (pinned && pinned !== actual) {
    fail(`${name} sha256 mismatch: pinned ${pinned}, downloaded ${actual}. Upstream artifact changed — investigate before re-pinning.`)
  }
  pin[name].sha256 = actual
}

function findFile(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(path, name)
      if (found) return found
    } else if (entry.name.toLowerCase() === name) {
      return path
    }
  }
  return null
}

const wireguardMsi = join(STAGING, basename(new URL(pin.wireguard.url).pathname))
const openvpnMsi = join(STAGING, basename(new URL(pin.openvpn.url).pathname))
checkHash('wireguard', await download(pin.wireguard.url, wireguardMsi))
checkHash('openvpn', await download(pin.openvpn.url, openvpnMsi))

// msiexec /a lays out an administrative image without touching the system and
// without elevation; wireguard.exe is somewhere inside that image.
log('extracting wireguard.exe from the MSI…')
const image = join(STAGING, 'wireguard-image')
const msiexec = crossSpawn.sync('msiexec', ['/a', wireguardMsi, '/qn', `TARGETDIR=${image}`], { stdio: 'inherit' })
if (msiexec.error) fail(`msiexec failed to start: ${msiexec.error.message}`)
if (msiexec.status !== 0) fail(`msiexec /a exited with ${msiexec.status}`)
const wireguardExe = findFile(image, 'wireguard.exe')
if (!wireguardExe) fail('wireguard.exe not found in the extracted administrative image')
if (statSync(wireguardExe).size < 1024 * 1024) fail('extracted wireguard.exe is implausibly small')

const assembled = join(STAGING, 'assembled')
mkdirSync(join(assembled, 'wireguard'), { recursive: true })
mkdirSync(join(assembled, 'openvpn'), { recursive: true })
copyFileSync(wireguardExe, join(assembled, 'wireguard', 'wireguard.exe'))
copyFileSync(openvpnMsi, join(assembled, 'openvpn', basename(openvpnMsi)))
writeFileSync(
  join(assembled, 'VENDOR_MANIFEST.json'),
  JSON.stringify(
    {
      vendoredAt: new Date().toISOString(),
      wireguard: { version: pin.wireguard.version, sha256: pin.wireguard.sha256, file: 'wireguard.exe' },
      openvpn: { version: pin.openvpn.version, sha256: pin.openvpn.sha256, file: basename(openvpnMsi) }
    },
    null,
    2
  )
)

rmSync(OUT, { recursive: true, force: true })
try {
  renameSync(assembled, OUT)
} catch {
  cpSync(assembled, OUT, { recursive: true, force: true })
}
rmSync(STAGING, { recursive: true, force: true })

// Persist trust-on-first-use hashes so later runs enforce them.
writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`)

log(`vendored: wireguard ${pin.wireguard.version} (portable exe), openvpn ${pin.openvpn.version} (installer MSI)`)
