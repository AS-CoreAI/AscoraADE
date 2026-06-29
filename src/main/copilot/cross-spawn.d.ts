// Minimal ambient types for `cross-spawn` (the package ships none and
// `@types/cross-spawn` is not installed). Mirrors the runtime contract we use:
// a drop-in replacement for `child_process.spawn` that resolves Windows
// `.cmd`/`.bat` shims and escapes arguments safely.
declare module 'cross-spawn' {
  import type { ChildProcess, SpawnOptions } from 'node:child_process'
  function spawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess
  export = spawn
}
