// A build inside the repository must not pass by resolving a missing bundled
// dependency from Ascora's development node_modules further up the directory tree.
const Module = require('node:module')
const { isAbsolute, relative, resolve, sep } = require('node:path')
const root = resolve(process.env.ASCORA_OMNIROUTE_SMOKE_ROOT)
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  const filename = originalResolve.call(this, request, parent, ...rest)
  if (isAbsolute(filename)) {
    const rel = relative(root, filename)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
      const error = new Error(`Dependency outside bundled OmniRoute: ${request}`)
      error.code = 'MODULE_NOT_FOUND'
      throw error
    }
  }
  return filename
}
