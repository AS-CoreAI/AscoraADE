// Bumps the pinned OmniRoute version, re-vendors and smoke-tests it.
// On any failure the pin is reverted, so a DOA upstream publish (it has
// happened: 3.8.47 crashed on every boot) can never land in a build.
//
// Usage:
//   npm run omniroute:update              -> latest published version
//   npm run omniroute:update -- 3.8.49    -> explicit version
import crossSpawn from 'cross-spawn'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..', '..')
const PIN_PATH = join(SCRIPT_DIR, 'pin.json')
const MANIFEST = join(ROOT, '.build', 'omniroute', 'VENDOR_MANIFEST.json')

function log(msg) {
  console.log(`[omniroute:update] ${msg}`)
}

const pinRaw = readFileSync(PIN_PATH, 'utf8')
const pin = JSON.parse(pinRaw)

let target = process.argv[2]
if (!target) {
  const res = crossSpawn.sync('npm', ['view', pin.name, 'version'], { encoding: 'utf8' })
  if (res.status !== 0) {
    console.error(`[omniroute:update] npm view failed: ${res.stderr || res.error?.message}`)
    process.exit(1)
  }
  target = res.stdout.trim()
}

if (target === pin.version) {
  log(`already pinned to ${pin.name}@${target}`)
}

const before = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null

log(`updating pin ${pin.version} -> ${target}`)
writeFileSync(PIN_PATH, JSON.stringify({ ...pin, version: target, resolvedIntegrity: '' }, null, 2) + '\n')

const vendor = crossSpawn.sync(process.execPath, [join(SCRIPT_DIR, 'vendor.mjs')], { stdio: 'inherit', cwd: ROOT })
if (vendor.status !== 0) {
  writeFileSync(PIN_PATH, pinRaw) // revert
  console.error(
    `[omniroute:update] FAILED — pin reverted to ${pin.version}. ` +
      `The broken tree is left in .build/omniroute for inspection.`
  )
  process.exit(1)
}

const after = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
log('SUCCESS')
log(`  version: ${before?.version ?? '(none)'} -> ${after.version}`)
if (before) {
  log(`  size:    ${mb(before.bytes)} -> ${mb(after.bytes)} (${after.files - before.files >= 0 ? '+' : ''}${after.files - before.files} files)`)
} else {
  log(`  size:    ${mb(after.bytes)} (${after.files} files)`)
}
log('')
log('Checklist before committing:')
log('  1. Update the OmniRoute version in THIRD_PARTY_NOTICES.md')
log('  2. Add a changelog.md entry')
log('  3. Skim upstream release notes for env/flag renames (defaults drift!)')
log('  4. Commit scripts/omniroute/pin.json')
