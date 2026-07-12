import { BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import {
  BLUEPRINT_START_NODE_ID,
  IPC,
  WPROVIDER_SERVICES,
  type BlueprintAgent,
  type BlueprintConnection,
  type BlueprintDefinition,
  type BlueprintEvent,
  type BlueprintEventKind,
  type BlueprintRunRequest,
  type BlueprintRunResult,
  type BlueprintRunSummary,
  type BlueprintStep,
  type BlueprintStepRun,
  type BlueprintToolRun,
  type LlmMessage,
  type WProviderService
} from '@shared/ipc'
import { getStore } from '../store'
import { readAgentFile, runAgentCommand, writeAgentFile } from '../ipc/agent'
import { abortWProvider, chatWProvider, forgetWProviderSession } from '../wprovider/runner'
import {
  compileBlueprint,
  matchingBlueprintConnections,
  normalizeBlueprintGraph,
  type BlueprintRouteResult,
  type CompiledBlueprint,
  type CompiledBlueprintExecution,
  type CompiledBlueprintGraph
} from './graph'
import {
  blueprintAgentModePrompt,
  executeBlueprintTool,
  hasBlueprintToolCallIntent,
  parseBlueprintToolCall,
  type BlueprintToolCall
} from './tools'

const STORE_KEY = 'blueprints'
const MIN_INTERVAL_MINUTES = 1
const MAX_INTERVAL_MINUTES = 14 * 24 * 60
const MAX_REPEAT = 20
const MAX_SHARED_CONTEXT = 24_000
const MAX_WEBHOOK_OUTPUT = 8_000
const MAX_COMMAND_OUTPUT = 16_000
const HTTP_STEP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const BODYLESS_HTTP_METHODS = new Set(['GET', 'DELETE'])
const REQUEST_TIMEOUT_MS = 30_000
const MAX_AGENT_TURNS = 16
const MAX_TOOL_AUDIT_ARG = 2_000
const MAX_TOOL_AUDIT_OUTPUT = 8_000

interface ActiveBlueprintRun {
  blueprint: BlueprintDefinition
  executions: CompiledBlueprintExecution[]
  executionGraph: CompiledBlueprintGraph | null
  graphAncestors: Map<string, Set<string>> | null
  graphPredecessors: Map<string, string[]> | null
  run: BlueprintRunSummary
  sender?: WebContents
  stopped: boolean
  currentRequestId: string | null
  requestAbort: AbortController | null
  agentMessages: Map<string, LlmMessage[]>
  stepOutputs: Map<string, string>
  agentOutputs: Map<string, string>
  routeResults: Map<string, BlueprintRouteResult>
  latestRouteResults: Map<string, BlueprintRouteResult>
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

function cappedText(value: string, max: number): string {
  return value.length > max
    ? `${value.slice(0, max)}\n…(${value.length - max} more chars truncated)`
    : value
}

function toolAuditArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value === 'string') return [key, cappedText(value, MAX_TOOL_AUDIT_ARG)]
      if (value == null || typeof value === 'number' || typeof value === 'boolean') return [key, value]
      try {
        return [key, cappedText(JSON.stringify(value), MAX_TOOL_AUDIT_ARG)]
      } catch {
        return [key, '[unserializable value]']
      }
    })
  )
}

