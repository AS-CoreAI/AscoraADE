// Imports the provider catalog and local logo assets from an OmniRoute source checkout.
// The generated TypeScript and copied assets are committed so release builds do not
// depend on a sibling checkout. Usage:
//   node scripts/omniroute/sync-provider-catalog.mjs E:\OmniRoute

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceArg = process.argv[2]
const SOURCE = resolve(sourceArg || process.env.OMNIROUTE_SOURCE || join(ROOT, '..', 'OmniRoute'))
const catalogSource = join(SOURCE, 'src', 'lib', 'providers', 'catalog.ts')
const mediaServiceKindsSource = join(SOURCE, 'open-sse', 'config', 'mediaServiceKinds.ts')
const providerModelsSource = join(SOURCE, 'open-sse', 'config', 'providerModels.ts')
const iconSource = join(SOURCE, 'public', 'providers')
const generatedFile = join(ROOT, 'src', 'renderer', 'src', 'lib', 'omnirouteProviderCatalog.generated.ts')
const generatedModelsFile = join(ROOT, 'src', 'renderer', 'src', 'lib', 'omnirouteProviderModels.generated.ts')
const iconTarget = join(ROOT, 'src', 'renderer', 'public', 'providers')
const rendererPublicRoot = join(ROOT, 'src', 'renderer', 'public')

if (!iconTarget.startsWith(`${rendererPublicRoot}${sep}`)) {
  console.error('[omniroute:providers] refusing icon target outside renderer public directory')
  process.exit(1)
}

if (!existsSync(catalogSource) || !existsSync(iconSource) || !existsSync(providerModelsSource) || !existsSync(mediaServiceKindsSource)) {
  console.error(`[omniroute:providers] OmniRoute source checkout not found at ${SOURCE}`)
  process.exit(1)
}

const importUrl = pathToFileURL(catalogSource).href
const mediaImportUrl = pathToFileURL(mediaServiceKindsSource).href
// serviceKinds in catalog.ts are only the declared kinds (llm, web*, imageToText);
// the media kinds (image/video/music/tts/stt/embedding) are registry-derived and
// resolved client-side. Union them here so the capability filter works offline (#4240).
const extractScript = `
  Promise.all([import(${JSON.stringify(importUrl)}), import(${JSON.stringify(mediaImportUrl)})]).then(([catalog, media]) => {
    const entries = catalog.STATIC_PROVIDER_CATALOG_RESOLUTION_ORDER.flatMap((category) =>
      Object.values(catalog.STATIC_PROVIDER_CATALOG_GROUPS[category].providers).map((provider) => ({
        id: provider.id,
        name: provider.name,
        category,
        color: provider.color,
        textIcon: provider.textIcon,
        website: provider.website,
        authHint: provider.authHint,
        apiHint: provider.apiHint,
        freeNote: provider.freeNote,
        baseUrl: provider.baseUrl,
        localDefault: provider.localDefault,
        hasFree: provider.hasFree === true,
        noAuth: provider.noAuth === true,
        subscriptionRisk: provider.subscriptionRisk === true,
        deprecated: provider.deprecated === true,
        deprecationReason: provider.deprecationReason,
        passthroughModels: provider.passthroughModels === true,
        apiType: provider.apiType,
        serviceKinds: media.resolveProviderServiceKinds(provider.id, Array.isArray(provider.serviceKinds) ? provider.serviceKinds : []),
      }))
    );
    process.stdout.write(JSON.stringify(entries));
  });
`

const extraction = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', extractScript], {
  cwd: SOURCE,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024
})
if (extraction.status !== 0) {
  console.error(extraction.stderr || extraction.stdout || '[omniroute:providers] catalog extraction failed')
  process.exit(extraction.status || 1)
}

const entries = JSON.parse(extraction.stdout)
if (!Array.isArray(entries) || entries.length < 200) {
  console.error(`[omniroute:providers] refusing suspicious catalog with ${entries?.length ?? 0} entries`)
  process.exit(1)
}

const iconFiles = readdirSync(iconSource).filter((name) => ['.svg', '.png', '.webp'].includes(extname(name).toLowerCase()))
const iconByStem = new Map(iconFiles.map((name) => [basename(name, extname(name)).toLowerCase(), name]))
for (const entry of entries) {
  const icon = iconByStem.get(String(entry.id).toLowerCase())
  // Relative paths work both on Vite's dev server and in Electron's file:// build.
  if (icon) entry.logo = `./providers/${icon}`
}

