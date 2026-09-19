// Vendors the pinned OmniRoute release into .build/omniroute for bundling
// via electron-builder extraResources. Artifact-only: upstream is fetched
// from npm at the exact pinned version, trimmed of dead weight, and never
// forked. See scripts/omniroute/README.md for the runbook.
//
// Usage:
//   node scripts/omniroute/vendor.mjs            full vendor + smoke test
//   node scripts/omniroute/vendor.mjs --ensure   reuse/repair a matching pinned
//                                                artifact, then verify boot
//   node scripts/omniroute/vendor.mjs --no-smoke vendor without the boot test
import crossSpawn from 'cross-spawn'
import {
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
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTIN_PATCHES, applyBuiltinPatches } from './vendor-patches.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..', '..')
const PIN_PATH = join(SCRIPT_DIR, 'pin.json')
const PATCHES_DIR = join(SCRIPT_DIR, 'patches')
const STAGING = join(ROOT, '.build', 'omniroute-staging')
const OUT = join(ROOT, '.build', 'omniroute')
const MANIFEST = join(OUT, 'VENDOR_MANIFEST.json')
// All recursive trimming/promotion stays in these two generated build folders.
for (const target of [STAGING, OUT]) {
  if (dirname(target) !== join(ROOT, '.build')) throw new Error(`Unsafe vendor path: ${target}`)
}

// Docs/locale languages that ship with the app (matches src/renderer/src/language/index.ts).
const KEEP_LANGS = new Set(['en', 'ru', 'uk', 'de', 'fr', 'it', 'pl', 'zh', 'ko', 'ja', 'hi'])
const LANG_DIR_RE = /^[a-z]{2}(?:[-_][A-Za-z]{2,4})?$/
const LICENSE_RE = /^(licen[cs]e|notice|copying)(\.|$)/i

// Upstream's prebundled standalone tree (dist/node_modules inside the package)
// ships prebuilt N-API binaries. Policy:
//  - Whole feature packages we never use (image processing, tunnels, ML
//    compression) are pruned entirely — none ship Windows binaries anyway.
//  - koffi + wreq-js back upstream's TLS-fingerprint HTTP stack (anti-bot
//    providers). Their prebuilt N-API x64 binaries for our two build targets
//    are ALLOWLISTED (prebuilt, ABI-stable, no rebuild step — this does not
//    reintroduce the native build pipeline the app deliberately avoids).
//    Every other platform variant is deleted.
const PRUNE_PACKAGES = new Set(['@img', '@ngrok', 'onnxruntime-node', 'better-sqlite3', '@types'])
const NATIVE_KEEP = [
  /koffi[\\/]build[\\/]koffi[\\/](?:win32_x64|linux_x64)[\\/]koffi\.node$/,
  /wreq-js[\\/]rust[\\/]wreq-js\.(?:win32-x64-msvc|linux-x64-gnu)\.node$/
]

function isAllowedNative(path) {
  return NATIVE_KEEP.some((re) => re.test(path))
}

const args = new Set(process.argv.slice(2))
const resumeStaging = args.has('--resume-staging')

function log(msg) {
  console.log(`[omniroute:vendor] ${msg}`)
}

function fail(msg) {
  console.error(`[omniroute:vendor] ERROR: ${msg}`)
  process.exit(1)
}

