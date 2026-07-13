import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { CopilotLoginResult } from '@shared/ipc'

/**
 * Opens the user's terminal with an interactive CLI login command
 * (`copilot login`, `codex login`, `claude /login`, …). The flows are
 * interactive/browser-based, so they must run in a visible console the user
 * controls; Ascora re-checks the auth state after they return.
 */

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

const RETURN_NOTE = 'After login completes, return to Ascora ADE. It will re-check automatically.'

export function openCliLoginTerminal(
  title: string,
  file: string,
  args: string[]
): CopilotLoginResult {
  try {
    if (process.platform === 'win32') {
      const command =
        `& ${psQuote(file)} ${args.map(psQuote).join(' ')}; ` +
        'Write-Host ""; ' +
        `Write-Host "${RETURN_NOTE}"`
      // Launch through `cmd /c start` so a NEW console window appears. Spawning
      // powershell directly with detached:true sets DETACHED_PROCESS, which gives
      // the child no console at all — the login terminal would never show up.
      // -EncodedCommand (base64 UTF-16LE) sidesteps start's quoting rules.
      const encoded = Buffer.from(command, 'utf16le').toString('base64')
      const child = spawn(
        'cmd.exe',
        [
          '/c',
          'start',
          title,
          'powershell.exe',
          '-NoExit',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encoded
        ],
        {
          cwd: homedir(),
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }
      )
      child.unref()
      return { ok: true }
    }

    const posixCommand = `${shQuote(file)} ${args.map(shQuote).join(' ')}`

    if (process.platform === 'darwin') {
      const command = `${posixCommand}; echo; echo "${RETURN_NOTE}"`
      const child = spawn(
        'osascript',
        ['-e', `tell application "Terminal" to do script ${JSON.stringify(command)}`],
        { detached: true, stdio: 'ignore' }
      )
      child.unref()
      return { ok: true }
    }

    const command = `${posixCommand}; echo; read -r -p "Return to Ascora ADE; it will re-check automatically. Press Enter to close."`
    const terminal = process.env.TERMINAL?.trim()
    const candidates: Array<[string, string[]]> = [
      ['x-terminal-emulator', ['-e', 'sh', '-lc', command]],
      ['gnome-terminal', ['--', 'sh', '-lc', command]],
      ['konsole', ['-e', 'sh', '-lc', command]],
      ['xterm', ['-e', 'sh', '-lc', command]]
    ]
    if (terminal) candidates.unshift([terminal, ['-e', 'sh', '-lc', command]])
    let lastError = ''
    for (const [candidate, candidateArgs] of candidates) {
      try {
        const child = spawn(candidate, candidateArgs, { detached: true, stdio: 'ignore' })
        child.unref()
        return { ok: true }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
    return { ok: false, error: lastError || `Unable to open a terminal for ${title}.` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