const header = `// Generated from OmniRoute's provider catalog by scripts/omniroute/sync-provider-catalog.mjs.\n` +
  `// Do not edit provider entries by hand; regenerate them from the pinned upstream source.\n\n` +
  `export type OmniProviderCategory =\n` +
  `  | 'no-auth'\n  | 'oauth'\n  | 'web-cookie'\n  | 'local'\n  | 'search'\n  | 'audio'\n` +
  `  | 'upstream-proxy'\n  | 'cloud-agent'\n  | 'apikey'\n\n` +
  `export interface OmniProviderCatalogEntry {\n` +
  `  id: string\n  name: string\n  category: OmniProviderCategory\n  color?: string\n  textIcon?: string\n` +
  `  website?: string\n  authHint?: string\n  apiHint?: string\n  freeNote?: string\n  baseUrl?: string\n` +
  `  localDefault?: string\n` +
  `  hasFree?: boolean\n  noAuth?: boolean\n  subscriptionRisk?: boolean\n  deprecated?: boolean\n` +
  `  deprecationReason?: string\n  passthroughModels?: boolean\n  apiType?: string\n  serviceKinds: string[]\n` +
  `  logo?: string\n}\n\n`

writeFileSync(
  generatedFile,
  `${header}export const OMNI_PROVIDER_CATALOG: OmniProviderCatalogEntry[] = ${JSON.stringify(entries, null, 2)}\n`,
  'utf8'
)

rmSync(iconTarget, { recursive: true, force: true })
mkdirSync(iconTarget, { recursive: true })
for (const name of iconFiles) {
  writeFileSync(join(iconTarget, name), readFileSync(join(iconSource, name)))
}

// Built-in model catalog per provider alias — display-only data (id + name), so the
// detail panel can list a provider's models before any live connection is configured.
const modelsImportUrl = pathToFileURL(providerModelsSource).href
const modelsScript = `
  import(${JSON.stringify(modelsImportUrl)}).then((registry) => {
    const models = {};
    for (const alias of Object.keys(registry.PROVIDER_MODELS)) {
      const list = (registry.PROVIDER_MODELS[alias] || [])
        .filter((model) => model && typeof model.id === 'string' && model.id.length > 0)
        .map((model) => ({ id: model.id, name: typeof model.name === 'string' && model.name ? model.name : model.id }));
      if (list.length > 0) models[alias] = list;
    }
    const idAlias = {};
    for (const id of Object.keys(registry.PROVIDER_ID_TO_ALIAS)) {
      if (typeof registry.PROVIDER_ID_TO_ALIAS[id] === 'string') idAlias[id] = registry.PROVIDER_ID_TO_ALIAS[id];
    }
    process.stdout.write(JSON.stringify({ idAlias, models }));
  });
`
const modelsExtraction = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', modelsScript], {
  cwd: SOURCE,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024
})
if (modelsExtraction.status !== 0) {
  console.error(modelsExtraction.stderr || modelsExtraction.stdout || '[omniroute:providers] model registry extraction failed')
  process.exit(modelsExtraction.status || 1)
}
const registry = JSON.parse(modelsExtraction.stdout)
const modelAliases = Object.keys(registry.models ?? {})
const totalModels = modelAliases.reduce((count, alias) => count + registry.models[alias].length, 0)
if (modelAliases.length < 100 || totalModels < 800) {
  console.error(`[omniroute:providers] refusing suspicious model registry with ${modelAliases.length} aliases / ${totalModels} models`)
  process.exit(1)
}
const modelsHeader = `// Generated from OmniRoute's provider registry by scripts/omniroute/sync-provider-catalog.mjs.\n` +
  `// Built-in model catalog per provider alias, shown when no live connection is configured.\n` +
  `// Do not edit by hand; regenerate from the pinned upstream source.\n\n` +
  `export interface OmniBuiltinModel {\n  id: string\n  name: string\n}\n\n` +
  `export const OMNI_PROVIDER_ID_TO_ALIAS: Record<string, string> = ${JSON.stringify(registry.idAlias, null, 2)}\n\n` +
  `export const OMNI_BUILTIN_MODELS: Record<string, OmniBuiltinModel[]> = ${JSON.stringify(registry.models, null, 2)}\n\n` +
  `export function getBuiltinModels(providerId: string): OmniBuiltinModel[] {\n` +
  `  const alias = OMNI_PROVIDER_ID_TO_ALIAS[providerId] ?? providerId\n` +
  `  return OMNI_BUILTIN_MODELS[alias] ?? OMNI_BUILTIN_MODELS[providerId] ?? []\n}\n`
writeFileSync(generatedModelsFile, modelsHeader, 'utf8')

console.log(`[omniroute:providers] generated ${entries.length} providers, ${totalModels} built-in models across ${modelAliases.length} aliases, and copied ${iconFiles.length} icons`)
