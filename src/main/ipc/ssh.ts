import { app, ipcMain, dialog, BrowserWindow, type WebContents } from 'electron'
import { Client, type ClientChannel } from 'ssh2'
import { readFile } from 'node:fs/promises'
import {
  IPC,
  type SshConnection,
  type SshConnectResult,
  type SshDataPayload,
  type SshExecResult,
  type SshExitPayload,
  type SshSize
} from '@shared/ipc'

/**
 * SSH terminals. Each session is an `ssh2` Client plus an interactive shell
 * channel (a real remote pty, so full-screen TUIs work — unlike the local
 * pty-less terminal). Shell I/O is streamed to the renderer's xterm; `exec`
 * runs a one-shot command over the same connection so the agent's run_command
 * can target the remote host when a session is active.
 */

interface SshSession {
  client: Client
  stream?: ClientChannel
  sender: WebContents
  ready: boolean
  /** When true, exec commands are wrapped in sudo so they run as root. */
  elevated: boolean
  /** Login password, reused to answer sudo's prompt over stdin when elevated. */
  password?: string
}

const sessions = new Map<string, SshSession>()

function send(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

/** Single-quote a value for safe interpolation into a POSIX shell command. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function closeSession(
  id: string,
  code: number | null = null,
  error?: string,
  expected?: SshSession,
  notify = true
): void {
  const session = sessions.get(id)
  // Async reads and ssh2 events from a replaced connection can arrive after a
  // new connection has claimed the same id. Never let the stale connection
  // close the current one.
  if (!session || (expected && session !== expected)) return
  sessions.delete(id)
  try {
    session.stream?.end()
  } catch {
    /* already closed */
  }
  try {
    session.client.end()
  } catch {
    /* already closed */
  }
  if (notify) {
    send(session.sender, IPC.ssh.exit, { id, code, error } satisfies SshExitPayload)
  }
}

function connect(
  sender: WebContents,
  id: string,
  config: SshConnection,
  size?: SshSize
): Promise<SshConnectResult> {
  // Replacing a connection is intentional and must not surface as a remote
  // disconnect in the terminal that is about to own this id.
  closeSession(id, null, undefined, undefined, false)
  return new Promise((resolve) => {
    const client = new Client()
    const session: SshSession = {
      client,
      sender,
      ready: false,
      elevated: false,
      password: config.password
    }
    sessions.set(id, session)

    let settled = false
    const settle = (result: SshConnectResult): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    const isCurrent = (): boolean => sessions.get(id) === session
    const settleSuperseded = (): void => {
      settle({ ok: false, error: 'SSH connection attempt was superseded.' })
    }

    client.on('ready', () => {
      if (!isCurrent()) {
        client.end()
        settleSuperseded()
        return
      }
      session.ready = true
      client.shell(
        { term: 'xterm-256color', cols: size?.cols ?? 80, rows: size?.rows ?? 24 },
        (err, stream) => {
          if (!isCurrent()) {
            stream?.end()
            settleSuperseded()
            return
          }
          if (err) {
            settle({ ok: false, error: err.message })
            closeSession(id, null, err.message, session)
            return
          }
          session.stream = stream
          const forward = (chunk: Buffer): void =>
            send(sender, IPC.ssh.data, { id, data: chunk.toString('utf8') } satisfies SshDataPayload)
          stream.on('data', forward)
          stream.stderr.on('data', forward)
          stream.on('close', () => closeSession(id, 0, undefined, session))
          settle({ ok: true })
        }
      )
    })
    // Password hosts often require keyboard-interactive; answer every prompt
    // with the stored password.
    client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) =>
      finish(prompts.map(() => config.password ?? ''))
    )
    client.on('error', (err) => {
      settle({ ok: false, error: err.message })
      closeSession(id, null, err.message, session)
    })
    client.on('close', () => {
      settle({ ok: false, error: 'SSH connection closed before becoming ready.' })
      closeSession(id, 0, undefined, session)
    })

    void (async () => {
      try {
        const options: Parameters<Client['connect']>[0] = {
          host: config.host,
          port: config.port || 22,
          username: config.username,
          readyTimeout: 20_000,
          keepaliveInterval: 15_000
        }
        if (config.authType === 'key') {
          if (!config.keyPath) throw new Error('No private-key file selected.')
          options.privateKey = await readFile(config.keyPath)
          if (config.passphrase) options.passphrase = config.passphrase
        } else {
          options.password = config.password ?? ''
          options.tryKeyboard = true
        }
        if (!isCurrent()) {
          settleSuperseded()
          return
        }
        client.connect(options)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        settle({ ok: false, error: message })
        closeSession(id, null, message, session)
      }
    })()

    sender.once('destroyed', () => closeSession(id, null, undefined, session, false))
  })
}

