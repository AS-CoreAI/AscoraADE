import { useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import { DEFAULT_LLM_CONFIG, type CodexSandbox, type LlmProvider } from '@shared/ipc'

const CODEX_MODEL_PRESETS = ['gpt-5-codex', 'gpt-5', 'o4-mini']

const SANDBOX_LABEL: Record<CodexSandbox, string> = {
  'read-only': 'Read-only (no edits or commands)',
  'workspace-write': 'Workspace write (edit this folder, sandboxed)',
  'danger-full-access': 'Full access (no sandbox — dangerous)'
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

export function ConnectionSettings(): JSX.Element | null {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const provider = useApp((s) => s.provider)
  const setProvider = useApp((s) => s.setProvider)

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
              <option value="lmstudio">LM Studio (local, OpenAI-compatible)</option>
              <option value="codex">Codex CLI (OpenAI's coding agent)</option>
            </select>
          </label>

          {provider === 'codex' ? <CodexPanel /> : <LmStudioPanel />}
        </div>
      </div>
    </div>
  )
}
