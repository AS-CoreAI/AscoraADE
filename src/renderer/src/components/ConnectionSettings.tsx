import { useState, type JSX } from 'react'
import { Icon } from './Icon'
import {
  CODEX_MODEL_PRESETS,
  COPILOT_MODEL_PRESETS,
  GEMINI_MODEL_PRESETS,
  openRouterModelOptions,
  REASONING_LABEL_KEY,
  COPILOT_REASONING_LABEL_KEY,
  SANDBOX_SHORT_KEY,
  COPILOT_PERMISSION_SHORT_KEY,
  PERMISSION_SHORT_KEY,
  GEMINI_PERMISSION_SHORT_KEY,
  GLM_MODE_SHORT_KEY
} from './Composer'
import { useApp } from '@/state/store'
import { tr, type TranslationKey } from '@/language'
import {
  DEFAULT_LLM_CONFIG,
  CODEX_REASONING_LEVELS,
  COPILOT_PERMISSION_MODES,
  COPILOT_REASONING_LEVELS,
  CLAUDE_MODEL_PRESETS,
  CLAUDE_PERMISSION_MODES,
  GEMINI_APPROVAL_MODES,
  GLM_MODES,
  normalizeOpenRouterApiKey,
  type CodexReasoning,
  type CodexSandbox,
  type CopilotPermissionMode,
  type CopilotReasoning,
  type ClaudePermissionMode,
  type GeminiApprovalMode,
  type GlmMode,
  type LlmProvider
} from '@shared/ipc'

function useT(): (key: TranslationKey, values?: Record<string, string | number>) => string {
  const appLanguage = useApp((s) => s.appLanguage)
  return (key, values) => tr(appLanguage, key, values)
}

