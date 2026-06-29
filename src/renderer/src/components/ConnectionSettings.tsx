import { useState, type JSX } from 'react'
import { Icon } from './Icon'
import { REASONING_LABEL, CODEX_MODEL_PRESETS, openRouterModelOptions } from './Composer'
import { useApp } from '@/state/store'
import {
  DEFAULT_LLM_CONFIG,
  CODEX_REASONING_LEVELS,
  CLAUDE_MODEL_PRESETS,
  CLAUDE_PERMISSION_MODES,
  GLM_MODES,
  normalizeOpenRouterApiKey,
  type CodexReasoning,
  type CodexSandbox,
  type ClaudePermissionMode,
  type GlmMode,
  type LlmProvider
} from '@shared/ipc'

const PERMISSION_LABEL: Record<ClaudePermissionMode, string> = {
  plan: 'Plan only (read-only; proposes a plan)',
  default: 'Ask (default; some tools auto-denied in print mode)',
  acceptEdits: 'Auto-accept edits (sandboxed to workspace)',
  bypassPermissions: 'Full access (skip all permission checks)'
}

const SANDBOX_LABEL: Record<CodexSandbox, string> = {
  'read-only': 'Read-only (no edits or commands)',
  'workspace-write': 'Workspace write (edit this folder, sandboxed)',
  'danger-full-access': 'Full access (no sandbox — dangerous)'
}

const GLM_MODE_LABEL: Record<GlmMode, string> = {
  plan: 'Plan only (read-only; proposes a plan)',
  build: 'Build (may pause for approvals — can stall headless)',
  edit: 'Auto-edit (may pause for command approvals)',
  yolo: 'Full access (auto-approve everything — recommended headless)'
}

