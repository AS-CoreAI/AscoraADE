import { useEffect, useRef, useState, type JSX } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import { useApp } from '@/state/store'
import type { TerminalShellKind } from '@shared/ipc'
import '@xterm/xterm/css/xterm.css'

const C = {
  green: '\x1b[32m',
  muted: '\x1b[90m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
}

function terminalTheme(theme: 'dark' | 'light'): ITheme {
  const dark = theme === 'dark'
  return {
    background: dark ? '#161618' : '#f5f5f6',
    foreground: dark ? '#cfcfd4' : '#2f2f34',
    cursor: dark ? '#3fcf8e' : '#168a5b',
    selectionBackground: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    green: dark ? '#3fcf8e' : '#168a5b',
    brightGreen: dark ? '#62dca5' : '#117249',
    red: dark ? '#f06e6e' : '#c43f3f',
    brightRed: dark ? '#ff8a8a' : '#a92f2f',
    brightBlack: dark ? '#8b8b92' : '#626269'
  }
}

/**
 * One-liner appended after every command so the shell reports its working
 * directory as an OSC 7 escape. xterm parses it via a registered handler, so it
 * is consumed silently and never printed — we just use it to refresh the prompt.
 */
function cwdReportCommand(kind: TerminalShellKind): string {
  return kind === 'powershell'
    ? `[Console]::Out.Write(([char]27).ToString()+']7;'+$PWD.Path+([char]7).ToString())`
    : `printf '\\033]7;%s\\007' "$PWD"`
}

/**
 * Interactive terminal backed by a real shell (see main/ipc/terminal.ts). The
 * shell echoes nothing and prints no prompt; this component handles local echo,
 * basic line editing, and a cwd-aware prompt.
 */
