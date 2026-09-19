const { readFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const languageDir = resolve(__dirname, '../../src/renderer/src/language')
const cache = new Map()
function loadLanguageModule(name) {
  const filename = resolve(languageDir, `${name}.ts`)
  if (cache.has(filename)) return cache.get(filename)
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(dirname(filename))
  mod.require = (id) => id.startsWith('./') ? loadLanguageModule(id.slice(2)) : Module.prototype.require.call(mod, id)
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename)
  cache.set(filename, mod.exports)
  return mod.exports
}

// Inspect explicit entries, so spreading ...en cannot conceal missing translations.
function explicitCatalog(code) {
  const source = ts.createSourceFile(code, readFileSync(resolve(languageDir, `${code}.ts`), 'utf8'), ts.ScriptTarget.Latest, true)
  const entries = []
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isStringLiteral(node.initializer)) entries.push([node.name.text, node.initializer.text])
    ts.forEachChild(node, visit)
  }
  visit(source)
  return entries
}
module.exports = { loadLanguageModule, explicitCatalog }
