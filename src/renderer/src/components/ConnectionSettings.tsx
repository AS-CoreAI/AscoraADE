import { useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import { DEFAULT_LLM_CONFIG } from '@shared/ipc'

export function ConnectionSettings(): JSX.Element | null {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const baseUrl = useApp((s) => s.baseUrl)
  const setBaseUrl = useApp((s) => s.setBaseUrl)
  const model = useApp((s) => s.model)
  const models = useApp((s) => s.models)
  const setModel = useApp((s) => s.setModel)
  const connection = useApp((s) => s.connection)
  const connectionError = useApp((s) => s.connectionError)

  const [url, setUrl] = useState(baseUrl)
  const [testing, setTesting] = useState(false)

  if (!open) return null

  const test = async (): Promise<void> => {
    setTesting(true)
    await setBaseUrl(url.trim() || DEFAULT_LLM_CONFIG.baseUrl)
    setTesting(false)
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          LM Studio connection
          <button className="modal-close" onClick={() => setOpen(false)} title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
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
        </div>
      </div>
    </div>
  )
}