function LmStudioPanel(): JSX.Element {
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
        <span className="field-label">Base URL</span>
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
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
        <span className="field-hint">OpenAI-compatible endpoint, e.g. {DEFAULT_LLM_CONFIG.baseUrl}</span>
      </label>

      <label className="field">
        <span className="field-label">Model</span>
        <select
          className="text-input"
          value={model || (models[0] ?? '')}
          onChange={(e) => setModel(e.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">{model || '— no models —'}</option>
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
        {connection === 'connected' && `✓ Connected — ${models.length} model(s) available.`}
        {connection === 'connecting' && 'Connecting…'}
        {connection === 'error' && `✗ ${connectionError ?? 'Connection failed.'}`}
        {connection === 'unknown' && 'Not tested yet.'}
      </div>
    </>
  )
}

function CodexPanel(): JSX.Element {
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
        <span className="field-label">Codex binary</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder="(auto-detect: PATH or VS Code extension)"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? 'Checking…' : 'Check'}
          </button>
        </div>
        <span className="field-hint">
          Leave blank to use `codex` from PATH or the bundled "OpenAI Codex" VS Code extension.
        </span>
      </label>

      <label className="field">
        <span className="field-label">Model</span>
        <input
          className="text-input"
          list="codex-model-presets"
          value={codexModel}
          spellCheck={false}
          placeholder="Codex default"
          onChange={(e) => setCodexModel(e.target.value)}
        />
        <datalist id="codex-model-presets">
          {CODEX_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">Sandbox</span>
        <select
          className="text-input"
          value={codexSandbox}
          onChange={(e) => setCodexSandbox(e.target.value as CodexSandbox)}
        >
          {(Object.keys(SANDBOX_LABEL) as CodexSandbox[]).map((s) => (
            <option key={s} value={s}>
              {SANDBOX_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="field-hint">
          Codex runs its own agent loop and applies edits autonomously within this policy.
        </span>
      </label>

      <label className="field">
        <span className="field-label">Reasoning effort</span>
        <select
          className="text-input"
          value={codexReasoning}
          onChange={(e) => setCodexReasoning(e.target.value as CodexReasoning | '')}
        >
          <option value="">Auto (Codex default)</option>
          {CODEX_REASONING_LEVELS.map((r) => (
            <option key={r} value={r}>
              {REASONING_LABEL[r]}
            </option>
          ))}
        </select>
        <span className="field-hint">
          Higher effort = deeper reasoning, slower and more tokens. Applies to Codex reasoning
          models (gpt-5.5, gpt-5.4, …).
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && 'Checking Codex…'}
        {!checking && !check && 'Not checked yet.'}
        {!checking && check && !check.installed && `✗ ${check.error ?? 'Codex CLI not found.'}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'codex'} ·{' '}
            {check.loggedIn ? check.authNote ?? 'signed in' : 'not signed in — run: codex login'}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          Sign in once from a terminal: <code>codex login</code>, then press Check again.
        </div>
      )}

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void checkCodex()} disabled={checking}>
        Re-check
      </button>
    </>
  )
}

function ClaudePanel(): JSX.Element {
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
        <span className="field-label">Claude binary</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder="(auto-detect: PATH or Claude Code VS Code extension)"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? 'Checking…' : 'Check'}
          </button>
        </div>
        <span className="field-hint">
          Leave blank to use `claude` from PATH or the bundled "Claude Code" VS Code extension. Uses
          your existing Claude subscription / login.
        </span>
      </label>

      <label className="field">
        <span className="field-label">Model</span>
        <input
          className="text-input"
          list="claude-model-presets"
          value={claudeModel}
          spellCheck={false}
          placeholder="Claude default (opus / sonnet / haiku or a full id)"
          onChange={(e) => setClaudeModel(e.target.value)}
        />
        <datalist id="claude-model-presets">
          {CLAUDE_MODEL_PRESETS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field-label">Permission mode</span>
        <select
          className="text-input"
          value={claudePermission}
          onChange={(e) => setClaudePermission(e.target.value as ClaudePermissionMode)}
        >
          {CLAUDE_PERMISSION_MODES.map((p) => (
            <option key={p} value={p}>
              {PERMISSION_LABEL[p]}
            </option>
          ))}
        </select>
        <span className="field-hint">
          Claude Code runs its own agent loop and applies edits autonomously within this policy.
        </span>
      </label>

      <div
        className={`conn-line ${
          checking ? 'connecting' : !check ? 'unknown' : check.installed ? 'connected' : 'error'
        }`}
      >
        {checking && 'Checking Claude…'}
        {!checking && !check && 'Not checked yet.'}
        {!checking && check && !check.installed && `✗ ${check.error ?? 'Claude Code CLI not found.'}`}
        {!checking && check && check.installed && (
          <>
            ✓ {check.version ?? 'claude'} · {check.authNote ?? 'ready'}
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
        Re-check
      </button>
    </>
  )
}

function GlmPanel(): JSX.Element {
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
        <span className="field-label">ZCode path</span>
        <div className="field-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder="(auto-detect installed ZCode)"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void apply()}
          />
          <button className="btn" onClick={() => void apply()} disabled={checking}>
            {checking ? 'Checking…' : 'Check'}
          </button>
        </div>
        <span className="field-hint">
          Install folder, ZCode.exe, or resources/glm/zcode.cjs. Leave blank to auto-detect the
          installed app. Ascora keeps its sessions separate and never rewrites ZCode&apos;s CLI config.
        </span>
      </label>

      <label className="field">
        <span className="field-label">Permission mode</span>
        <select
          className="text-input"
          value={glmMode}
          onChange={(e) => setGlmMode(e.target.value as GlmMode)}
        >
          {GLM_MODES.map((m) => (
            <option key={m} value={m}>
              {GLM_MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <span className="field-hint">
          Standalone CLI config is preferred. Desktop Coding Plan and Start Plan are detected automatically;
          Start Plan performs its official CAPTCHA check before each request.
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
        {checking && 'Checking ZCode…'}
        {!checking && !check && 'Not checked yet.'}
        {!checking && check && !check.installed && `✗ ${check.error ?? 'ZCode not found.'}`}
        {!checking && check && check.installed && (
          <>
            {check.loggedIn ? '✓' : '⚠'} {check.version ? `zcode ${check.version}` : 'zcode'} ·{' '}
            {check.authNote ?? 'ready'}
            {check.path ? <div className="field-hint">{check.path}</div> : null}
          </>
        )}
      </div>

      {!checking && check?.installed && !check.loggedIn && (
        <div className="field-hint">
          Sign in and select a model in ZCode, or configure a standalone Coding Plan with the bundled CLI login.
        </div>
      )}

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void checkGlm()}
        disabled={checking}
      >
        Re-check
      </button>
    </>
  )
}

function OpenRouterSetup(): JSX.Element {
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
        <label className="skill-toggle" title={openRouterEnabled ? 'Disable OpenRouter' : 'Enable OpenRouter'}>
          <input
            type="checkbox"
            checked={openRouterEnabled}
            onChange={(e) => void setOpenRouterEnabled(e.target.checked)}
          />
        </label>
        <span className="field-hint">Enable OpenRouter as a cloud OpenAI-compatible backend.</span>
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
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <span className="field-hint">
        {ready
          ? 'OpenRouter is available in the provider list.'
          : 'Enable it and save an API key to show OpenRouter in the provider list.'}
      </span>
    </div>
  )
}

function OpenRouterPanel(): JSX.Element {
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
        <span className="field-label">Model</span>
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
        <span className="field-hint">Default model: {DEFAULT_LLM_CONFIG.openRouterModel}</span>
      </label>

      <div className={`conn-line ${connection}`}>
        {connection === 'connected' && `OpenRouter connected - ${models.length} model(s) available.`}
        {connection === 'connecting' && 'Connecting to OpenRouter...'}
        {connection === 'error' && `OpenRouter error: ${connectionError ?? 'Connection failed.'}`}
        {connection === 'unknown' && 'Not tested yet.'}
      </div>

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => void refreshModels()}>
        Refresh models
      </button>
    </>
  )
}

export function ConnectionSettings(): JSX.Element | null {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const provider = useApp((s) => s.provider)
  const setProvider = useApp((s) => s.setProvider)
  const lmStudioReachable = useApp((s) => s.lmStudioReachable)
  const openRouterReady = useApp(
    (s) => s.openRouterEnabled && s.openRouterApiKey.trim().length > 0
  )

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Agent backend
          <button className="modal-close" onClick={() => setOpen(false)} title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span className="field-label">Provider</span>
            <select
              className="text-input"
              value={provider}
              onChange={(e) => void setProvider(e.target.value as LlmProvider)}
            >
              {(lmStudioReachable || provider === 'lmstudio') && (
                <option value="lmstudio">LM Studio (local, OpenAI-compatible)</option>
              )}
              {openRouterReady && <option value="openrouter">OpenRouter (cloud, OpenAI-compatible)</option>}
              <option value="codex">Codex CLI (OpenAI's coding agent)</option>
              <option value="claude">Claude Code (Anthropic's coding agent)</option>
              <option value="glm">GLM / ZCode (Zhipu coding agent)</option>
            </select>
          </label>

          {provider === 'openrouter' && <OpenRouterSetup />}

          {provider === 'codex' ? (
            <CodexPanel />
          ) : provider === 'claude' ? (
            <ClaudePanel />
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
