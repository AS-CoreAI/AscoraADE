import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHUNKS = join('node_modules', 'omniroute', 'dist', '.build', 'next', 'server', 'chunks')

// Exact, count-checked shims for the pinned release. Review on every upstream bump.
export const BUILTIN_PATCHES = [
  {
    id: 'reuse-electron-runtime:serve',
    path: join('node_modules', 'omniroute', 'bin', 'cli', 'commands', 'serve.mjs'),
    from: 'spawn("node",', to: 'spawn(process.execPath,', expected: 2
  },
  {
    id: 'reuse-electron-runtime:supervisor',
    path: join('node_modules', 'omniroute', 'bin', 'cli', 'runtime', 'processSupervisor.mjs'),
    from: 'spawn("node",', to: 'spawn(process.execPath,', expected: 1
  },
  {
    id: 'enable-node-sqlite-adapter', root: CHUNKS, extension: '.js',
    pattern: /let\{DatabaseSync:([A-Za-z_$][\w$]*)\}=\(\(\)=>\{let \1=Error\("Cannot find module 'node:sqlite': Unsupported external type Url for commonjs reference"\);throw \1\.code="MODULE_NOT_FOUND",\1\}\)\(\);/g,
    to: 'let{DatabaseSync:$1}=process.getBuiltinModule("node:sqlite");', expected: 10
  },
  {
    // The OMP credentials module is imported by startup instrumentation through
    // the DB barrel. Its eager better-sqlite3 import bypasses the driver's fallback
    // and crashes before node:sqlite can initialize the main database. OMP only
    // needs prepare/get/run/close, supported directly by DatabaseSync. Keep this
    // scoped to OMP and translate its readonly option; do not alias all native DBs.
    id: 'omp-credentials-node-sqlite', root: CHUNKS, extension: '.js',
    needle: '.i(785148)',
    pattern: /(?<![\w$])([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.i\(785148\)(?=;let [A-Za-z_$][\w$]*=\(\)=>[^;]*"\.omp","agent"[^;]*;)/g,
    to: '$1={default:class{constructor(path,options){return new (process.getBuiltinModule("node:sqlite").DatabaseSync)(path,{readOnly:options?.readonly===true})}}}',
    expected: 8
  }
]

export function applyBuiltinPatches(root, patches = BUILTIN_PATCHES, log = () => {}) {
  for (const patch of patches) {
    const files = []
    if (patch.path) {
      const file = join(root, patch.path)
      if (existsSync(file)) files.push(file)
    } else {
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const file = join(dir, entry.name)
          if (entry.isDirectory()) walk(file)
          else if (!patch.extension || entry.name.endsWith(patch.extension)) files.push(file)
        }
      }
      const dir = join(root, patch.root)
      if (existsSync(dir)) walk(dir)
    }
    let occurrences = 0
    const changes = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (patch.needle && !source.includes(patch.needle)) continue
      const count = patch.pattern ? [...source.matchAll(patch.pattern)].length : source.split(patch.from).length - 1
      occurrences += count
      if (count) changes.push([file, source])
    }
    if (occurrences !== patch.expected) {
      throw new Error(`Built-in patch ${patch.id} expected ${patch.expected} exact occurrences, found ${occurrences}; review the pinned upstream release.`)
    }
    for (const [file, source] of changes) {
      writeFileSync(file, patch.pattern ? source.replace(patch.pattern, patch.to) : source.replaceAll(patch.from, patch.to))
    }
    log(`applied built-in patch ${patch.id} (${occurrences} replacements)`)
  }
}