function startToolAudit(stepRun: BlueprintStepRun, call: BlueprintToolCall): BlueprintToolRun {
  const audit: BlueprintToolRun = {
    id: randomUUID(),
    tool: call.name,
    args: toolAuditArgs(call.args),
    status: 'running',
    startedAt: Date.now()
  }
  const tools = stepRun.tools ?? []
  tools.push(audit)
  stepRun.tools = tools
  return audit
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
  const type = ['agent', 'telegram', 'delay', 'webhook', 'file', 'shell', 'http'].includes(
    text(value.type)
  )
    ? (value.type as BlueprintStep['type'])
    : 'agent'
  const method = ['POST', 'PUT', 'PATCH'].includes(text(value.webhookMethod).toUpperCase())
    ? (text(value.webhookMethod).toUpperCase() as 'POST' | 'PUT' | 'PATCH')
    : 'POST'
  const httpMethod = HTTP_STEP_METHODS.includes(
    text(value.httpMethod).toUpperCase() as (typeof HTTP_STEP_METHODS)[number]
  )
    ? (text(value.httpMethod).toUpperCase() as BlueprintStep['httpMethod'])
    : 'GET'
  return {
    id: text(value.id) || randomUUID(),
    name: text(value.name).trim() || `Step ${index + 1}`,
    type,
    repeat: Math.round(numberInRange(value.repeat, 1, 1, MAX_REPEAT)),
    continueOnError: value.continueOnError === true,
    agentId: text(value.agentId),
    prompt: text(value.prompt),
    agentMode: value.agentMode === true,
    telegramBotToken: text(value.telegramBotToken),
    telegramChatId: text(value.telegramChatId),
    message: text(value.message),
    delaySeconds: numberInRange(value.delaySeconds, 1, 0, 86_400),
    webhookUrl: text(value.webhookUrl),
    webhookMethod: method,
    webhookHeaders: text(value.webhookHeaders),
    webhookBody: text(value.webhookBody),
    fileMode: value.fileMode === 'write' ? 'write' : 'read',
    filePath: text(value.filePath),
    fileContent: text(value.fileContent),
    command: text(value.command),
    httpUrl: text(value.httpUrl),
    httpMethod,
    httpHeaders: text(value.httpHeaders),
    httpBody: text(value.httpBody)
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
  const graph = normalizeBlueprintGraph(value.graph, steps)
  return {
    id: text(value.id) || existing?.id || randomUUID(),
    name: text(value.name).trim() || 'Untitled Blueprint',
    description: text(value.description),
    agentMode: value.agentMode === true,
    workspaceId: text(value.workspaceId).trim() || undefined,
    agents,
    steps,
    graph,
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

function sharedContext(active: ActiveBlueprintRun, stepId: string): string {
  const ancestors = active.graphAncestors?.get(stepId)
  const completed = active.run.steps
    .filter(
      (step) =>
        ((step.status === 'completed' && step.output) ||
          (active.executionGraph &&
            step.status === 'failed' &&
            step.error &&
            active.stepOutputs.get(step.stepId) === step.error)) &&
        (!active.graphAncestors || step.stepId === stepId || ancestors?.has(step.stepId))
    )
    .map((step) =>
      step.status === 'failed'
        ? `### ${step.stepName} (error)\n${step.error}`
        : `### ${step.stepName}\n${step.output}`
    )
    .join('\n\n')
  if (!completed) return ''
  return completed.length > MAX_SHARED_CONTEXT
    ? completed.slice(completed.length - MAX_SHARED_CONTEXT)
    : completed
}

function lastOutputForStep(active: ActiveBlueprintRun, stepId: string | undefined): string {
  if (!active.graphPredecessors || !stepId) return active.lastOutput
  const candidates = new Set([stepId, ...(active.graphPredecessors.get(stepId) ?? [])])
  return (
    active.run.steps.findLast(
      (step) =>
        candidates.has(step.stepId) &&
        ((step.status === 'completed' && !!step.output) ||
          (active.executionGraph &&
            step.status === 'failed' &&
            !!step.error &&
            active.stepOutputs.get(step.stepId) === step.error))
    )?.output ??
    active.run.steps.findLast(
      (step) =>
        !!active.executionGraph &&
        step.status === 'failed' &&
        !!step.error &&
        active.stepOutputs.get(step.stepId) === step.error &&
        candidates.has(step.stepId)
    )?.error ??
    ''
  )
}

function interpolate(template: string, active: ActiveBlueprintRun, stepId?: string): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim()
    if (key === 'input') return active.run.input
    if (key === 'last') return lastOutputForStep(active, stepId)
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
  const agentMode = active.blueprint.agentMode || step.agentMode === true
  const workspace = active.blueprint.workspaceId
    ? getStore().listWorkspaces().find((candidate) => candidate.id === active.blueprint.workspaceId)
    : undefined
  if (agentMode && active.blueprint.workspaceId && !workspace) {
    throw new Error(
      'The project selected for Agent mode is no longer available. ' +
      'Choose another project or Web tools only, then save the Blueprint.'
    )
  }
  if (agentMode && workspace) {
    const workspaceInfo = await stat(workspace.path).catch(() => null)
    if (!workspaceInfo?.isDirectory()) {
      throw new Error(
        `The Agent mode project folder for "${workspace.name}" is unavailable. ` +
        'Restore the folder or choose another project.'
      )
    }
  }
  const conversationKey = `${agent.id}:${agentMode ? 'agent' : 'plain'}`
  const history = active.agentMessages.get(conversationKey) ?? [
    {
      role: 'system',
      content: [
        `You are ${agent.name}, the ${agent.role}, working inside an Ascora Blueprint team.`,
        'Collaborate through the shared results supplied by the orchestrator. Produce a concrete result that another team member can continue from.',
        agent.instructions.trim(),
        agentMode ? blueprintAgentModePrompt(workspace) : ''
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  ]
  active.agentMessages.set(conversationKey, history)

  const requested = interpolate(step.prompt?.trim() || '{{input}}', active, step.id)
  const context = sharedContext(active, step.id)
  const prompt = context
    ? `${requested}\n\nResults already produced by the Blueprint team:\n\n${context}`
    : requested
  history.push({ role: 'user', content: prompt || 'Continue the Blueprint scenario.' })

  const sessionKey = `${active.blueprint.id}:${active.run.id}:${conversationKey}`
  const turnLimit = agentMode ? MAX_AGENT_TURNS : 1

  for (let turn = 0; turn < turnLimit; turn += 1) {
    assertRunning(active)
    const requestId = `blueprint:${active.run.id}:${stepRun.id}:${turn}`
    active.currentRequestId = requestId
    const result = await chatWProvider(
      requestId,
      agent.service,
      { sessionKey, service: agent.service, messages: history },
      active.sender,
      (delta) => {
        // In agent mode buffer each model turn until we know whether it is a
        // tool request, so raw fenced JSON never leaks into the execution log.
        if (!active.stopped && !agentMode) {
          emit(active, 'step-delta', step.id, delta)
        }
      }
    ).finally(() => {
      if (active.currentRequestId === requestId) active.currentRequestId = null
    })
    assertRunning(active)
    if (result.aborted) throw new BlueprintStoppedError('Blueprint run stopped.')
    if (!result.ok) throw new Error(result.error || `${agent.name} failed to answer.`)

    const output = result.content.trim()
    if (!output) throw new Error(`${agent.name} returned an empty answer.`)
    history.push({ role: 'assistant', content: output })

    const parsed = agentMode ? parseBlueprintToolCall(output) : null
    if (!parsed) {
      if (agentMode && hasBlueprintToolCallIntent(output)) {
        const now = Date.now()
        const tools = stepRun.tools ?? []
        tools.push({
          id: randomUUID(),
          tool: 'invalid tool_call',
          args: { response: cappedText(output, MAX_TOOL_AUDIT_ARG) },
          status: 'failed',
          startedAt: now,
          finishedAt: now,
          error: 'Unsupported tool name or malformed JSON.'
        })
        stepRun.tools = tools
        persistRun(active)
        emit(active, 'step-delta', step.id, '[invalid tool_call]\n')
        history.push({
          role: 'user',
          content:
            'Tool request error: the tool name is unsupported or its JSON is malformed. ' +
            'Retry with exactly one valid fenced ```tool_call block and no surrounding prose.'
        })
        continue
      }
      if (agentMode) emit(active, 'step-delta', step.id, output)
      active.agentOutputs.set(agent.id, output)
      return output
    }

    if (turn === turnLimit - 1) {
      const error = `${agent.name} reached the ${MAX_AGENT_TURNS}-turn agent limit before the requested tool could run.`
      const audit = startToolAudit(stepRun, parsed.call)
      audit.status = 'failed'
      audit.finishedAt = Date.now()
      audit.error = error
      persistRun(active)
      throw new Error(error)
    }

    const audit = startToolAudit(stepRun, parsed.call)
    persistRun(active)
    emit(active, 'step-delta', step.id, `[${parsed.call.name}]\n`)
    try {
      const toolController = new AbortController()
      active.requestAbort = toolController
      const toolResult = await executeBlueprintTool(
        parsed.call,
        workspace?.path,
        toolController.signal
      ).finally(() => {
        if (active.requestAbort === toolController) active.requestAbort = null
      })
      assertRunning(active)
      audit.status = toolResult.startsWith('Error:') ? 'failed' : 'completed'
      audit.finishedAt = Date.now()
      if (audit.status === 'failed') audit.error = cappedText(toolResult, MAX_TOOL_AUDIT_OUTPUT)
      else audit.output = cappedText(toolResult, MAX_TOOL_AUDIT_OUTPUT)
      persistRun(active)
      emit(active, 'step-delta', step.id, `[${parsed.call.name}: ${audit.status}]\n`)
      history.push({
        role: 'user',
        content: `Tool result (${parsed.call.name}):\n${toolResult}`
      })
    } catch (error) {
      audit.status = active.stopped ? 'stopped' : 'failed'
      audit.finishedAt = Date.now()
      audit.error = cappedText(error instanceof Error ? error.message : String(error), MAX_TOOL_AUDIT_OUTPUT)
      persistRun(active)
      throw error
    }
  }

  throw new Error(`${agent.name} reached the ${MAX_AGENT_TURNS}-turn agent limit without a final answer.`)
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
  const chatId = interpolate(step.telegramChatId?.trim() ?? '', active, step.id)
  const message = interpolate(step.message?.trim() || '{{last}}', active, step.id)
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

function parseJsonHeaders(raw: string | undefined, label: string): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${label} headers must be a JSON object.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} headers must be a JSON object.`)
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
  )
}

function webhookHeaders(raw: string | undefined): Record<string, string> {
  return parseJsonHeaders(raw, 'Webhook') ?? { 'content-type': 'application/json' }
}

async function runWebhookStep(active: ActiveBlueprintRun, step: BlueprintStep): Promise<string> {
  const renderedUrl = interpolate(step.webhookUrl?.trim() ?? '', active, step.id)
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
      headers: webhookHeaders(interpolate(step.webhookHeaders ?? '', active, step.id)),
      body: interpolate(step.webhookBody?.trim() || '{{last}}', active, step.id),
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

/** Resolve the Blueprint project folder required by file and shell actions. */
async function requireWorkspacePath(active: ActiveBlueprintRun): Promise<string> {
  const workspace = active.blueprint.workspaceId
    ? getStore().listWorkspaces().find((candidate) => candidate.id === active.blueprint.workspaceId)
    : undefined
  if (!workspace) {
    throw new Error(
      'File and command actions need a project. ' +
      'Choose one in the Agent mode card, then save the Blueprint.'
    )
  }
  const info = await stat(workspace.path).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error(
      `The project folder for "${workspace.name}" is unavailable. ` +
      'Restore the folder or choose another project.'
    )
  }
  return workspace.path
}

async function runFileStep(active: ActiveBlueprintRun, step: BlueprintStep): Promise<string> {
  const root = await requireWorkspacePath(active)
  const path = interpolate(step.filePath?.trim() ?? '', active, step.id)
  if (!path) throw new Error('File path is missing.')
  if (step.fileMode === 'write') {
    const template = step.fileContent?.trim() ? step.fileContent : '{{last}}'
    const result = await writeAgentFile(root, path, interpolate(template, active, step.id))
    if (!result.ok) throw new Error(result.error || 'Failed to write the file.')
    return `${result.created ? 'Created' : 'Updated'} ${result.path} (${result.bytes} bytes).`
  }
  const result = await readAgentFile(root, path)
  if (!result.ok) throw new Error(result.error || 'Failed to read the file.')
  if (result.truncated) throw new Error(`${result.path} is binary or too large to read.`)
  return result.content ?? ''
}

async function runShellStep(active: ActiveBlueprintRun, step: BlueprintStep): Promise<string> {
  const root = await requireWorkspacePath(active)
  const command = interpolate(step.command?.trim() ?? '', active, step.id)
  if (!command) throw new Error('Command is empty.')
  const controller = new AbortController()
  active.requestAbort = controller
  try {
    const result = await runAgentCommand(root, command, controller.signal)
    if (!result.ok) throw new Error(result.error || 'The command failed to start.')
    const stdout = result.stdout?.trim() ?? ''
    const stderr = result.stderr?.trim() ?? ''
    if (result.timedOut || result.code !== 0) {
      const head = result.timedOut
        ? 'The command was killed by the timeout.'
        : `The command exited with code ${result.code}.`
      const detail = [stderr, stdout].filter(Boolean).join('\n')
      throw new Error(cappedText(detail ? `${head}\n${detail}` : head, MAX_COMMAND_OUTPUT))
    }
    return cappedText(stdout || stderr || 'The command completed (exit code 0).', MAX_COMMAND_OUTPUT)
  } finally {
    if (active.requestAbort === controller) active.requestAbort = null
  }
}

async function runHttpStep(active: ActiveBlueprintRun, step: BlueprintStep): Promise<string> {
  const renderedUrl = interpolate(step.httpUrl?.trim() ?? '', active, step.id)
  let url: URL
  try {
    url = new URL(renderedUrl)
  } catch {
    throw new Error('Request URL is invalid.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Request URL must use HTTP or HTTPS.')
  }
  const method = step.httpMethod ?? 'GET'
  const bodyTemplate = step.httpBody ?? ''
  const body =
    !BODYLESS_HTTP_METHODS.has(method) && bodyTemplate.trim()
      ? interpolate(bodyTemplate, active, step.id)
      : undefined
  const controller = new AbortController()
  active.requestAbort = controller
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method,
      headers: parseJsonHeaders(interpolate(step.httpHeaders ?? '', active, step.id), 'Request'),
      body,
      signal: controller.signal
    })
    const responseBody = (await response.text()).slice(0, MAX_WEBHOOK_OUTPUT)
    if (!response.ok) {
      throw new Error(`The request returned HTTP ${response.status}${responseBody ? `: ${responseBody}` : '.'}`)
    }
    return responseBody || `The request completed with HTTP ${response.status}.`
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
  if (step.type === 'file') return runFileStep(active, step)
  if (step.type === 'shell') return runShellStep(active, step)
  if (step.type === 'http') return runHttpStep(active, step)
  return runWebhookStep(active, step)
}

function routeResultKey(stepId: string, iteration: number): string {
  return `${iteration}\u0000${stepId}`
}

function sourceResultForConnection(
  active: ActiveBlueprintRun,
  connection: BlueprintConnection,
  execution: CompiledBlueprintExecution
): BlueprintRouteResult | undefined {
  const graph = active.executionGraph
  if (!graph || connection.from === BLUEPRINT_START_NODE_ID) return undefined
  const sourceInRepeat = graph.repeatBody.has(connection.from)
  const targetInRepeat = graph.repeatBody.has(connection.to)

  if (connection.toPort === 'repeat') {
    return execution.iteration > 1
      ? active.routeResults.get(routeResultKey(connection.from, execution.iteration - 1))
      : undefined
  }
  if (targetInRepeat) {
    if (sourceInRepeat) {
      return active.routeResults.get(routeResultKey(connection.from, execution.iteration))
    }
    return execution.iteration === 1
      ? active.latestRouteResults.get(connection.from)
      : undefined
  }
  return active.latestRouteResults.get(connection.from)
}

function connectionIsActive(
  active: ActiveBlueprintRun,
  connection: BlueprintConnection,
  execution: CompiledBlueprintExecution
): boolean {
  const graph = active.executionGraph
  if (!graph) return true
  if (connection.from === BLUEPRINT_START_NODE_ID) {
    return !graph.repeatBody.has(connection.to) || execution.iteration === 1
  }
  const result = sourceResultForConnection(active, connection, execution)
  if (!result) return false
  const outgoing = graph.connections.filter((candidate) => candidate.from === connection.from)
  return matchingBlueprintConnections(outgoing, result).some(
    (candidate) => candidate.id === connection.id
  )
}

function executionIsActive(
  active: ActiveBlueprintRun,
  execution: CompiledBlueprintExecution
): boolean {
  const graph = active.executionGraph
  if (!graph) return true
  const incoming = graph.connections.filter((connection) => connection.to === execution.step.id)
  if (
    graph.repeatConnection?.to === execution.step.id &&
    execution.iteration > 1
  ) {
    return incoming
      .filter((connection) => connection.toPort === 'repeat')
      .some((connection) => connectionIsActive(active, connection, execution))
  }
  const regular = incoming.filter((connection) => connection.toPort !== 'repeat')
  return regular.length > 0 &&
    regular.every((connection) => connectionIsActive(active, connection, execution))
}

function failureHasRoute(
  active: ActiveBlueprintRun,
  step: BlueprintStep,
  result: BlueprintRouteResult
): boolean {
  const graph = active.executionGraph
  if (!graph) return false
  const outgoing = graph.connections.filter((connection) => connection.from === step.id)
  return matchingBlueprintConnections(outgoing, result).some((connection) => {
    const operator = connection.condition?.operator
    return operator === 'failed' || operator === 'otherwise'
  })
}

function recordSkippedExecution(
  active: ActiveBlueprintRun,
  execution: CompiledBlueprintExecution,
  attemptsByStep: Map<string, number>
): void {
  const now = Date.now()
  const attempt = (attemptsByStep.get(execution.step.id) ?? 0) + 1
  attemptsByStep.set(execution.step.id, attempt)
  active.run.steps.push({
    id: randomUUID(),
    stepId: execution.step.id,
    stepName: execution.step.name,
    type: execution.step.type,
    attempt,
    status: 'skipped',
    startedAt: now,
    finishedAt: now,
    error: 'No incoming route condition matched.'
  })
  persistRun(active)
  emit(active, 'step-skipped', execution.step.id)
}

async function executeScheduledAction(
  active: ActiveBlueprintRun,
  execution: CompiledBlueprintExecution,
  attemptsByStep: Map<string, number>
): Promise<BlueprintRouteResult> {
  const step = execution.step
  const repeat = Math.round(numberInRange(step.repeat, 1, 1, MAX_REPEAT))
  let finalResult: BlueprintRouteResult | undefined

  for (let localAttempt = 1; localAttempt <= repeat; localAttempt += 1) {
    assertRunning(active)
    const attempt = (attemptsByStep.get(step.id) ?? 0) + 1
    attemptsByStep.set(step.id, attempt)
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
      finalResult = { status: 'completed', output }
      persistRun(active)
      emit(active, 'step-completed', step.id)
    } catch (error) {
      if (error instanceof BlueprintStoppedError || active.stopped) throw error
      const message = error instanceof Error ? error.message : String(error)
      stepRun.status = 'failed'
      stepRun.error = message
      stepRun.finishedAt = Date.now()
      finalResult = { status: 'failed', error: message }
      const routedFailure = failureHasRoute(active, step, finalResult)
      if (routedFailure) {
        active.lastOutput = message
        active.stepOutputs.set(step.id, message)
      }
      persistRun(active)
      emit(active, 'step-failed', step.id)
      if (routedFailure) break
      if (!step.continueOnError) throw error
    }
  }

  return finalResult ?? { status: 'failed', error: 'The Blueprint action did not run.' }
}

async function executeBlueprint(active: ActiveBlueprintRun): Promise<void> {
  try {
    emit(active, 'run-started')
    const attemptsByStep = new Map<string, number>()
    for (const execution of active.executions) {
      assertRunning(active)
      if (!executionIsActive(active, execution)) {
        recordSkippedExecution(active, execution, attemptsByStep)
        continue
      }
      const result = await executeScheduledAction(active, execution, attemptsByStep)
      active.routeResults.set(routeResultKey(execution.step.id, execution.iteration), result)
      active.latestRouteResults.set(execution.step.id, result)
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
      for (const mode of ['agent', 'plain']) {
        forgetWProviderSession(
          agent.service,
          `${active.blueprint.id}:${active.run.id}:${agent.id}:${mode}`
        )
      }
    }
    activeRuns.delete(active.blueprint.id)
  }
}

function findBlueprint(id: string): BlueprintDefinition | undefined {
  return readBlueprints().find((blueprint) => blueprint.id === id)
}

function recordRejectedScheduledRun(
  blueprint: BlueprintDefinition,
  input: string,
  error: string,
  sender?: WebContents
): BlueprintRunResult {
  const now = Date.now()
  const run: BlueprintRunSummary = {
    id: randomUUID(),
    blueprintId: blueprint.id,
    trigger: 'schedule',
    input,
    status: 'failed',
    startedAt: now,
    finishedAt: now,
    steps: [],
    error
  }
  replaceBlueprint({ ...blueprint, updatedAt: now, lastRun: snapshot(run) })
  const target = sender && !sender.isDestroyed() ? sender : ascoraRendererWebContents()
  if (target && !target.isDestroyed()) {
    const event: BlueprintEvent = {
      kind: 'run-failed',
      blueprintId: blueprint.id,
      runId: run.id,
      run: snapshot(run)
    }
    target.send(IPC.blueprint.event, event)
  }
  return { ok: false, error }
}

function runBlueprint(
  request: BlueprintRunRequest,
  sender?: WebContents,
  trigger: BlueprintRunSummary['trigger'] = 'manual'
): BlueprintRunResult {
  const blueprint = findBlueprint(request.blueprintId)
  if (!blueprint) return { ok: false, error: 'Blueprint not found.' }
  if (activeRuns.has(blueprint.id)) return { ok: false, error: 'This Blueprint is already running.' }
  let compiled: CompiledBlueprint
  try {
    compiled = compileBlueprint(blueprint)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return trigger === 'schedule'
      ? recordRejectedScheduledRun(blueprint, text(request.input), message, sender)
      : { ok: false, error: message }
  }
  if (compiled.steps.length === 0) {
    const message = 'Add at least one step before running.'
    return trigger === 'schedule'
      ? recordRejectedScheduledRun(blueprint, text(request.input), message, sender)
      : { ok: false, error: message }
  }

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
    executions: compiled.executions,
    executionGraph: compiled.graph,
    graphAncestors: compiled.ancestors,
    graphPredecessors: compiled.predecessors,
    run,
    sender,
    stopped: false,
    currentRequestId: null,
    requestAbort: null,
    agentMessages: new Map(),
    stepOutputs: new Map(),
    agentOutputs: new Map(),
    routeResults: new Map(),
    latestRouteResults: new Map(),
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
