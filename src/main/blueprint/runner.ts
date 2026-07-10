import { BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  IPC,
  WPROVIDER_SERVICES,
  type BlueprintAgent,
  type BlueprintDefinition,
  type BlueprintEvent,
  type BlueprintEventKind,
  type BlueprintRunRequest,
  type BlueprintRunResult,
  type BlueprintRunSummary,
  type BlueprintStep,
  type BlueprintStepRun,
  type LlmMessage,
  type WProviderService
} from '@shared/ipc'
import { getStore } from '../store'
import { abortWProvider, chatWProvider, forgetWProviderSession } from '../wprovider/runner'

const STORE_KEY = 'blueprints'
const MIN_INTERVAL_MINUTES = 1
const MAX_INTERVAL_MINUTES = 14 * 24 * 60
const MAX_REPEAT = 20
const MAX_SHARED_CONTEXT = 24_000
const MAX_WEBHOOK_OUTPUT = 8_000
const REQUEST_TIMEOUT_MS = 30_000

interface ActiveBlueprintRun {
  blueprint: BlueprintDefinition
  run: BlueprintRunSummary
  sender?: WebContents
  stopped: boolean
  currentRequestId: string | null
  requestAbort: AbortController | null
  agentMessages: Map<string, LlmMessage[]>
  stepOutputs: Map<string, string>
  agentOutputs: Map<string, string>
  lastOutput: string
}

class BlueprintStoppedError extends Error {}

const activeRuns = new Map<string, ActiveBlueprintRun>()
const scheduleTimers = new Map<string, NodeJS.Timeout>()
let shuttingDown = false

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function isService(value: unknown): value is WProviderService {
  return typeof value === 'string' && WPROVIDER_SERVICES.includes(value as WProviderService)
}

function normalizeAgent(value: Partial<BlueprintAgent>, index: number): BlueprintAgent {
  return {
    id: text(value.id) || randomUUID(),
    name: text(value.name).trim() || `Agent ${index + 1}`,
    role: text(value.role).trim() || 'Team member',
    instructions: text(value.instructions),
    service: isService(value.service) ? value.service : 'qwen',
    enabled: value.enabled !== false
  }
}

function normalizeStep(value: Partial<BlueprintStep>, index: number): BlueprintStep {
  const type = ['agent', 'telegram', 'delay', 'webhook'].includes(text(value.type))
    ? (value.type as BlueprintStep['type'])
    : 'agent'
  const method = ['POST', 'PUT', 'PATCH'].includes(text(value.webhookMethod).toUpperCase())
    ? (text(value.webhookMethod).toUpperCase() as 'POST' | 'PUT' | 'PATCH')
    : 'POST'
  return {
    id: text(value.id) || randomUUID(),
    name: text(value.name).trim() || `Step ${index + 1}`,
    type,
    repeat: Math.round(numberInRange(value.repeat, 1, 1, MAX_REPEAT)),
    continueOnError: value.continueOnError === true,
    agentId: text(value.agentId),
    prompt: text(value.prompt),
    telegramBotToken: text(value.telegramBotToken),
    telegramChatId: text(value.telegramChatId),
    message: text(value.message),
    delaySeconds: numberInRange(value.delaySeconds, 1, 0, 86_400),
    webhookUrl: text(value.webhookUrl),
    webhookMethod: method,
    webhookHeaders: text(value.webhookHeaders),
    webhookBody: text(value.webhookBody)
  }
}

