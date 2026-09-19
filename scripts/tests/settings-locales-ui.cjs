// Run after npm run build, or pass a packaged app.asar/out/renderer/index.html.
// Uses only the isolated settings fixture.
const { join, resolve } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { loadLanguageModule } = require('./language-fixture.cjs')
const { LANGUAGE_CODES, tr, localeForLanguage } = loadLanguageModule('index')
const output = resolve(__dirname, '../../.build/settings-locales-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.disableHardwareAcceleration()
const errors = []
let win
const evaluate = code => win.webContents.executeJavaScript(code)
async function waitFor(condition) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await evaluate(condition)) return
    await new Promise(done => setTimeout(done, 30))
  }
  throw new Error(`Timed out: ${condition}`)
}
async function click(selector) {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
async function contains(selector, expected) {
  await waitFor(`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(expected)})`)
}
async function fits(context) {
  await evaluate('new Promise(resolve => requestAnimationFrame(resolve))')
  const overflow = await evaluate(`[...document.querySelectorAll('.settings-content,.settings-nav,.settings-card')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({class:el.className,width:el.clientWidth,scroll:el.scrollWidth}))`)
  assert.deepEqual(overflow, [], `${context}: horizontal overflow`)
}
async function screenshot(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG())
}
const providerKeys = {
  lmstudio: ['settings.endpointOpenAi'],
  ollama: ['settings.ollamaEndpoint'],
  unsloth: ['settings.unslothHint', 'settings.unslothApiKey', 'settings.saveAndTest', 'settings.unslothModelsHint'],
  openrouter: ['settings.openRouterHint', 'settings.enableOpenRouter'],
  omniroute: ['settings.omnirouteProviders'],
  codex: ['settings.codexHint', 'composer.reasoningEffort', 'settings.signOut'],
  copilot: ['settings.copilotHint', 'settings.authorize', 'settings.signInRequired'],
  claude: ['settings.claudeHint', 'settings.claudeThinkingHint'],
  gemini: ['settings.geminiHint', 'settings.installAutomatically'],
  grok: ['settings.grokHint'],
  glm: ['settings.zcodeHint'],
  antigravity: ['settings.antigravityPath', 'settings.antigravityPathHint', 'settings.antigravityModelHint', 'settings.reasoningLevel'],
  wprovider: ['settings.wproviderService', 'settings.wproviderHint']
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1000, height: 850, show: false,
    webPreferences: { preload: join(__dirname, 'settings-preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await win.webContents.session.clearStorageData()
  await win.loadFile(process.argv[2] || resolve(__dirname, '../../out/renderer/index.html'))
  await click(`[title="${tr('ru', 'rail.preferencesSettings')}"]`)
  for (const language of LANGUAGE_CODES) {
    const t = (key, values) => tr(language, key, values)
    await click('[data-section="appearance"]')
    await click(`[data-language="${language}"]`)
    await contains('.settings-content h1', t('settings.appearance'))
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.settings-nav nav > button')].map(el => el.textContent.trim())`), [t('settings.appearance'), t('settings.agentProviders'), t('settings.usageLimits'), t('tools.title')])
    assert.equal(await evaluate(`document.querySelector('.settings-nav nav').getAttribute('aria-label')`), t('settings.sections'))
    assert.equal(await evaluate(`window.ascora.settings.get('appearance.language')`), language)
    await contains('.settings-content', t('app.theme.system'))
    await fits(`${language}: appearance`)
    await screenshot(`${language}-appearance`)
    await click('[data-section="providers"]')
    for (const [provider, keys] of Object.entries(providerKeys)) {
      await click(`.settings-provider-nav [data-provider="${provider}"]`)
      await contains('.settings-content', t('settings.showProvider'))
      await contains('.settings-content', t('settings.connectionSettings'))
      for (const key of keys) {
        // Endpoint examples keep their configured URLs; test the localized surrounding text.
        const expected = t(key).split('{url}')[0]
        if (key === 'settings.enableOpenRouter') {
          assert.equal(await evaluate(`document.querySelector('.skill-toggle').title`), expected)
        } else await contains('.settings-content', expected)
      }
      if (provider === 'antigravity') {
        assert.deepEqual(await evaluate(`[...document.querySelectorAll('.antigravity-reasoning-select option')].map(el => el.textContent)`), ['low','medium','high'].map(level => t(`composer.reasoning.${level}`)))
        assert.equal(await evaluate(`document.querySelector('.provider-settings-form input').placeholder`), t('settings.antigravityAutoDetect'))
      }
      await fits(`${language}: ${provider}`)
      if (['de','ja','hi'].includes(language) && provider === 'antigravity') await screenshot(`${language}-antigravity`)
    }
    await click('[data-section="limits"]')
    await contains('.settings-limit-card[data-provider="codex"]', t('settings.remaining', { percent: 68 }))
    await contains('.settings-limit-card[data-provider="codex"]', t('settings.limitSession'))
    await contains('.settings-limit-card[data-provider="grok"]', t('settings.cliLimitsUnsupported'))
    assert.equal(await evaluate(`document.querySelector('.settings-limit-card[data-provider="codex"] .usage-item time').textContent`), new Date('2026-09-19T18:00:00Z').toLocaleString(localeForLanguage(language)))
    await fits(`${language}: limits`)
    if (['de','ja','hi'].includes(language)) await screenshot(`${language}-limits`)
    await evaluate(`window.settingsFixture.signedOut = ['codex','claude','copilot','gemini','grok','glm','antigravity']`)
    await waitFor(`!document.querySelector('.settings-content-header button').disabled`)
    await click('.settings-content-header button')
    await contains('.settings-content', t('settings.noAuthorizedClisHint'))
    await evaluate(`window.settingsFixture.signedOut = ['copilot']`)
    await click('[data-section="tools"]')
    await contains('#developer-tools-title', t('tools.title'))
    await contains('.tool-card', t('tools.ripgrepDescription'))
    await fits(`${language}: tools`)
    console.log(`${language}: all four sections, 13 providers, reasoning, quotas, dates and compact layout OK`)
  }
  // Language choice must also survive restarting the renderer.
  win.reload()
  await click(`[title="${tr('hi', 'rail.preferencesSettings')}"]`)
  await contains('.settings-nav-title', tr('hi', 'settings.title'))
  assert.deepEqual(errors, [])
  console.log('Settings localization UI OK: all 11 languages, no runtime errors')
  app.exit(0)
}).catch(error => { console.error(error, errors); app.exit(1) })
