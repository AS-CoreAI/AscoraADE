import { useEffect, useRef, useState, type JSX } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'
import '@xterm/xterm/css/xterm.css'

function terminalTheme(theme: 'dark' | 'light'): ITheme {
  const dark = theme === 'dark'
  return {
    background: dark ? '#161618' : '#f5f5f6',
    foreground: dark ? '#cfcfd4' : '#2f2f34',
    cursor: dark ? '#3fcf8e' : '#168a5b',
    selectionBackground: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  }
}

/**
 * Interactive SSH terminal. The remote provides a real pty, so this is a plain
 * passthrough: keystrokes go straight to the channel and channel output is
 * written verbatim (full-screen TUIs like vim/htop work). The connection's
 * lifetime is tied to this panel — closing it disconnects.
 */
export function SshTerminal({ connId }: { connId: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const conn = useApp((s) => s.sshConnections.find((c) => c.id === connId))
  const resolvedTheme = useApp((s) => s.resolvedTheme)
  const closeSshTerminal = useApp((s) => s.closeSshTerminal)
  const loadSshData = useApp((s) => s.loadSshData)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed'>('connecting')
  // Bumping this reconnects (the effect tears down and re-runs).
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !conn) return

    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      cursorBlink: true,
      theme: terminalTheme(resolvedTheme)
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const copySelection = (): boolean => {
      const selection = term.getSelection()
      if (!selection) return false
      void navigator.clipboard.writeText(selection).catch(() => {})
      return true
    }

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const isCopyShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c'
      if (!isCopyShortcut) return true
      if (copySelection()) {
        event.preventDefault()
        return false
      }
      return !event.shiftKey && !event.metaKey
    })

    const id = connId
    let disposed = false
    setStatus('connecting')
    term.writeln(`\x1b[90mConnecting to ${conn.username}@${conn.host}:${conn.port || 22}…\x1b[0m`)

    const offData = api.ssh.onData(id, (data) => term.write(data))
    const offExit = api.ssh.onExit(id, (code, error) => {
      if (disposed) return
      setStatus('closed')
      if (error) term.write(`\r\n\x1b[31m${error}\x1b[0m`)
      term.write(
        `\r\n\x1b[90m[disconnected${code != null ? ` (code ${code})` : ''}] — press reconnect\x1b[0m\r\n`
      )
    })
    const onInput = term.onData((data) => void api.ssh.input(id, data))

    // Right-click: PuTTY-style. Copy the active selection if there is one,
    // otherwise paste the clipboard straight into the remote channel.
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      if (copySelection()) {
        term.clearSelection()
        return
      }
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) void api.ssh.input(id, text)
        })
        .catch(() => {})
    }
    host.addEventListener('contextmenu', onContextMenu)

    void (async () => {
      const res = await api.ssh.connect(id, conn, { cols: term.cols, rows: term.rows })
      if (disposed) return
      if (!res.ok) {
        setStatus('closed')
        term.write(`\r\n\x1b[31mConnection failed: ${res.error ?? 'unknown error'}\x1b[0m\r\n`)
        return
      }
      setStatus('connected')
      const state = useApp.getState()
      // Main resets every new session to unelevated, so re-apply the UI's root
      // toggle here — otherwise a reconnect silently drops root mode and remote
      // listings (e.g. /root) come back empty while the button still looks "on".
      void api.ssh.setElevation(id, !!state.sshElevated[connId])
      if (
        state.activeSsh === connId &&
        (state.active?.id !== `ssh:${connId}` || state.treeRoots.length === 0)
      ) {
        void loadSshData(connId)
      }
    })()

    const resize = new ResizeObserver(() => {
      try {
        fit.fit()
        void api.ssh.resize(id, term.cols, term.rows)
      } catch {
        /* host detached during teardown */
      }
    })
    resize.observe(host)

    return () => {
      disposed = true
      offData()
      offExit()
      onInput.dispose()
      host.removeEventListener('contextmenu', onContextMenu)
      resize.disconnect()
      void api.ssh.disconnect(id)
      term.dispose()
      termRef.current = null
    }
  }, [connId, conn, nonce, loadSshData])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(resolvedTheme)
  }, [resolvedTheme])

  return (
    <div className="panel ssh-panel">
      <div className="panel-header">
        <Icon name="terminal" size={13} />
        <span className="ssh-title">{conn ? `${conn.username}@${conn.host}` : 'SSH'}</span>
        <span className={`ssh-dot ${status}`} title={status} />
        <span className="spacer" />
        <button title="Reconnect" onClick={() => setNonce((n) => n + 1)}>
          <Icon name="refresh" size={14} />
        </button>
        <button title="Close & disconnect" onClick={() => closeSshTerminal(connId)}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  )
}
