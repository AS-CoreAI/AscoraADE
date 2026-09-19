const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { loadLanguageModule, explicitCatalog } = require('./language-fixture.cjs')
const { LANGUAGE_CODES, tr } = loadLanguageModule('index')
const { usageWindowLabel } = loadLanguageModule('usage')
const en = Object.fromEntries(explicitCatalog('en'))
const settingsSources = ['views/SettingsView.tsx', 'views/CliLimitsPage.tsx', 'components/ConnectionSettings.tsx', 'components/DeveloperToolsModal.tsx']
  .map(file => readFileSync(resolve(__dirname, '../../src/renderer/src', file), 'utf8')).join('\n')
const keys = Object.keys(en).filter(key => /^(app|common|settings|tools)\./.test(key) || /^composer\.(reasoning\.|permission\.|sandbox\.)/.test(key) || settingsSources.includes(`'${key}'`))
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

for (const language of LANGUAGE_CODES) {
  test(`${language}: every settings key is explicitly translated and preserves its placeholders`, () => {
    const entries = explicitCatalog(language)
    const catalog = Object.fromEntries(entries)
    assert.equal(entries.length, Object.keys(catalog).length, 'Duplicate translation keys')
    for (const key of keys) {
      assert.ok(Object.hasOwn(catalog, key), `${language}: missing ${key}`)
      assert.ok(catalog[key].trim(), `${language}: empty ${key}`)
      assert.deepEqual(placeholders(catalog[key]), placeholders(en[key]), `${language}: placeholders in ${key}`)
      assert.equal(tr(language, key), catalog[key])
    }
    for (const key of ['settings.appearance', 'settings.agentProviders', 'settings.usageLimits', 'settings.unslothHint', 'settings.antigravityModelHint']) {
      if (language !== 'en') assert.notEqual(catalog[key], en[key], `${language}: English fallback in ${key}`)
    }
    assert.ok(tr(language, 'settings.authorizedClis', { count: 3 }).includes('3'))
    assert.ok(tr(language, 'settings.remaining', { percent: 68 }).includes('68'))
    assert.ok(!tr(language, 'settings.keyAllowance', { amount: '$12.30' }).includes('{amount}'))
  })
}

test('quota labels localize known CLI windows and preserve model names and unknown upstream labels', () => {
  for (const language of LANGUAGE_CODES) {
    assert.equal(usageWindowLabel(language, 'session limit'), tr(language, 'settings.limitSession'))
    assert.equal(usageWindowLabel(language, 'weekly Opus limit'), tr(language, 'settings.limitWeeklyModel', { model: 'Opus' }))
    assert.equal(usageWindowLabel(language, 'Code review weekly limit'), `Code review ${tr(language, 'settings.limitWeekly')}`)
    assert.equal(usageWindowLabel(language, '12h limit'), tr(language, 'settings.limitHours', { count: 12 }))
    assert.equal(usageWindowLabel(language, '14d limit'), tr(language, 'settings.limitDays', { count: 14 }))
    assert.equal(usageWindowLabel(language, 'Gemini 3.8 Flash'), 'Gemini 3.8 Flash')
    assert.equal(usageWindowLabel(language, 'Custom quota'), 'Custom quota')
  }
})
