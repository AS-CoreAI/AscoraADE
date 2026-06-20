import { app, ipcMain, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  IPC,
  type TerminalDataPayload,
  type TerminalExitPayload,
  type TerminalShellKind,
  type TerminalStartOptions,
  type TerminalStartResult
} from '@shared/ipc'

/**
 * A real interactive shell without a native PTY (node-pty can't compile here —
 * see the build-constraints note). We spawn the platform shell in a mode where
 * it reads commands from a stdin pipe line by line and writes results to stdout
 * — no echo, no prompt. The renderer owns line editing, local echo, and the
 * prompt; it appends a tiny "report cwd" command after each line so the prompt
 * can track `cd`. The trade-off vs a PTY: no full-screen TUIs (vim/top) and no
 * mid-command stdin, but ordinary commands (git, npm, ls, build scripts) work.
 */

interface Session {
  child: ChildProcessWithoutNullStreams
  sender: WebContents
}

interface ShellChoice {
  file: string
  args: string[]
  name: string
  kind: TerminalShellKind
}

const sessions = new Map<string, Session>()

function pickShell(): ShellChoice {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', '-'],
      name: 'powershell.exe',
      kind: 'powershell'
    }
  }
  const file = process.env.SHELL || '/bin/bash'
  return { file, args: [], name: file, kind: 'posix' }
}

function safeCwd(cwd?: string): string {
  if (cwd) {
    try {
      if (statSync(cwd).isDirectory()) return cwd
    } catch {
      /* not a usable directory — fall through to home */
    }
  }
  return homedir()
}

function killTree(child: ChildProcessWithoutNullStreams): void {
  // On Windows kill the whole tree so a running grandchild (npm, git) dies too.
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      return
    } catch {
      /* fall through to plain kill */
    }
  }
  try {
    child.kill()
  } catch {
    /* already gone */
  }
}

function killSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  try {
    session.child.stdin.end()
  } catch {
    /* stdin already closed */
  }
  killTree(session.child)
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(
    IPC.terminal.start,
    (e, id: string, opts: TerminalStartOptions = {}): TerminalStartResult => {
      killSession(id) // replace any previous session bound to this id
      const shell = pickShell()
      const cwd = safeCwd(opts.cwd)
      try {
        const child = spawn(shell.file, shell.args, {
          cwd,
          windowsHide: true,
          env: { ...process.env }
        })
        const sender = e.sender
        sessions.set(id, { child, sender })

        const send = (data: string): void => {
          if (!sender.isDestroyed()) {
            sender.send(IPC.terminal.data, { id, data } satisfies TerminalDataPayload)
          }
        }

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => send(chunk))
        child.stderr.on('data', (chunk: string) => send(chunk))
        child.on('error', (err) => send(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`))
        child.on('exit', (code) => {
          if (sessions.get(id)?.child === child) sessions.delete(id)
          if (!sender.isDestroyed()) {
            sender.send(IPC.terminal.exit, { id, code } satisfies TerminalExitPayload)
          }
        })

        // Make PowerShell emit UTF-8 so non-ASCII output isn't mojibake on the
        // pipe (it defaults to the OEM codepage). Runs silently before any
        // user command, so it produces no visible output.
        if (shell.kind === 'powershell') {
          child.stdin.write(
            '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
              '$OutputEncoding=[System.Text.Encoding]::UTF8\n'
          )
        }

        // If the renderer goes away, don't leak the shell.
        sender.once('destroyed', () => killSession(id))

        return { ok: true, pid: child.pid, shell: shell.name, kind: shell.kind, cwd }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(IPC.terminal.input, (_e, id: string, data: string) => {
    const session = sessions.get(id)
    if (!session) return
    try {
      session.child.stdin.write(data)
    } catch {
      /* stdin closed — shell already exited */
    }
  })

  ipcMain.handle(IPC.terminal.kill, (_e, id: string) => killSession(id))

  app.on('before-quit', () => {
    for (const id of [...sessions.keys()]) killSession(id)
  })
}
