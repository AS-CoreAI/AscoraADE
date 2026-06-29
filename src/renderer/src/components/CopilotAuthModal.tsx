import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'
import { Icon } from './Icon'

const LOGIN_COMMAND = 'copilot login'
const GH_COMMAND = 'gh auth login'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function CopilotAuthModal(): JSX.Element | null {
  const open = useApp((s) => s.copilotAuthOpen)
  const setOpen = useApp((s) => s.setCopilotAuthOpen)
  const check = useApp((s) => s.copilotCheck)
  const checking = useApp((s) => s.copilotChecking)
  const checkCopilot = useApp((s) => s.checkCopilot)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [watchingLogin, setWatchingLogin] = useState(false)
  const checkingRef = useRef(checking)

  useEffect(() => {
    checkingRef.current = checking
  }, [checking])

  const runAuthCheck = useCallback(
    (message?: string): void => {
      if (checkingRef.current) return
      checkingRef.current = true
      if (message) setStatus(message)
      void checkCopilot(true)
    },
    [checkCopilot]
  )

  useEffect(() => {
    if (!open) {
      setWatchingLogin(false)
      setStatus(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || !watchingLogin) return
    if (check?.loggedIn) {
      setWatchingLogin(false)
      setStatus('Copilot is signed in. You can close this dialog.')
      return
    }

    const recheck = (): void => runAuthCheck('Checking Copilot authorization...')
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') recheck()
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', onVisibility)
    const kick = window.setTimeout(recheck, 1500)
    const timer = window.setInterval(recheck, 5000)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearTimeout(kick)
      window.clearInterval(timer)
    }
  }, [check?.loggedIn, open, runAuthCheck, watchingLogin])

  if (!open) return null

  const launchLogin = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await api.copilot.login()
      setStatus(
        result.ok
          ? 'Login terminal opened. Finish the GitHub flow there; Ascora will re-check automatically when you return.'
          : result.error ?? 'Unable to open Copilot login.'
      )
      setWatchingLogin(result.ok)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to open Copilot login.')
    } finally {
      setBusy(false)
    }
  }

  const copyLogin = async (): Promise<void> => {
    const copied = await copyText(LOGIN_COMMAND)
    setStatus(copied ? 'Command copied. Ascora will re-check automatically when you return.' : 'Copy failed.')
    if (copied) setWatchingLogin(true)
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal modal-copilot-auth" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          GitHub Copilot authorization
          <button className="modal-close" onClick={() => setOpen(false)} title="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="auth-callout">
            <Icon name="info" size={15} />
            <span>
              Copilot CLI uses its own credentials. GitHub Desktop or VS Code sign-in may not be
              available to this standalone CLI.
            </span>
          </div>

          <div className="auth-actions">
            <button className="btn btn-icon" onClick={() => void launchLogin()} disabled={busy}>
              <Icon name="terminal" size={14} />
              {busy ? 'Opening...' : 'Open copilot login'}
            </button>
            <button className="btn btn-icon" onClick={() => void copyLogin()}>
              <Icon name="copy" size={14} />
              Copy command
            </button>
            <button className="btn btn-icon" onClick={() => runAuthCheck('Checking Copilot authorization...')} disabled={checking}>
              <Icon name="refresh" size={14} />
              {checking ? 'Checking...' : 'Re-check'}
            </button>
          </div>

          <div className="auth-command-list">
            <div>
              <span>Primary login</span>
              <code>{LOGIN_COMMAND}</code>
            </div>
            <div>
              <span>Alternative via GitHub CLI</span>
              <code>{GH_COMMAND}</code>
            </div>
          </div>

          <div
            className={`conn-line ${
              checking ? 'connecting' : !check ? 'unknown' : check.installed && check.loggedIn ? 'connected' : 'error'
            }`}
          >
            {checking && 'Checking Copilot...'}
            {!checking && !check && 'Not checked yet.'}
            {!checking && check && !check.installed && (check.error ?? 'GitHub Copilot CLI not found.')}
            {!checking && check?.installed && (
              <>
                {check.loggedIn ? 'Signed in' : 'Not signed in'} · {check.version ?? 'copilot'}
                {check.path ? <div className="field-hint">{check.path}</div> : null}
              </>
            )}
          </div>

          {status && <div className="field-hint">{status}</div>}
        </div>
      </div>
    </div>
  )
}