function normalizeBlueprint(
  value: Partial<BlueprintDefinition>,
  existing?: BlueprintDefinition,
  touch = false
): BlueprintDefinition {
  const now = Date.now()
  const agents = Array.isArray(value.agents)
    ? value.agents.map((agent, index) => normalizeAgent(agent, index))
    : []
  const steps = Array.isArray(value.steps)
    ? value.steps.map((step, index) => normalizeStep(step, index))
    : []
  return {
    id: text(value.id) || existing?.id || randomUUID(),
    name: text(value.name).trim() || 'Untitled Blueprint',
    description: text(value.description),
    agents,
    steps,
    schedule: {
      enabled: value.schedule?.enabled === true,
      intervalMinutes: numberInRange(
        value.schedule?.intervalMinutes,
        60,
        MIN_INTERVAL_MINUTES,
        MAX_INTERVAL_MINUTES
      ),
      input: text(value.schedule?.input)
    },
    createdAt: existing?.createdAt ?? numberInRange(value.createdAt, now, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: touch
      ? now
      : numberInRange(value.updatedAt, existing?.updatedAt ?? now, 0, Number.MAX_SAFE_INTEGER),
    lastRun: existing?.lastRun ?? value.lastRun
  }
}

function readBlueprints(): BlueprintDefinition[] {
  const saved = getStore().getSetting<BlueprintDefinition[]>(STORE_KEY)
  if (!Array.isArray(saved)) return []
  return saved
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeBlueprint(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function writeBlueprints(blueprints: BlueprintDefinition[]): void {
  getStore().setSetting(STORE_KEY, blueprints)
}

function replaceBlueprint(blueprint: BlueprintDefinition): void {
  const all = readBlueprints()
  const index = all.findIndex((item) => item.id === blueprint.id)
  if (index >= 0) all[index] = blueprint
  else all.push(blueprint)
  writeBlueprints(all)
}

function snapshot(run: BlueprintRunSummary): BlueprintRunSummary {
  return structuredClone(run)
}

function emit(
  active: ActiveBlueprintRun,
  kind: BlueprintEventKind,
  stepId?: string,
  delta?: string
): void {
  const event: BlueprintEvent = {
    kind,
    blueprintId: active.blueprint.id,
    runId: active.run.id,
    run: snapshot(active.run),
    stepId,
    delta
  }
  const target =
    active.sender && !active.sender.isDestroyed() ? active.sender : ascoraRendererWebContents()
  if (target && !target.isDestroyed()) target.send(IPC.blueprint.event, event)
}

function persistRun(active: ActiveBlueprintRun): void {
  if (shuttingDown) return
  // Keep the immutable definition snapshot used by this run separate from the
  // latest saved definition. Otherwise a background run could overwrite edits,
  // or recreate a Blueprint that was deleted while it was stopping.
  const latest = readBlueprints().find((item) => item.id === active.blueprint.id)
  if (!latest) return
  replaceBlueprint({ ...latest, updatedAt: Date.now(), lastRun: snapshot(active.run) })
}

function assertRunning(active: ActiveBlueprintRun): void {
  if (active.stopped) throw new BlueprintStoppedError('Blueprint run stopped.')
}

function sharedContext(active: ActiveBlueprintRun): string {
  const completed = active.run.steps
    .filter((step) => step.status === 'completed' && step.output)
    .map((step) => `### ${step.stepName}\n${step.output}`)
    .join('\n\n')
  if (!completed) return ''
  return completed.length > MAX_SHARED_CONTEXT
    ? completed.slice(completed.length - MAX_SHARED_CONTEXT)
    : completed
}

function interpolate(template: string, active: ActiveBlueprintRun): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim()
    if (key === 'input') return active.run.input
    if (key === 'last') return active.lastOutput
    if (key === 'now') return new Date().toISOString()
    if (key.startsWith('steps.')) return active.stepOutputs.get(key.slice(6)) ?? ''
    if (key.startsWith('agents.')) return active.agentOutputs.get(key.slice(7)) ?? ''
    return ''
  })
}

function agentById(active: ActiveBlueprintRun, id: string | undefined): BlueprintAgent {
  const agent = active.blueprint.agents.find((candidate) => candidate.id === id && candidate.enabled)
  if (!agent) throw new Error('The Blueprint step references a missing or disabled agent.')
  return agent
}

