import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHUNKS = join('node_modules', 'omniroute', 'dist', '.build', 'next', 'server', 'chunks')

// Exact, count-checked shims for the pinned release. Review on every upstream bump.
//
// omniroute@3.8.54 needs fewer shims than 3.8.48: its CLI and process supervisor
// already spawn process.execPath (Electron with ELECTRON_RUN_AS_NODE), and its DB
// driver factory opens node:sqlite natively on Node >= 22.5, so the former
// runtime/node:sqlite stubs have nothing left to replace.
export const BUILTIN_PATCHES = [
  {
    // The OMP credential helper still prefers better-sqlite3, which vendoring
    // prunes. Since 3.8.54 it fails soft (returns null), which would silently
    // drop OMP credential access instead of crashing startup. OMP only needs
    // prepare/get/run/close, supported directly by DatabaseSync. Keep this scoped
    // to OMP and translate its readonly option; do not alias all native DBs.
    id: 'omp-credentials-node-sqlite', root: CHUNKS, extension: '.js',
    needle: '".omp","agent"),"agent.db")',
    pattern: /(?<=function [A-Za-z_$][\w$]*\(\)\{try\{if\(process\.versions\.bun\)return\(0,[A-Za-z_$][\w$]*\.f\)\("bun:sqlite"\)\.Database;)return\(0,[A-Za-z_$][\w$]*\.f\)\("better-sqlite3"\)(?=\}catch\{return null\}\})/g,
    to: 'return class{constructor(path,options){return new (process.getBuiltinModule("node:sqlite").DatabaseSync)(path,{readOnly:options?.readonly===true})}}',
    expected: 1
  },
  {
    // Vendoring prunes the @img scope (sharp's native libvips builds): Ascora
    // does not ship image processing. 3.8.54's media guardrails import the sharp
    // external statically from startup instrumentation, so a missing @img/*
    // package aborts boot. Keep the module resolvable and fail only the image
    // operation itself with the original load error; code that already loads
    // sharp lazily keeps its own fallback.
    id: 'optional-sharp-external', root: CHUNKS, extension: '.js',
    needle: '.y("sharp")',
    pattern: /var ([A-Za-z_$][\w$]*)=await ([A-Za-z_$][\w$]*)\.y\("sharp"\);/g,
    to: 'var $1;try{$1=await $2.y("sharp")}catch(sharpError){$1=function(){throw sharpError}}',
    expected: 10
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