function run(cmd, argv, opts) {
  const res = crossSpawn.sync(cmd, argv, { stdio: 'inherit', ...opts })
  if (res.error) fail(`${cmd} failed to start: ${res.error.message}`)
  if (res.status !== 0) fail(`${cmd} ${argv.join(' ')} exited with ${res.status}`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function smokeVendored() {
  if (args.has('--no-smoke')) { log('smoke test skipped (--no-smoke)'); return }
  log('running smoke test…')
  const smoke = crossSpawn.sync(process.execPath, [join(SCRIPT_DIR, 'smoke.mjs')], { stdio: 'inherit', cwd: ROOT })
  if (smoke.status !== 0) {
    rmSync(MANIFEST, { force: true })
    fail('smoke test failed — the vendored tree does not boot; manifest removed')
  }
  log('done — vendored tree is bootable')
}

const pin = readJson(PIN_PATH)
if (!pin.name || !pin.version) fail('pin.json must contain name and version')

if (args.has('--ensure') && existsSync(MANIFEST)) {
  const manifest = readJson(MANIFEST)
  const expectedBuiltinPatches = BUILTIN_PATCHES.map((patch) => patch.id)
  const manifestBuiltinPatches = Array.isArray(manifest.builtinPatches) ? manifest.builtinPatches : []
  if (
    manifest.version === pin.version &&
    JSON.stringify(manifestBuiltinPatches) === JSON.stringify(expectedBuiltinPatches)
  ) {
    log(`already vendored ${pin.name}@${pin.version} — verifying boot`)
    smokeVendored()
    process.exit(0)
  }
  // New compatibility shims can repair this exact pinned artifact without
  // downloading/unpacking its gigabyte-sized dependency tree again.
  if (manifest.version === pin.version && manifest.integrity === pin.resolvedIntegrity &&
      manifestBuiltinPatches.length > 0 &&
      manifestBuiltinPatches.every((id, index) => expectedBuiltinPatches[index] === id)) {
    const pending = BUILTIN_PATCHES.slice(manifestBuiltinPatches.length)
    applyBuiltinPatches(OUT, pending, log)
    writeFileSync(MANIFEST, JSON.stringify({ ...manifest, builtinPatches: expectedBuiltinPatches }, null, 2))
    smokeVendored()
    process.exit(0)
  }
  log(`manifest or built-in patch set is stale for ${pin.name}@${pin.version} — re-vendoring`)
}

// ---------------------------------------------------------------------------
// 1. Fetch the pinned release into a clean staging tree
// ---------------------------------------------------------------------------
if (resumeStaging) {
  log('resuming the existing post-trim staging tree after a failed promotion…')
} else {
  log(`fetching ${pin.name}@${pin.version} (this downloads several hundred MB)…`)
  rmSync(STAGING, { recursive: true, force: true })
  mkdirSync(STAGING, { recursive: true })
  writeFileSync(
    join(STAGING, 'package.json'),
    JSON.stringify(
      {
        name: 'ascora-omniroute-vendor',
        private: true,
        dependencies: { [pin.name]: pin.version }
      },
      null,
      2
    )
  )

  run(
    'npm',
    ['install', '--ignore-scripts', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', '--loglevel=error'],
    {
      cwd: STAGING,
      env: {
        ...process.env,
        OMNIROUTE_SKIP_POSTINSTALL: '1',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        PLAYWRIGHT_BROWSERS_PATH: '0',
        PUPPETEER_SKIP_DOWNLOAD: '1'
      }
    }
  )

  // esbuild's platform binaries are optional dependencies, so the blanket
  // --omit=optional above intentionally excludes them. OmniRoute still uses
  // esbuild during CLI boot, however. Install only the two x64 binaries for
  // Ascora's Windows/Linux build targets, pinned to the JS package's exact
  // version; the subsequent trimmer removes any incidental reified extras.
  const esbuildPackage = readJson(join(STAGING, 'node_modules', 'esbuild', 'package.json'))
  log(`installing esbuild platform binaries @ ${esbuildPackage.version}…`)
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-save',
      '--package-lock=false',
      '--omit=optional',
      '--force',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      `@esbuild/win32-x64@${esbuildPackage.version}`,
      `@esbuild/linux-x64@${esbuildPackage.version}`
    ],
    {
      cwd: STAGING,
      env: {
        ...process.env,
        OMNIROUTE_SKIP_POSTINSTALL: '1',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        PUPPETEER_SKIP_DOWNLOAD: '1'
      }
    }
  )
}

const pkgDir = join(STAGING, 'node_modules', pin.name)
const pkgJsonPath = join(pkgDir, 'package.json')
if (!existsSync(pkgJsonPath)) fail(`install produced no ${pin.name} package`)
const pkgJson = readJson(pkgJsonPath)
if (pkgJson.version !== pin.version) {
  fail(`installed version ${pkgJson.version} does not match pin ${pin.version}`)
}

// Record the registry integrity hash for the audit trail (npm verified it on install).
let integrity = ''
const lockPath = join(STAGING, 'package-lock.json')
if (existsSync(lockPath)) {
  const lock = readJson(lockPath)
  integrity = lock.packages?.[`node_modules/${pin.name}`]?.integrity ?? ''
}

// ---------------------------------------------------------------------------
// 2. Trim dead weight (delete-only: the tree layout is never reshaped)
// ---------------------------------------------------------------------------
log(resumeStaging ? 'staging is already trimmed' : 'trimming…')
let filesRemoved = 0
let bytesRemoved = 0

function rmPath(path) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) rmPath(join(path, entry))
    rmSync(path, { recursive: true, force: true })
  } else {
    filesRemoved += 1
    bytesRemoved += stat.size
    rmSync(path, { force: true })
  }
}

// 2a. docs/locales: keep only the languages the app ships.
function trimLangDirs(base) {
  if (!existsSync(base)) return
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (LANG_DIR_RE.test(name) && !KEEP_LANGS.has(name.toLowerCase().split(/[-_]/)[0])) {
      rmPath(join(base, name))
    }
  }
}
if (!resumeStaging) {
  trimLangDirs(join(pkgDir, 'docs'))
  trimLangDirs(join(pkgDir, 'locales'))
  trimLangDirs(join(pkgDir, 'public', 'docs'))
}

// 2b. Tests/CI/examples inside the omniroute package only.
if (!resumeStaging) {
  for (const dir of ['test', 'tests', '__tests__', 'e2e', '.github', 'examples']) {
    rmPath(join(pkgDir, dir))
  }
}