export function TerminalPanel(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const workspacePath = useApp((s) => s.active?.path)
  const resolvedTheme = useApp((s) => s.resolvedTheme)
  const terminalRequest = useApp((s) => s.terminalRequest)
  // Lets the Explorer's "Run" inject a command into this shell (set in the effect).
  const runExternalRef = useRef<((command: string) => void) | null>(null)
  const handledNonceRef = useRef(0)
  // Bumping this restarts the shell (the effect tears down and re-runs).
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      cursorBlink: true,
      convertEol: true,
      theme: terminalTheme(resolvedTheme)
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const id = crypto.randomUUID()
    let kind: TerminalShellKind = 'powershell'
    let cwd = workspacePath ?? ''
    let line = '' // current input being edited
    let running = true // true while a command runs / before the first prompt
    let exited = false
    const pending: string[] = [] // commands queued (e.g. from "Run") until the prompt returns

    const history: string[] = [] // submitted commands, oldest first
    let historyIndex = 0 // cursor into history; === history.length means "new line"
    let draft = '' // unsubmitted input stashed while browsing history

    const showPrompt = (): void => {
      running = false
      line = ''
      term.write(`${C.green}PS${C.reset} ${C.muted}${cwd}${C.reset}> `)
      // Drain one queued command (from "Run"); the next drains when its prompt returns.
      const queued = pending.shift()
      if (queued !== undefined) {
        replaceLine(queued)
        submit()
      }
    }

    // Erase the current input from the screen (prompt untouched) and draw `next`.
    const replaceLine = (next: string): void => {
      term.write('\b \b'.repeat(line.length))
      term.write(next)
      line = next
    }

    const recallPrev = (): void => {
      if (historyIndex === 0) return // empty or already at the oldest entry
      if (historyIndex === history.length) draft = line // entering history: stash draft
      historyIndex -= 1
      replaceLine(history[historyIndex])
    }

    const recallNext = (): void => {
      if (historyIndex >= history.length) return
      historyIndex += 1
      replaceLine(historyIndex === history.length ? draft : history[historyIndex])
    }

    const submit = (): void => {
      const command = line
      // Record non-empty commands, skipping consecutive duplicates (shell-like).
      if (command.trim() && command !== history[history.length - 1]) history.push(command)
      historyIndex = history.length
      draft = ''
      line = ''
      running = true
      term.write('\r\n')
      void api.terminal.input(id, command + '\n')
      // Trailing report runs after the command, even if it failed, so the
      // prompt always returns (its OSC 7 output drives showPrompt).
      void api.terminal.input(id, cwdReportCommand(kind) + '\n')
    }

    // Inject a command from outside (the Explorer's "Run"): run it now if the
    // prompt is idle, otherwise queue it until the running command finishes.
    const runExternal = (command: string): void => {
      if (exited) return
      if (running) {
        pending.push(command)
        return
      }
      replaceLine(command)
      submit()
    }
    runExternalRef.current = runExternal

    // The shell reports cwd via OSC 7; consume it and refresh the prompt.
    term.parser.registerOscHandler(7, (data) => {
      if (data) cwd = data
      if (!exited) queueMicrotask(showPrompt)
      return true
    })

    term.onData((data) => {
      if (exited || running) return
      // Up / Down browse command history (both normal and application modes).
      if (data === '\x1b[A' || data === '\x1bOA') return recallPrev()
      if (data === '\x1b[B' || data === '\x1bOB') return recallNext()
      // Drop other escape sequences (Left/Right, function keys) — no mid-line edit.
      if (data.charCodeAt(0) === 0x1b) return

      for (let i = 0; i < data.length; i += 1) {
        const ch = data[i]
        if (ch === '\r' || ch === '\n') {
          if (ch === '\n' && data[i - 1] === '\r') continue // collapse CRLF
          submit()
          return // remainder (if any) belongs to the next command's prompt
        } else if (ch === '\x7f' || ch === '\b') {
          if (line.length > 0) {
            line = line.slice(0, -1)
            term.write('\b \b')
          }
        } else if (ch === '\x03') {
          // Ctrl+C at the prompt: abandon the current line.
          term.write('^C\r\n')
          historyIndex = history.length
          draft = ''
          showPrompt()
          return
        } else if (ch === '\x0c') {
          term.clear() // Ctrl+L
        } else if (ch >= ' ') {
          line += ch
          term.write(ch)
        }
      }
    })

    const offData = api.terminal.onData(id, (data) => term.write(data))
    const offExit = api.terminal.onExit(id, (code) => {
      exited = true
      running = true
      const suffix = code != null ? ` with code ${code}` : ''
      term.write(`\r\n${C.muted}[process exited${suffix}] — press the restart button${C.reset}\r\n`)
    })

    void (async () => {
      term.writeln(`${C.green}Ascora ADE terminal${C.reset}`)
      const res = await api.terminal.start(id, { cwd: workspacePath })
      if (!res.ok) {
        term.writeln(`${C.red}Failed to start shell: ${res.error ?? 'unknown error'}${C.reset}`)
        exited = true
        return
      }
      kind = res.kind ?? 'powershell'
      cwd = res.cwd ?? workspacePath ?? ''
      term.writeln(`${C.muted}${res.shell}${C.reset}`)
      showPrompt()
    })()

    const resize = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* host detached during teardown */
      }
    })
    resize.observe(host)

    return () => {
      offData()
      offExit()
      resize.disconnect()
      void api.terminal.kill(id)
      term.dispose()
      termRef.current = null
      runExternalRef.current = null
    }
  }, [workspacePath, nonce])

  // Run a file in this shell when the Explorer requests it (PyCharm-style "Run").
  useEffect(() => {
    if (!terminalRequest || terminalRequest.nonce === handledNonceRef.current) return
    handledNonceRef.current = terminalRequest.nonce
    runExternalRef.current?.(terminalRequest.command)
    // Clear so re-mounting the panel (e.g. returning to the workspace view) doesn't replay it.
    useApp.setState((s) =>
      s.terminalRequest?.nonce === terminalRequest.nonce ? { terminalRequest: null } : {}
    )
  }, [terminalRequest])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(resolvedTheme)
  }, [resolvedTheme])

  return (
    <div className="panel">
      <div className="panel-header">
        <Icon name="terminal" size={13} />
        Terminal
        <span className="spacer" />
        <button title="Clear" onClick={() => termRef.current?.clear()}>
          <Icon name="trash" size={14} />
        </button>
        <button title="Restart shell" onClick={() => setNonce((n) => n + 1)}>
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  )
}