async function runAgentStep(
  active: ActiveBlueprintRun,
  step: BlueprintStep,
  stepRun: BlueprintStepRun
): Promise<string> {
  const agent = agentById(active, step.agentId)
  const history = active.agentMessages.get(agent.id) ?? [
    {
      role: 'system',
      content: [
        `You are ${agent.name}, the ${agent.role}, working inside an Ascora Blueprint team.`,
        'Collaborate through the shared results supplied by the orchestrator. Produce a concrete result that another team member can continue from.',
        agent.instructions.trim()
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
  active.agentMessages.set(agent.id, history)

  const requested = interpolate(step.prompt?.trim() || '{{input}}', active)
  const context = sharedContext(active)
  const prompt = context
    ? `${requested}\n\nResults already produced by the Blueprint team:\n\n${context}`
    : requested
  history.push({ role: 'user', content: prompt || 'Continue the Blueprint scenario.' })

  const requestId = `blueprint:${active.run.id}:${stepRun.id}`
  active.currentRequestId = requestId
  const result = await chatWProvider(
    requestId,
    agent.service,
    { sessionKey: `${active.blueprint.id}:${active.run.id}:${agent.id}`, service: agent.service, messages: history },
    active.sender,
    (delta) => {
      if (!active.stopped) emit(active, 'step-delta', step.id, delta)
    }
  )
  active.currentRequestId = null
  assertRunning(active)
  if (result.aborted) throw new BlueprintStoppedError('Blueprint run stopped.')
  if (!result.ok) throw new Error(result.error || `${agent.name} failed to answer.`)
  const output = result.content.trim()
  if (!output) throw new Error(`${agent.name} returned an empty answer.`)
  history.push({ role: 'assistant', content: output })
  active.agentOutputs.set(agent.id, output)
  return output
}

async function cancellableDelay(active: ActiveBlueprintRun, seconds: number): Promise<string> {
  const duration = Math.max(0, seconds) * 1000
  const deadline = Date.now() + duration
  while (Date.now() < deadline) {
    assertRunning(active)
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())))
  }
  return `Waited ${seconds} second${seconds === 1 ? '' : 's'}.`
}

function telegramChunks(message: string): string[] {
  if (!message) return []
  const chunks: string[] = []
  for (let offset = 0; offset < message.length; offset += 4000) {
    chunks.push(message.slice(offset, offset + 4000))
  }
  return chunks
}

async function runTelegramStep(active: ActiveBlueprintRun, step: BlueprintStep): Promise<string> {
  const token = step.telegramBotToken?.trim() ?? ''
  const chatId = interpolate(step.telegramChatId?.trim() ?? '', active)
  const message = interpolate(step.message?.trim() || '{{last}}', active)
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Telegram bot token is missing or invalid.')
  if (!chatId) throw new Error('Telegram chat id is missing.')
  const chunks = telegramChunks(message)
  if (chunks.length === 0) throw new Error('Telegram message is empty.')

  let lastMessageId: number | undefined
  for (const chunk of chunks) {
    assertRunning(active)
    const controller = new AbortController()
    active.requestAbort = controller
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
        signal: controller.signal
      })
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        description?: string
        result?: { message_id?: number }
      }
      if (!response.ok || body.ok !== true) {
        throw new Error(body.description || `Telegram returned HTTP ${response.status}.`)
      }
      lastMessageId = body.result?.message_id
    } finally {
      clearTimeout(timeout)
      active.requestAbort = null
    }
  }
  return `Telegram delivered ${chunks.length} message${chunks.length === 1 ? '' : 's'}${
    lastMessageId ? ` (last id: ${lastMessageId})` : ''
  }.`
}

function webhookHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return { 'content-type': 'application/json' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Webhook headers must be a JSON object.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Webhook headers must be a JSON object.')
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
  )
}