// 2c. Whole-tree sweep.
function sweep(dir, inOmniroutePkg, inNodeModules) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    const name = entry.name
    if (entry.isDirectory()) {
      if (name === 'prebuilds' || name === '.local-browsers') {
        rmPath(path)
        continue
      }
      // Feature packages we never use (and native stragglers) at any
      // node_modules level, including upstream's prebundled dist/node_modules.
      if (inNodeModules && PRUNE_PACKAGES.has(name)) {
        rmPath(path)
        continue
      }
      sweep(path, inOmniroutePkg || path === pkgDir, name === 'node_modules')
      continue
    }
    if (name.endsWith('.node') && !isAllowedNative(path)) {
      rmPath(path)
      continue
    }
    if (name.endsWith('.map')) {
      rmPath(path)
      continue
    }
    if (name.endsWith('.md') && !LICENSE_RE.test(name)) {
      rmPath(path)
      continue
    }
    if (inOmniroutePkg && (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || /^playwright\.config\./.test(name))) {
      rmPath(path)
    }
  }
}
if (!resumeStaging) {
  sweep(join(STAGING, 'node_modules'), false, true)
}

// ---------------------------------------------------------------------------
// 3. Emergency patches (unified diffs, applied in filename order)
// ---------------------------------------------------------------------------
const patches = existsSync(PATCHES_DIR)
  ? readdirSync(PATCHES_DIR)
      .filter((f) => f.endsWith('.patch'))
      .sort()
  : []
if (!resumeStaging) {
  for (const patch of patches) {
    log(`applying patch ${patch}`)
    run('git', ['apply', '--whitespace=nofix', '-p1', '--directory', relative(ROOT, STAGING).replaceAll('\\', '/'), join(PATCHES_DIR, patch)], {
      cwd: ROOT
    })
  }

  applyBuiltinPatches(STAGING, BUILTIN_PATCHES, log)

}

// ---------------------------------------------------------------------------
// 4. Assertions
// ---------------------------------------------------------------------------
log('running assertions…')

let totalFiles = 0
let totalBytes = 0
const forbiddenNative = []
const keptNative = []
function audit(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      audit(path)
    } else {
      totalFiles += 1
      try {
        totalBytes += statSync(path).size
      } catch {
        /* ignore */
      }
      if (entry.name.endsWith('.node')) {
        ;(isAllowedNative(path) ? keptNative : forbiddenNative).push(relative(STAGING, path).replaceAll('\\', '/'))
      }
    }
  }
}
audit(STAGING)

if (forbiddenNative.length > 0) {
  fail(
    `non-allowlisted native modules found in the vendored tree:\n  ${forbiddenNative.join('\n  ')}\n` +
      'Either prune the owning package or consciously extend NATIVE_KEEP.'
  )
}
if (keptNative.length > 0) {
  log(`allowlisted prebuilt N-API binaries kept:\n  ${keptNative.join('\n  ')}`)
}

let binRel = pkgJson.bin
if (typeof binRel === 'object' && binRel !== null) binRel = binRel[pin.name] ?? Object.values(binRel)[0]
if (typeof binRel !== 'string' || binRel.length === 0) fail('could not resolve the omniroute bin entry from its package.json')
const entryAbs = join(pkgDir, binRel)
if (!existsSync(entryAbs)) fail(`bin entry ${binRel} does not exist in the package`)

// ---------------------------------------------------------------------------
// 5. Promote staging -> .build/omniroute and write the manifest
// ---------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true })

async function promoteStaging() {
  let lastError
  // Windows Defender/indexing can briefly retain handles after npm/trim walks
  // a very large tree. Retry the atomic rename before using the slower but
  // reliable copy fallback.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      renameSync(STAGING, OUT)
      return
    } catch (error) {
      lastError = error
      const code = error?.code
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code)) throw error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (attempt + 1)))
    }
  }
  log(`atomic staging promotion stayed locked (${lastError?.code ?? 'unknown'}); copying instead…`)
  rmSync(OUT, { recursive: true, force: true })
  cpSync(STAGING, OUT, { recursive: true, force: true })
  rmSync(STAGING, { recursive: true, force: true })
}

await promoteStaging()

const manifest = {
  name: pin.name,
  version: pin.version,
  vendoredAt: new Date().toISOString(),
  entry: join('node_modules', pin.name, binRel).replaceAll('\\', '/'),
  files: totalFiles,
  bytes: totalBytes,
  integrity,
  trimmed: { filesRemoved, bytesRemoved },
  keptNative,
  patches,
  builtinPatches: BUILTIN_PATCHES.map((patch) => patch.id),
  resumedStaging: resumeStaging
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))

if (integrity && readFileSync(PIN_PATH, 'utf8').includes('"resolvedIntegrity": ""')) {
  writeFileSync(PIN_PATH, JSON.stringify({ ...pin, resolvedIntegrity: integrity }, null, 2) + '\n')
}

log(
  `vendored ${pin.name}@${pin.version}: ${totalFiles} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB ` +
    `(trimmed ${filesRemoved} files / ${(bytesRemoved / 1024 / 1024).toFixed(1)} MB)`
)

// ---------------------------------------------------------------------------
// 6. Smoke test — an unbootable vendored tree must never reach a build
// ---------------------------------------------------------------------------
smokeVendored()
