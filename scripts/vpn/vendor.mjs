// Vendors the pinned VPN backends into .build/vpn for bundling via
// electron-builder extraResources (Windows targets only). Artifact-only:
// official upstream release artifacts are fetched at the exact pinned
// version. The upstream binaries themselves are never modified.
//
//   wireguard/wireguard.exe  extracted from the official WireGuard MSI via an
//                            administrative image (msiexec /a — no elevation).
//                            The exe is self-contained: the signed WinTun and
//                            WireGuardNT drivers are embedded as resources, so
//                            it runs straight from process.resourcesPath.
//   openvpn/openvpn.exe      extracted from the official OpenVPN Community MSI
//   openvpn/*.dll            together with its runtime DLLs and the official
//                            Wintun DLL. Ascora runs this self-contained engine
//                            directly with --windows-driver wintun.
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
const OPENVPN_RUNTIME_FILES = [
  'openvpn.exe',
  'libcrypto-3-x64.dll',
  'libssl-3-x64.dll',
  'libpkcs11-helper-1.dll',
  'vcruntime140.dll'
]

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
for (const key of ['wireguard', 'openvpn', 'wintun']) {
  if (!pin[key]?.version || !pin[key]?.url) fail(`pin.json must contain ${key}.version and ${key}.url`)
}

if (process.argv.includes('--ensure') && existsSync(MANIFEST)) {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    if (
      manifest.wireguard?.version === pin.wireguard.version &&
      manifest.openvpn?.version === pin.openvpn.version &&
      manifest.wintun?.version === pin.wintun.version &&
      existsSync(join(OUT, 'wireguard', 'wireguard.exe')) &&
      [...OPENVPN_RUNTIME_FILES, 'wintun.dll', 'LICENSE-openvpn.txt', 'LICENSE-wintun.txt']
        .every((file) => existsSync(join(OUT, 'openvpn', file)))
    ) {
      log(`already vendored (wireguard ${pin.wireguard.version}, openvpn ${pin.openvpn.version}, wintun ${pin.wintun.version}) — nothing to do`)
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
  if (bytes.length < 64 * 1024) fail(`${url} returned ${bytes.length} bytes — too small to be the real artifact`)
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
const wintunZip = join(STAGING, basename(new URL(pin.wintun.url).pathname))
checkHash('wireguard', await download(pin.wireguard.url, wireguardMsi))
checkHash('openvpn', await download(pin.openvpn.url, openvpnMsi))
checkHash('wintun', await download(pin.wintun.url, wintunZip))

// msiexec /a lays out administrative images without touching the system or
// requiring elevation.
function extractMsi(msi, image) {
  const result = crossSpawn.sync('msiexec', ['/a', msi, '/qn', `TARGETDIR=${image}`], { stdio: 'inherit' })
  if (result.error) fail(`msiexec failed to start: ${result.error.message}`)
  if (result.status !== 0) fail(`msiexec /a exited with ${result.status}`)
}

log('extracting WireGuard and OpenVPN from the official MSIs…')
const wireguardImage = join(STAGING, 'wireguard-image')
const openvpnImage = join(STAGING, 'openvpn-image')
extractMsi(wireguardMsi, wireguardImage)
extractMsi(openvpnMsi, openvpnImage)

log('extracting Wintun…')
const wintunImage = join(STAGING, 'wintun-image')
const expand = crossSpawn.sync('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Expand-Archive -LiteralPath $env:ASCORA_VPN_WINTUN_ZIP -DestinationPath $env:ASCORA_VPN_WINTUN_IMAGE -Force'
], {
  stdio: 'inherit',
  env: { ...process.env, ASCORA_VPN_WINTUN_ZIP: wintunZip, ASCORA_VPN_WINTUN_IMAGE: wintunImage }
})
if (expand.error) fail(`PowerShell failed to start: ${expand.error.message}`)
if (expand.status !== 0) fail(`Expand-Archive exited with ${expand.status}`)

const wireguardExe = findFile(wireguardImage, 'wireguard.exe')
if (!wireguardExe) fail('wireguard.exe not found in the extracted administrative image')
if (statSync(wireguardExe).size < 1024 * 1024) fail('extracted wireguard.exe is implausibly small')

const openvpnFiles = new Map(OPENVPN_RUNTIME_FILES.map((name) => [name, findFile(openvpnImage, name)]))
for (const [name, source] of openvpnFiles) {
  if (!source) fail(`${name} not found in the extracted OpenVPN administrative image`)
}
const openvpnLicense = findFile(openvpnImage, 'license.txt')
if (!openvpnLicense) fail('OpenVPN license.txt not found in the extracted administrative image')
const wintunDll = join(wintunImage, 'wintun', 'bin', 'amd64', 'wintun.dll')
const wintunLicense = join(wintunImage, 'wintun', 'LICENSE.txt')
if (!existsSync(wintunDll)) fail('amd64 wintun.dll not found in the official Wintun archive')
if (!existsSync(wintunLicense)) fail('Wintun LICENSE.txt not found in the official Wintun archive')

const assembled = join(STAGING, 'assembled')
mkdirSync(join(assembled, 'wireguard'), { recursive: true })
mkdirSync(join(assembled, 'openvpn'), { recursive: true })
copyFileSync(wireguardExe, join(assembled, 'wireguard', 'wireguard.exe'))
for (const [name, source] of openvpnFiles) {
  copyFileSync(source, join(assembled, 'openvpn', name))
}
copyFileSync(wintunDll, join(assembled, 'openvpn', 'wintun.dll'))
copyFileSync(openvpnLicense, join(assembled, 'openvpn', 'LICENSE-openvpn.txt'))
copyFileSync(wintunLicense, join(assembled, 'openvpn', 'LICENSE-wintun.txt'))
writeFileSync(
  join(assembled, 'VENDOR_MANIFEST.json'),
  JSON.stringify(
    {
      vendoredAt: new Date().toISOString(),
      wireguard: { version: pin.wireguard.version, sha256: pin.wireguard.sha256, file: 'wireguard.exe' },
      openvpn: { version: pin.openvpn.version, sha256: pin.openvpn.sha256, file: 'openvpn.exe', runtimeFiles: OPENVPN_RUNTIME_FILES },
      wintun: { version: pin.wintun.version, sha256: pin.wintun.sha256, file: 'wintun.dll' }
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

log(`vendored: wireguard ${pin.wireguard.version}, openvpn ${pin.openvpn.version}, wintun ${pin.wintun.version} (self-contained runtime)`)