async function runWebhookStep(active: ActiveBlueprintRun, step: BlueprintStep): Promise<string> {
  const renderedUrl = interpolate(step.webhookUrl?.trim() ?? '', active)
  let url: URL
  try {
    url = new URL(renderedUrl)
  } catch {
    throw new Error('Webhook URL is invalid.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Webhook URL must use HTTP or HTTPS.')
  }
  const controller = new AbortController()
  active.requestAbort = controller
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: step.webhookMethod ?? 'POST',
      headers: webhookHeaders(interpolate(step.webhookHeaders ?? '', active)),
      body: interpolate(step.webhookBody?.trim() || '{{last}}', active),
      signal: controller.signal
    })
    const body = (await response.text()).slice(0, MAX_WEBHOOK_OUTPUT)
    if (!response.ok) {
      throw new Error(`Webhook returned HTTP ${response.status}${body ? `: ${body}` : '.'}`)
    }
    return body || `Webhook completed with HTTP ${response.status}.`
  } finally {
    clearTimeout(timeout)
    active.requestAbort = null
  }
}

async function executeStep(
  active: ActiveBlueprintRun,
  step: BlueprintStep,
  stepRun: BlueprintStepRun
): Promise<string> {
  if (step.type === 'agent') return runAgentStep(active, step, stepRun)
  if (step.type === 'telegram') return runTelegramStep(active, step)
  if (step.type === 'delay') return cancellableDelay(active, step.delaySeconds ?? 1)
  return runWebhookStep(active, step)
}

async function executeBlueprint(active: ActiveBlueprintRun): Promise<void> {
  try {
    emit(active, 'run-started')
    for (const step of active.blueprint.steps) {
      const repeat = Math.round(numberInRange(step.repeat, 1, 1, MAX_REPEAT))
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        assertRunning(active)
        const stepRun: BlueprintStepRun = {
          id: randomUUID(),
          stepId: step.id,
          stepName: step.name,
          type: step.type,
          attempt,
          status: 'running',
          startedAt: Date.now()
        }
        active.run.steps.push(stepRun)
        emit(active, 'step-started', step.id)
        try {
          const output = await executeStep(active, step, stepRun)
          assertRunning(active)
          stepRun.status = 'completed'
          stepRun.output = output
          stepRun.finishedAt = Date.now()
          active.lastOutput = output
          active.stepOutputs.set(step.id, output)
          persistRun(active)
          emit(active, 'step-completed', step.id)
        } catch (error) {
          if (error instanceof BlueprintStoppedError || active.stopped) throw error
          stepRun.status = 'failed'
          stepRun.error = error instanceof Error ? error.message : String(error)
          stepRun.finishedAt = Date.now()
          persistRun(active)
          emit(active, 'step-failed', step.id)
          if (!step.continueOnError) throw error
        }
      }
    }
    active.run.status = 'completed'
    active.run.finishedAt = Date.now()
    persistRun(active)
    emit(active, 'run-completed')
  } catch (error) {
    active.run.finishedAt = Date.now()
    if (error instanceof BlueprintStoppedError || active.stopped) {
      const interruptedStep = active.run.steps.findLast((step) => step.status === 'running')
      if (interruptedStep) {
        interruptedStep.status = 'skipped'
        interruptedStep.finishedAt = Date.now()
        interruptedStep.error = 'Stopped by the user.'
      }
      active.run.status = 'stopped'
      active.run.error = 'Stopped by the user.'
      persistRun(active)
      emit(active, 'run-stopped')
    } else {
      active.run.status = 'failed'
      active.run.error = error instanceof Error ? error.message : String(error)
      persistRun(active)
      emit(active, 'run-failed')
    }
  } finally {
    active.currentRequestId = null
    active.requestAbort = null
    for (const agent of active.blueprint.agents) {
      forgetWProviderSession(
        agent.service,
        `${active.blueprint.id}:${active.run.id}:${agent.id}`
      )
    }
    activeRuns.delete(active.blueprint.id)
  }
}

function findBlueprint(id: string): BlueprintDefinition | undefined {
  return readBlueprints().find((blueprint) => blueprint.id === id)
}

