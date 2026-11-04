import { desktopCapturer, globalShortcut, ipcMain, screen, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { IPC } from '@shared/ipc'
import { validateComputerAction, type ComputerFrame, type ComputerResult, type ComputerSupport } from '@shared/computer'
import { LmStudioClient } from '../llm/client'
import { readConfig } from './llm'
import { runWindowsInput } from '../computer/windows'

const STOP_SHORTCUT = 'CommandOrControl+Alt+Escape'
interface Session {
  id: string
  owner: WebContents
  taskId: string
  model: string
  baseUrl: string
  controller: AbortController
  frame?: ComputerFrame
  display?: Electron.Display
  busy: boolean
  foregroundWindow?: string
  cleanup?: () => void
}
let session: Session | undefined

function stopSession(notify = true): void {
  const current = session
  if (!current) return
  session = undefined
  current.controller.abort()
  current.cleanup?.()
  globalShortcut.unregister(STOP_SHORTCUT)
  if (notify && !current.owner.isDestroyed()) current.owner.send(IPC.computer.stopped, current.taskId)
}

async function support(model: string): Promise<ComputerSupport> {
  if (process.platform !== 'win32') return { available: false, reason: 'platform' }
  return new LmStudioClient(readConfig()).computerSupport(model, AbortSignal.timeout(8000))
}

function assertActive(current: Session): void {
  if (session !== current || current.controller.signal.aborted) throw new Error('Computer use stopped.')
  const config = readConfig()
  if (config.provider !== 'lmstudio' || config.model !== current.model || config.baseUrl !== current.baseUrl) {
    stopSession()
    throw new Error('Computer use stopped because the provider, model, or server changed.')
  }
}

async function capture(current: Session): Promise<ComputerFrame> {
  assertActive(current)
  const display = screen.getPrimaryDisplay()
  const foregroundWindow = await runWindowsInput({ action: 'probe' }, current.controller.signal)
  const ratio = Math.min(1, 1280 / display.size.width, 900 / display.size.height)
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
    width: Math.round(display.size.width * ratio), height: Math.round(display.size.height * ratio)
  } })
  assertActive(current)
  const source = sources.find(item => item.display_id === String(display.id))
  if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture the primary display.')
  const size = source.thumbnail.getSize()
  const frame = { id: randomUUID(), width: size.width, height: size.height, image: `data:image/jpeg;base64,${source.thumbnail.toJPEG(80).toString('base64')}` }
  current.frame = frame
  current.display = display
  current.foregroundWindow = foregroundWindow
  return frame
}

export function registerComputerHandlers(): void {
  ipcMain.handle(IPC.computer.check, (_event, model: string) => support(model))
  ipcMain.handle(IPC.computer.start, async (event, taskId: string, model: string): Promise<ComputerResult> => {
    try {
      if (session) throw new Error('Another task is already controlling the computer. Stop it first.')
      const config = readConfig()
      if (!taskId || !model || config.model !== model) throw new Error('Select a model before enabling computer use.')
      const capability = await support(model)
      if (!capability.available) throw new Error(capability.error || 'Computer use requires Windows and an LM Studio model with vision and tool calling.')
      if (session || event.sender.isDestroyed()) throw new Error('Computer use is no longer available.')
      const current: Session = { id: randomUUID(), owner: event.sender, taskId, model, baseUrl: config.baseUrl, controller: new AbortController(), busy: false }
      if (!globalShortcut.register(STOP_SHORTCUT, () => stopSession())) throw new Error('Could not register the computer-use emergency stop shortcut.')
      session = current
      const disconnected = (): void => { if (session === current) stopSession(false) }
      event.sender.once('destroyed', disconnected)
      event.sender.once('render-process-gone', disconnected)
      event.sender.once('did-start-loading', disconnected)
      current.cleanup = () => {
        event.sender.removeListener('destroyed', disconnected)
        event.sender.removeListener('render-process-gone', disconnected)
        event.sender.removeListener('did-start-loading', disconnected)
      }
      assertActive(current)
      return { ok: true, sessionId: current.id }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC.computer.action, async (event, id: string, args: Record<string, unknown>): Promise<ComputerResult> => {
    const current = session
    if (!current || current.id !== id || current.owner !== event.sender) return { ok: false, error: 'Computer use is not enabled for this task.' }
    if (current.busy) return { ok: false, error: 'Wait for the previous computer action to finish.' }
    current.busy = true
    try {
      assertActive(current)
      const action = validateComputerAction(args, current.frame)
      if (action.action !== 'screenshot') {
        const display = screen.getPrimaryDisplay()
        const previous = current.display!
        if (display.id !== previous.id || display.scaleFactor !== previous.scaleFactor || JSON.stringify(display.bounds) !== JSON.stringify(previous.bounds)) {
          current.frame = undefined
          throw new Error('Display layout changed. Take a new screenshot.')
        }
        const point = (x: number, y: number): Electron.Point => screen.dipToScreenPoint({
          x: display.bounds.x + Math.round(x * display.bounds.width / current.frame!.width),
          y: display.bounds.y + Math.round(y * display.bounds.height / current.frame!.height)
        })
        if (action.x !== undefined && action.y !== undefined) {
          const p = point(action.x, action.y); action.x = p.x; action.y = p.y
        }
        if (action.to_x !== undefined && action.to_y !== undefined) {
          const p = point(action.to_x, action.to_y); action.to_x = p.x; action.to_y = p.y
        }
        current.frame = undefined // a failed action may still have changed the screen
        await runWindowsInput(action, current.controller.signal, current.foregroundWindow)
        await delay(250, undefined, { signal: current.controller.signal })
      }
      return { ok: true, frame: await capture(current) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally { current.busy = false }
  })
  ipcMain.handle(IPC.computer.stop, (event, id: string) => {
    if (session?.owner === event.sender && session.id === id) stopSession(false)
  })
}
