const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

/** Run the production TypeScript client in Node, including its shared contract. */
function loadTypeScript(relative, overrides = {}) {
  const filename = resolve(__dirname, '../..', relative)
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(require('node:path').dirname(filename))
  mod.require = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id]
    if (id.startsWith('@shared/')) return loadTypeScript(`src/shared/${id.slice(8)}.ts`, overrides)
    return Module.prototype.require.call(mod, id)
  }
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename)
  return mod.exports
}

module.exports = { loadTypeScript }