function runBlueprint(
  request: BlueprintRunRequest,
  sender?: WebContents,
  trigger: BlueprintRunSummary['trigger'] = 'manual'
): BlueprintRunResult {
  const blueprint = findBlueprint(request.blueprintId)
  if (!blueprint) return { ok: false, error: 'Blueprint not found.' }
  if (activeRuns.has(blueprint.id)) return { ok: false, error: 'This Blueprint is already running.' }
  if (blueprint.steps.length === 0) return { ok: false, error: 'Add at least one step before running.' }

  const run: BlueprintRunSummary = {
    id: randomUUID(),
    blueprintId: blueprint.id,
    trigger,
    input: text(request.input),
    status: 'running',
    startedAt: Date.now(),
    steps: []
  }
  const active: ActiveBlueprintRun = {
    blueprint,
    run,
    sender,
    stopped: false,
    currentRequestId: null,
    requestAbort: null,
    agentMessages: new Map(),
    stepOutputs: new Map(),
    agentOutputs: new Map(),
    lastOutput: ''
  }
  activeRuns.set(blueprint.id, active)
  persistRun(active)
  void executeBlueprint(active)
  return { ok: true, runId: run.id }
}

function ascoraRendererWebContents(): WebContents | undefined {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return BrowserWindow.getAllWindows().find((win) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return false
    const url = win.webContents.getURL()
    return devUrl ? url.startsWith(devUrl) : /\/renderer\/index\.html(?:[?#]|$)/i.test(url)
  })?.webContents
}

function scheduledSender(): WebContents | undefined {
  return ascoraRendererWebContents()
}

function reschedule(blueprint: BlueprintDefinition): void {
  const current = scheduleTimers.get(blueprint.id)
  if (current) clearInterval(current)
  scheduleTimers.delete(blueprint.id)
  if (!blueprint.schedule.enabled) return

  const intervalMinutes = numberInRange(
    blueprint.schedule.intervalMinutes,
    60,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES
  )
  const timer = setInterval(() => {
    if (activeRuns.has(blueprint.id)) return
    runBlueprint(
      { blueprintId: blueprint.id, input: blueprint.schedule.input ?? '' },
      scheduledSender(),
      'schedule'
    )
  }, intervalMinutes * 60_000)
  timer.unref?.()
  scheduleTimers.set(blueprint.id, timer)
}

export function listBlueprints(): BlueprintDefinition[] {
  return readBlueprints()
}

export function saveBlueprint(value: BlueprintDefinition): BlueprintDefinition {
  const existing = findBlueprint(value.id)
  const blueprint = normalizeBlueprint(value, existing, true)
  replaceBlueprint(blueprint)
  reschedule(blueprint)
  return blueprint
}

export function removeBlueprint(id: string): boolean {
  stopBlueprint(id)
  const timer = scheduleTimers.get(id)
  if (timer) clearInterval(timer)
  scheduleTimers.delete(id)
  const all = readBlueprints()
  const next = all.filter((blueprint) => blueprint.id !== id)
  if (next.length === all.length) return false
  writeBlueprints(next)
  return true
}

export function startBlueprint(
  request: BlueprintRunRequest,
  sender: WebContents
): BlueprintRunResult {
  return runBlueprint(request, sender)
}

export function stopBlueprint(id: string): boolean {
  const active = activeRuns.get(id) ?? [...activeRuns.values()].find((item) => item.run.id === id)
  if (!active) return false
  active.stopped = true
  active.requestAbort?.abort()
  if (active.currentRequestId) abortWProvider(active.currentRequestId)
  return true
}

export function restoreBlueprintSchedules(): void {
  const now = Date.now()
  let changed = false
  const blueprints = readBlueprints().map((blueprint) => {
    if (blueprint.lastRun?.status !== 'running') return blueprint
    changed = true
    return {
      ...blueprint,
      lastRun: {
        ...blueprint.lastRun,
        status: 'stopped' as const,
        finishedAt: now,
        error: 'Interrupted when Ascora ADE stopped.'
      }
    }
  })
  if (changed) writeBlueprints(blueprints)
  for (const blueprint of blueprints) reschedule(blueprint)
}

export function stopAllBlueprints(): void {
  shuttingDown = true
  for (const id of activeRuns.keys()) stopBlueprint(id)
  for (const timer of scheduleTimers.values()) clearInterval(timer)
  scheduleTimers.clear()
}