function LmStudioPanel(): JSX.Element {
  const t = useT()
  const baseUrl = useApp((s) => s.baseUrl)
  const setBaseUrl = useApp((s) => s.setBaseUrl)
  const model = useApp((s) => s.model)
  const models = useApp((s) => s.models)
  const setModel = useApp((s) => s.setModel)
  const connection = useApp((s) => s.connection)
  const connectionError = useApp((s) => s.connectionError)

  const [url, setUrl] = useState(baseUrl)
  const [testing, setTesting] = useState(false)

  const test = async (): Promise<void> => {
    setTesting(true)
    await setBaseUrl(url.trim() || DEFAULT_LLM_CONFIG.baseUrl)
    setTesting(false)
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.baseUrl')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={url}
            spellCheck={false}
            placeholder={DEFAULT_LLM_CONFIG.baseUrl}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void test()}
          />
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? t('common.testing') : t('common.test')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.endpointOpenAi', { url: DEFAULT_LLM_CONFIG.baseUrl })}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <select
          className="text-input"
          value={model || (models[0] ?? '')}
          onChange={(e) => setModel(e.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">{model || t('settings.noModels')}</option>
          ) : (
            models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
      </label>

      <div className={`conn-line ${connection}`}>
        {connection === 'connected' && `✓ ${t('settings.connectedModels', { count: models.length })}`}
        {connection === 'connecting' && t('settings.connecting')}
        {connection === 'error' && `✗ ${connectionError ?? t('settings.connectionFailed')}`}
        {connection === 'unknown' && t('settings.notTestedYet')}
      </div>
    </>
  )
}

function OllamaPanel(): JSX.Element {
  const t = useT()
  const ollamaBaseUrl = useApp((s) => s.ollamaBaseUrl)
  const setOllamaBaseUrl = useApp((s) => s.setOllamaBaseUrl)
  const ollamaModel = useApp((s) => s.ollamaModel)
  const models = useApp((s) => s.models)
  const setOllamaModel = useApp((s) => s.setOllamaModel)
  const connection = useApp((s) => s.connection)
  const connectionError = useApp((s) => s.connectionError)

  const [url, setUrl] = useState(ollamaBaseUrl)
  const [testing, setTesting] = useState(false)

  const test = async (): Promise<void> => {
    setTesting(true)
    await setOllamaBaseUrl(url.trim() || DEFAULT_LLM_CONFIG.ollamaBaseUrl)
    setTesting(false)
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.baseUrl')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={url}
            spellCheck={false}
            placeholder={DEFAULT_LLM_CONFIG.ollamaBaseUrl}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void test()}
          />
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? t('common.testing') : t('common.test')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.ollamaEndpoint', { url: DEFAULT_LLM_CONFIG.ollamaBaseUrl })}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <select
          className="text-input"
          value={ollamaModel || (models[0] ?? '')}
          onChange={(e) => setOllamaModel(e.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">{ollamaModel || t('settings.noModels')}</option>
          ) : (
            models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
      </label>

      <div className={`conn-line ${connection}`}>
        {connection === 'connected' && `Ollama ${t('settings.connectedModels', { count: models.length })}`}
        {connection === 'connecting' && `${t('settings.connecting')} Ollama`}
        {connection === 'error' && `Ollama: ${connectionError ?? t('settings.connectionFailed')}`}
        {connection === 'unknown' && t('settings.notTestedYet')}
      </div>
    </>
  )
}

function CodexPanel(): JSX.Element {
  const t = useT()
  const codexPath = useApp((s) => s.codexPath)
  const setCodexPath = useApp((s) => s.setCodexPath)
  const codexModel = useApp((s) => s.codexModel)
  const setCodexModel = useApp((s) => s.setCodexModel)
  const codexSandbox = useApp((s) => s.codexSandbox)
  const setCodexSandbox = useApp((s) => s.setCodexSandbox)
  const codexReasoning = useApp((s) => s.codexReasoning)
  const setCodexReasoning = useApp((s) => s.setCodexReasoning)
  const check = useApp((s) => s.codexCheck)
  const checking = useApp((s) => s.codexChecking)
  const checkCodex = useApp((s) => s.checkCodex)

  const [path, setPath] = useState(codexPath)

  const apply = async (): Promise<void> => {
    await setCodexPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.codexBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectCodex')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.codexHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="codex-model-presets"
          value={codexModel}
          spellCheck={false}
          placeholder={t('composer.codexDefault')}
          onChange={(e) => setCodexModel(e.target.value)}
        />
        <datalist id="codex-model-presets">
          {CODEX_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.sandbox')}</span>
        <select
          className="text-input"
          value={codexSandbox}
          onChange={(e) => setCodexSandbox(e.target.value as CodexSandbox)}
        >
          {(Object.keys(SANDBOX_SHORT_KEY) as CodexSandbox[]).map((s) => (
            <option key={s} value={s}>
              {t(SANDBOX_SHORT_KEY[s])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.codexPolicyHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">Reasoning effort</span>
        <select
          className="text-input"
          value={codexReasoning}
          onChange={(e) => setCodexReasoning(e.target.value as CodexReasoning | '')}
        >
          <option value="">{t('settings.autoCodexDefault')}</option>
          {CODEX_REASONING_LEVELS.map((r) => (
            <option key={r} value={r}>
              {t(REASONING_LABEL_KEY[r])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.reasoningHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Codex' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? 'Codex CLI not found.'}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'codex'} ·{' '}
            {check.loggedIn ? check.authNote ?? t('settings.signedIn') : t('settings.notSignedInCodex')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.codexSigninHint')}
        </div>
      )}

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void checkCodex()} disabled={checking}>
        {t('settings.recheck')}
      </button>
    </>
  )
}

function CopilotPanel(): JSX.Element {
  const t = useT()
  const copilotPath = useApp((s) => s.copilotPath)
  const setCopilotPath = useApp((s) => s.setCopilotPath)
  const copilotModel = useApp((s) => s.copilotModel)
  const setCopilotModel = useApp((s) => s.setCopilotModel)
  const copilotPermission = useApp((s) => s.copilotPermission)
  const setCopilotPermission = useApp((s) => s.setCopilotPermission)
  const copilotReasoning = useApp((s) => s.copilotReasoning)
  const setCopilotReasoning = useApp((s) => s.setCopilotReasoning)
  const check = useApp((s) => s.copilotCheck)
  const checking = useApp((s) => s.copilotChecking)
  const checkCopilot = useApp((s) => s.checkCopilot)
  const setCopilotAuthOpen = useApp((s) => s.setCopilotAuthOpen)

  const [path, setPath] = useState(copilotPath)

  const apply = async (): Promise<void> => {
    await setCopilotPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.copilotBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectPath')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.copilotHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="copilot-model-presets"
          value={copilotModel}
          spellCheck={false}
          placeholder={t('composer.copilotDefault')}
          onChange={(e) => setCopilotModel(e.target.value)}
        />
        <datalist id="copilot-model-presets">
          {COPILOT_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.permissionProfile')}</span>
        <select
          className="text-input"
          value={copilotPermission}
          onChange={(e) => setCopilotPermission(e.target.value as CopilotPermissionMode)}
        >
          {COPILOT_PERMISSION_MODES.map((p) => (
            <option key={p} value={p}>
              {t(COPILOT_PERMISSION_SHORT_KEY[p])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.copilotPolicyHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('composer.reasoningEffort')}</span>
        <select
          className="text-input"
          value={copilotReasoning}
          onChange={(e) => setCopilotReasoning(e.target.value as CopilotReasoning | '')}
        >
          <option value="">{t('settings.autoCopilotDefault')}</option>
          {COPILOT_REASONING_LEVELS.map((r) => (
            <option key={r} value={r}>
              {t(COPILOT_REASONING_LABEL_KEY[r])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.copilotReasoningHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Copilot' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `x ${check.error ?? 'GitHub Copilot CLI not found.'}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'copilot'} · {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.copilotLoginHint')}
        </div>
      )}

      <div className="field-row" style={{ alignSelf: 'flex-start' }}>
        <button className="btn btn-icon" onClick={() => setCopilotAuthOpen(true)}>
          <Icon name="terminal" size={14} />
          {t('settings.authorize')}
        </button>
        <button className="btn" onClick={() => void checkCopilot()} disabled={checking}>
          {t('settings.recheck')}
        </button>
      </div>
    </>
  )
}

function ClaudePanel(): JSX.Element {
  const t = useT()
  const claudePath = useApp((s) => s.claudePath)
  const setClaudePath = useApp((s) => s.setClaudePath)
  const claudeModel = useApp((s) => s.claudeModel)
  const setClaudeModel = useApp((s) => s.setClaudeModel)
  const claudePermission = useApp((s) => s.claudePermission)
  const setClaudePermission = useApp((s) => s.setClaudePermission)
  const check = useApp((s) => s.claudeCheck)
  const checking = useApp((s) => s.claudeChecking)
  const checkClaude = useApp((s) => s.checkClaude)

  const [path, setPath] = useState(claudePath)
  const apply = async (): Promise<void> => {
    await setClaudePath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.claudeBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectClaude')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.claudeHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="claude-model-presets"
          value={claudeModel}
          spellCheck={false}
          placeholder={t('settings.claudeModelPlaceholder')}
          onChange={(e) => setClaudeModel(e.target.value)}
        />
        <datalist id="claude-model-presets">
          {CLAUDE_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.permissionMode')}</span>
        <select
          className="text-input"
          value={claudePermission}
          onChange={(e) => setClaudePermission(e.target.value as ClaudePermissionMode)}
        >
          {CLAUDE_PERMISSION_MODES.map((p) => (
            <option key={p} value={p}>
              {t(PERMISSION_SHORT_KEY[p])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.claudePolicyHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Claude' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? 'Claude Code CLI not found.'}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'claude'} · {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void checkClaude()}
        disabled={checking}
      >
        {t('settings.recheck')}
      </button>
    </>
  )
}

function GeminiPanel(): JSX.Element {
  const t = useT()
  const geminiPath = useApp((s) => s.geminiPath)
  const setGeminiPath = useApp((s) => s.setGeminiPath)
  const geminiModel = useApp((s) => s.geminiModel)
  const setGeminiModel = useApp((s) => s.setGeminiModel)
  const geminiPermission = useApp((s) => s.geminiPermission)
  const setGeminiPermission = useApp((s) => s.setGeminiPermission)
  const check = useApp((s) => s.geminiCheck)
  const checking = useApp((s) => s.geminiChecking)
  const checkGemini = useApp((s) => s.checkGemini)

  const [path, setPath] = useState(geminiPath)
  const apply = async (): Promise<void> => {
    await setGeminiPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.geminiBinary')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectPath')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.geminiHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <input
          className="text-input"
          list="gemini-model-presets"
          value={geminiModel}
          spellCheck={false}
          placeholder={t('settings.geminiModelPlaceholder')}
          onChange={(e) => setGeminiModel(e.target.value)}
        />
        <datalist id="gemini-model-presets">
          {GEMINI_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.approvalMode')}</span>
        <select
          className="text-input"
          value={geminiPermission}
          onChange={(e) => setGeminiPermission(e.target.value as GeminiApprovalMode)}
        >
          {GEMINI_APPROVAL_MODES.map((p) => (
            <option key={p} value={p}>
              {t(GEMINI_PERMISSION_SHORT_KEY[p])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.geminiPolicyHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'Gemini' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? 'Gemini CLI not found.'}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'gemini'} · {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.geminiLoginHint')}
        </div>
      )}

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void checkGemini()}
        disabled={checking}
      >
        {t('settings.recheck')}
      </button>
    </>
  )
}

function GlmPanel(): JSX.Element {
  const t = useT()
  const glmPath = useApp((s) => s.glmPath)
  const setGlmPath = useApp((s) => s.setGlmPath)
  const glmMode = useApp((s) => s.glmMode)
  const setGlmMode = useApp((s) => s.setGlmMode)
  const check = useApp((s) => s.glmCheck)
  const checking = useApp((s) => s.glmChecking)
  const checkGlm = useApp((s) => s.checkGlm)

  const [path, setPath] = useState(glmPath)
  const apply = async (): Promise<void> => {
    await setGlmPath(path.trim())
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{t('settings.zcodePath')}</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={t('settings.autoDetectZcode')}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? t('common.checking') : t('common.check')}
          </button>
        </div>
        <span className="field-hint">
          {t('settings.zcodeHint')}
        </span>
      </label>

      <label className="field">
        <span className="field-label">{t('settings.permissionMode')}</span>
        <select
          className="text-input"
          value={glmMode}
          onChange={(e) => setGlmMode(e.target.value as GlmMode)}
        >
          {GLM_MODES.map((m) => (
            <option key={m} value={m}>
              {t(GLM_MODE_SHORT_KEY[m])}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.zcodePolicyHint')}
        </span>
      </label>

      <div
        className={`conn-line ${
          checking
            ? 'connecting'
            : !check
              ? 'unknown'
              : check.installed && check.loggedIn
                ? 'connected'
                : 'error'
        }`}
      >
        {checking && t('settings.checkingName', { name: 'ZCode' })}
        {!checking && !check && t('settings.notCheckedYet')}
        {!checking && check && !check.installed && `✗ ${check.error ?? 'ZCode not found.'}`}
        {!checking && check && check.installed && (
          <>
            {check.loggedIn ? '✓' : '⚠'} {check.version ? `zcode ${check.version}` : 'zcode'} ·{' '}
            {check.authNote ?? t('settings.ready')}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          {t('settings.zcodeSigninHint')}
        </div>
      )}

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void checkGlm()}
        disabled={checking}
      >
        {t('settings.recheck')}
      </button>
    </>
  )
}

function OpenRouterSetup(): JSX.Element {
  const t = useT()
  const openRouterEnabled = useApp((s) => s.openRouterEnabled)
  const openRouterApiKey = useApp((s) => s.openRouterApiKey)
  const setOpenRouterEnabled = useApp((s) => s.setOpenRouterEnabled)
  const setOpenRouterApiKey = useApp((s) => s.setOpenRouterApiKey)

  const [apiKey, setApiKey] = useState(openRouterApiKey)
  const [saving, setSaving] = useState(false)
  const ready = openRouterEnabled && openRouterApiKey.trim().length > 0

  const save = async (): Promise<void> => {
    const normalized = normalizeOpenRouterApiKey(apiKey)
    setSaving(true)
    await setOpenRouterApiKey(normalized)
    setApiKey(normalized)
    setSaving(false)
  }

  return (
    <div className="field">
      <span className="field-label">OpenRouter</span>
      <div className="field-row" style={{ alignItems: 'center' }}>
        <label
          className="skill-toggle"
          title={openRouterEnabled ? t('settings.disableOpenRouter') : t('settings.enableOpenRouter')}
        >
          <input
            type="checkbox"
            checked={openRouterEnabled}
            onChange={(e) => void setOpenRouterEnabled(e.target.checked)}
          />
        </label>
        <span className="field-hint">{t('settings.openRouterHint')}</span>
      </div>
      <div className="field-row">
        <input
          className="text-input"
          type="password"
          value={apiKey}
          spellCheck={false}
          placeholder="sk-or-v1-..."
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? t('settings.saving') : t('common.save')}
        </button>
      </div>
      <span className="field-hint">
        {ready
          ? t('settings.openRouterReady')
          : t('settings.openRouterSetup')}
      </span>
    </div>
  )
}

function OpenRouterPanel(): JSX.Element {
  const t = useT()
  const openRouterModel = useApp((s) => s.openRouterModel)
  const setOpenRouterModel = useApp((s) => s.setOpenRouterModel)
  const models = useApp((s) => s.models)
  const connection = useApp((s) => s.connection)
  const connectionError = useApp((s) => s.connectionError)
  const refreshModels = useApp((s) => s.refreshModels)

  const modelOptions = openRouterModelOptions(models, openRouterModel)

  return (
    <>
      <label className="field">
        <span className="field-label">{t('common.model')}</span>
        <select
          className="text-input"
          value={openRouterModel || modelOptions[0]}
          onChange={(e) => setOpenRouterModel(e.target.value)}
        >
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="field-hint">
          {t('settings.defaultModel', { model: DEFAULT_LLM_CONFIG.openRouterModel })}
        </span>
      </label>

      <div className={`conn-line ${connection}`}>
        {connection === 'connected' && `OpenRouter ${t('settings.connectedModels', { count: models.length })}`}
        {connection === 'connecting' && `${t('settings.connecting')} OpenRouter`}
        {connection === 'error' && `OpenRouter: ${connectionError ?? t('settings.connectionFailed')}`}
        {connection === 'unknown' && t('settings.notTestedYet')}
      </div>

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void refreshModels()}>
        {t('settings.refreshModels')}
      </button>
    </>
  )
}

export function ConnectionSettings(): JSX.Element | null {
  const t = useT()
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const provider = useApp((s) => s.provider)
  const setProvider = useApp((s) => s.setProvider)
  const lmStudioReachable = useApp((s) => s.lmStudioReachable)
  const openRouterReady = useApp(
    (s) => s.openRouterEnabled && s.openRouterApiKey.trim().length > 0
  )
  const lmStudioUnavailable = !lmStudioReachable

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {t('settings.agentBackend')}
          <button className="modal-close" onClick={() => setOpen(false)} title={t('common.close')}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span className="field-label">{t('common.provider')}</span>
            <span
              className="provider-select-wrap"
              data-tooltip={lmStudioUnavailable ? t('composer.lmStudioNotRunning') : undefined}
            >
              <select
                className="text-input"
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as LlmProvider
                  if (next === 'lmstudio' && lmStudioUnavailable) return
                  void setProvider(next)
                }}
              >
                <option value="lmstudio" disabled={lmStudioUnavailable}>
                  {t('settings.providerLmStudio')}
                </option>
                <option value="ollama">{t('settings.providerOllama')}</option>
                {openRouterReady && <option value="openrouter">{t('settings.providerOpenRouter')}</option>}
                <option value="codex">{t('settings.providerCodex')}</option>
                <option value="copilot">{t('settings.providerCopilot')}</option>
                <option value="claude">{t('settings.providerClaude')}</option>
                <option value="gemini">{t('settings.providerGemini')}</option>
                <option value="glm">{t('settings.providerGlm')}</option>
              </select>
            </span>
          </label>

          {provider === 'openrouter' && <OpenRouterSetup />}

          {provider === 'codex' ? (
            <CodexPanel />
          ) : provider === 'ollama' ? (
            <OllamaPanel />
          ) : provider === 'copilot' ? (
            <CopilotPanel />
          ) : provider === 'claude' ? (
            <ClaudePanel />
          ) : provider === 'gemini' ? (
            <GeminiPanel />
          ) : provider === 'glm' ? (
            <GlmPanel />
          ) : provider === 'openrouter' ? (
            <OpenRouterPanel />
          ) : (
            <LmStudioPanel />
          )}
        </div>
      </div>
    </div>
  )
}