function execCommand(id: string, command: string): Promise<SshExecResult> {
  const session = sessions.get(id)
  if (!session || !session.ready) {
    return Promise.resolve({ ok: false, error: 'SSH session is not connected.' })
  }
  // When elevated, run as root via sudo: `-S` takes the password from stdin
  // (fed below), `-p ''` silences the prompt, and `sh -c` gives the wrapped
  // command its own shell so pipes/redirections still behave.
  const elevated = session.elevated
  const finalCommand = elevated ? `sudo -S -p '' -- sh -c ${shq(command)}` : command
  return new Promise((resolve) => {
    session.client.exec(finalCommand, (err, stream) => {
      if (err) {
        resolve({ ok: false, error: err.message })
        return
      }
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      stream.on('close', (code: number | null) => {
        resolve({ ok: true, stdout, stderr, code: typeof code === 'number' ? code : null })
      })
      // Answer sudo's password prompt; harmless (consumed as stdin) when sudo is
      // passwordless. Our exec commands never read their own stdin.
      if (elevated) stream.write(`${session.password ?? ''}\n`)
    })
  })
}

/**
 * Run a command by typing it into the interactive shell (so it appears in the
 * user's visible console and executes on the remote host), then capture its
 * output. We append a sentinel `printf` that prints a unique marker + the exit
 * code; output is everything between the echoed command line and that marker.
 * Assumes a POSIX remote shell (the common case for SSH servers).
 */
function runInShell(id: string, command: string): Promise<SshExecResult> {
  const session = sessions.get(id)
  if (!session || !session.ready || !session.stream) {
    return Promise.resolve({ ok: false, error: 'SSH session is not connected.' })
  }
  const stream = session.stream
  return new Promise((resolve) => {
    const tag = Math.random().toString(36).slice(2, 10)
    // Match the marker only when followed by digits — the echoed printf line
    // contains `…:%s`, the real output line contains `…:<code>`.
    const re = new RegExp(`__ASC_${tag}:(-?\\d+)`)
    let buffer = ''
    let done = false
    const finish = (result: SshExecResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      stream.removeListener('data', onData)
      resolve(result)
    }
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const match = re.exec(buffer)
      if (!match) return
      let out = buffer.slice(0, match.index)
      const firstNl = out.indexOf('\n') // drop the echoed command line
      if (firstNl !== -1) out = out.slice(firstNl + 1)
      finish({ ok: true, stdout: out.replace(/[\r\n]+$/, ''), stderr: '', code: parseInt(match[1], 10) })
    }
    const timer = setTimeout(
      () => finish({ ok: true, stdout: buffer, stderr: '', code: null }),
      120_000
    )
    stream.on('data', onData)
    stream.write(`${command}; printf '\\n__ASC_${tag}:%s\\n' "$?"\n`)
  })
}

export function registerSshHandlers(): void {
  ipcMain.handle(
    IPC.ssh.connect,
    (e, id: string, config: SshConnection, size?: SshSize): Promise<SshConnectResult> =>
      connect(e.sender, id, config, size)
  )
  ipcMain.handle(IPC.ssh.input, (_e, id: string, data: string) => {
    try {
      sessions.get(id)?.stream?.write(data)
    } catch {
      /* stream closed */
    }
  })
  ipcMain.handle(IPC.ssh.resize, (_e, id: string, cols: number, rows: number) => {
    try {
      sessions.get(id)?.stream?.setWindow(rows, cols, 0, 0)
    } catch {
      /* stream closed */
    }
  })
  ipcMain.handle(IPC.ssh.disconnect, (_e, id: string) =>
    closeSession(id, 0, undefined, undefined, false)
  )
  ipcMain.handle(
    IPC.ssh.exec,
    (_e, id: string, command: string): Promise<SshExecResult> => execCommand(id, command)
  )
  ipcMain.handle(
    IPC.ssh.run,
    (_e, id: string, command: string): Promise<SshExecResult> => runInShell(id, command)
  )
  ipcMain.handle(IPC.ssh.setElevation, (_e, id: string, enabled: boolean) => {
    const session = sessions.get(id)
    if (session) session.elevated = enabled
  })
  ipcMain.handle(IPC.ssh.pickKey, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select a private key (PEM)',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'Private keys', extensions: ['pem', 'key', 'ppk', 'rsa', 'id_rsa', 'id_ed25519'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  app.on('before-quit', () => {
    for (const id of [...sessions.keys()]) closeSession(id, null, undefined, undefined, false)
  })
}
