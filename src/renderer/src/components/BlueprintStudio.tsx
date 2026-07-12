import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  BLUEPRINT_START_NODE_ID,
  WPROVIDER_SERVICES,
  WPROVIDER_SERVICE_INFO,
  type BlueprintAgent,
  type BlueprintDefinition,
  type BlueprintGraph,
  type BlueprintStep,
  type BlueprintStepType,
  type BlueprintToolRunStatus
} from '@shared/ipc'
import { Icon } from './Icon'
import { BlueprintGraphEditor } from './BlueprintGraphEditor'
import { BlueprintStepRoutes, type BlueprintRoutesLabels } from './BlueprintStepRoutes'
import { useBlueprints, type BlueprintTemplate } from '@/state/blueprints'
import { useApp } from '@/state/store'
import { localeForLanguage, tr } from '@/language'

function cloneBlueprint(blueprint: BlueprintDefinition): BlueprintDefinition {
  return structuredClone(blueprint)
}

function stepIcon(type: BlueprintStepType): JSX.Element {
  if (type === 'agent') return <Icon name="users" size={15} />
  if (type === 'telegram') return <Icon name="telegram" size={15} />
  if (type === 'delay') return <Icon name="clock" size={15} />
  if (type === 'file') return <Icon name="file" size={15} />
  if (type === 'shell') return <Icon name="terminal" size={15} />
  if (type === 'http') return <Icon name="globe" size={15} />
  return <Icon name="webhook" size={15} />
}

function newStep(type: BlueprintStepType, agents: BlueprintAgent[]): BlueprintStep {
  const base = {
    id: crypto.randomUUID(),
    type,
    repeat: 1,
    continueOnError: false
  }
  if (type === 'agent') {
    return {
      ...base,
      name: 'Agent task',
      agentId: agents.find((agent) => agent.enabled)?.id ?? agents[0]?.id ?? '',
      prompt: '{{input}}',
      agentMode: false
    }
  }
  if (type === 'telegram') {
    return {
      ...base,
      name: 'Send to Telegram',
      telegramBotToken: '',
      telegramChatId: '',
      message: '{{last}}'
    }
  }
  if (type === 'delay') return { ...base, name: 'Wait', delaySeconds: 60 }
  if (type === 'file') {
    return {
      ...base,
      name: 'File',
      fileMode: 'read',
      filePath: '',
      fileContent: '{{last}}'
    }
  }
  if (type === 'shell') return { ...base, name: 'Run command', command: '' }
  if (type === 'http') {
    return {
      ...base,
      name: 'HTTP request',
      httpUrl: '',
      httpMethod: 'GET',
      httpHeaders: '',
      httpBody: ''
    }
  }
  return {
    ...base,
    name: 'Call webhook',
    webhookUrl: '',
    webhookMethod: 'POST',
    webhookHeaders: '{\n  "content-type": "application/json"\n}',
    webhookBody: '{{last}}'
  }
}

function appendStepToGraph(
  graph: BlueprintGraph,
  steps: BlueprintStep[],
  stepId: string
): BlueprintGraph {
  const entryTargets = new Set(
    graph.connections
      .filter((connection) => connection.from === BLUEPRINT_START_NODE_ID)
      .map((connection) => connection.to)
  )
  const predecessors = new Map<string, string[]>()
  for (const connection of graph.connections) {
    if (
      connection.from === BLUEPRINT_START_NODE_ID ||
      connection.toPort === 'repeat'
    ) continue
    const sources = predecessors.get(connection.to) ?? []
    sources.push(connection.from)
    predecessors.set(connection.to, sources)
  }
  const reachable = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const step of steps) {
      if (reachable.has(step.id)) continue
      const sources = predecessors.get(step.id) ?? []
      if (
        (entryTargets.has(step.id) || sources.length > 0) &&
        sources.every((source) => reachable.has(source))
      ) {
        reachable.add(step.id)
        changed = true
      }
    }
  }
  const sourcesWithOutgoing = new Set(
    graph.connections
      .filter(
        (connection) =>
          connection.from !== BLUEPRINT_START_NODE_ID && connection.toPort !== 'repeat'
      )
      .map((connection) => connection.from)
  )
  const terminalIds = steps
    .map((step) => step.id)
    .filter((id) => reachable.has(id) && !sourcesWithOutgoing.has(id))
  const sources = terminalIds.length > 0 ? terminalIds : [BLUEPRINT_START_NODE_ID]
  const positionedSteps = steps.flatMap((step) => graph.positions[step.id] ?? [])
  const x = positionedSteps.length > 0
    ? Math.max(...positionedSteps.map((position) => position.x)) + 280
    : 260
  return {
    ...graph,
    positions: { ...graph.positions, [stepId]: { x, y: 120 } },
    connections: [
      ...graph.connections,
      ...sources.map((from) => ({ id: crypto.randomUUID(), from, to: stepId }))
    ]
  }
}

function addDetachedStepToGraph(
  graph: BlueprintGraph,
  steps: BlueprintStep[],
  stepId: string
): BlueprintGraph {
  const positionedSteps = steps.flatMap((step) => graph.positions[step.id] ?? [])
  const x = positionedSteps.length > 0
    ? Math.max(...positionedSteps.map((position) => position.x)) + 320
    : 356
  return {
    ...graph,
    positions: {
      ...graph.positions,
      [stepId]: { x, y: 112 + (steps.length % 3) * 150 }
    }
  }
}

function removeStepFromGraph(graph: BlueprintGraph, stepId: string): BlueprintGraph {
  const positions = { ...graph.positions }
  delete positions[stepId]
  return {
    ...graph,
    positions,
    connections: graph.connections.filter(
      (connection) => connection.from !== stepId && connection.to !== stepId
    )
  }
}

function linearGraph(steps: BlueprintStep[]): BlueprintGraph {
  const positions: BlueprintGraph['positions'] = {
    [BLUEPRINT_START_NODE_ID]: { x: 72, y: 170 }
  }
  steps.forEach((step, index) => {
    positions[step.id] = { x: 356 + index * 344, y: 112 + (index % 2) * 116 }
  })
  return {
    positions,
    connections: steps.map((step, index) => {
      const from = index === 0 ? BLUEPRINT_START_NODE_ID : steps[index - 1].id
      return { id: `${from}::${step.id}`, from, to: step.id }
    })
  }
}

export function BlueprintStudio(): JSX.Element {
  const items = useBlueprints((state) => state.items)
  const activeId = useBlueprints((state) => state.activeId)
  const runs = useBlueprints((state) => state.runs)
  const deltas = useBlueprints((state) => state.deltas)
  const loading = useBlueprints((state) => state.loading)
  const error = useBlueprints((state) => state.error)
  const init = useBlueprints((state) => state.init)
  const createBlueprint = useBlueprints((state) => state.createBlueprint)
  const saveBlueprint = useBlueprints((state) => state.saveBlueprint)
  const runBlueprint = useBlueprints((state) => state.runBlueprint)
  const stopBlueprint = useBlueprints((state) => state.stopBlueprint)
  const clearError = useBlueprints((state) => state.clearError)
  const appLanguage = useApp((state) => state.appLanguage)
  const defaultService = useApp((state) => state.wproviderService)
  const workspaces = useApp((state) => state.workspaces)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)
  const toolStatusLabel = (status: BlueprintToolRunStatus): string =>
    status === 'stopped'
      ? t('blueprint.status.stopped')
      : t(`blueprint.stepStatus.${status}`)

  const selected = useMemo(
    () => items.find((blueprint) => blueprint.id === activeId) ?? null,
    [activeId, items]
  )
  const [draft, setDraft] = useState<BlueprintDefinition | null>(null)
  const [dirty, setDirty] = useState(false)
  const [runInput, setRunInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [pipelineMode, setPipelineMode] = useState<'graph' | 'list'>('graph')

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!selected) {
      setDraft(null)
      setDirty(false)
      return
    }
    setDraft(cloneBlueprint(selected))
    setRunInput(selected.schedule.input ?? '')
    setDirty(false)
    // Selection changes are the only time the editor should discard local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const update = (apply: (current: BlueprintDefinition) => BlueprintDefinition): void => {
    setDraft((current) => (current ? apply(current) : current))
    setDirty(true)
  }

  const updateAgent = (id: string, patch: Partial<BlueprintAgent>): void => {
    update((current) => ({
      ...current,
      agents: current.agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent))
    }))
  }

  const removeAgent = (id: string): void => {
    update((current) => ({
      ...current,
      agents: current.agents.filter((agent) => agent.id !== id)
    }))
  }

  const addAgent = (): void => {
    if (!draft) return
    const count = draft.agents.length + 1
    update((current) => ({
      ...current,
      agents: [
        ...current.agents,
        {
          id: crypto.randomUUID(),
          name: `Agent ${count}`,
          role: 'team specialist',
          instructions: '',
          service: defaultService,
          enabled: true
        }
      ]
    }))
  }

  const updateStep = (id: string, patch: Partial<BlueprintStep>): void => {
    update((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch } : step))
    }))
  }

  const removeStep = (id: string): void => {
    update((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.id !== id),
      graph: current.graph ? removeStepFromGraph(current.graph, id) : undefined
    }))
  }

  const moveStep = (index: number, direction: -1 | 1): void => {
    if (!draft) return
    const target = index + direction
    if (target < 0 || target >= draft.steps.length) return
    update((current) => {
      const steps = [...current.steps]
      ;[steps[index], steps[target]] = [steps[target], steps[index]]
      return { ...current, steps }
    })
  }

  const addStep = (type: BlueprintStepType): void => {
    update((current) => {
      const step = newStep(type, current.agents)
      const currentGraph = current.graph ?? linearGraph(current.steps)
      return {
        ...current,
        steps: [...current.steps, step],
        graph:
          pipelineMode === 'graph'
            ? addDetachedStepToGraph(currentGraph, current.steps, step.id)
            : current.graph
              ? appendStepToGraph(current.graph, current.steps, step.id)
              : undefined
      }
    })
  }

  const save = async (): Promise<BlueprintDefinition | null> => {
    if (!draft) return null
    setSaving(true)
    try {
      const saved = await saveBlueprint(draft)
      setDraft(cloneBlueprint(saved))
      setDirty(false)
      return saved
    } finally {
      setSaving(false)
    }
  }

  const run = async (): Promise<void> => {
    const saved = dirty ? await save() : draft
    if (!saved) return
    await runBlueprint(saved.id, runInput)
  }

  const create = async (template: BlueprintTemplate): Promise<void> => {
    await createBlueprint(template, defaultService)
  }

  if (loading && items.length === 0) {
    return <div className="blueprint-empty">{t('blueprint.loading')}</div>
  }

  if (!draft) {
    return (
      <div className="blueprint-empty">
        <div className="blueprint-empty-icon"><Icon name="blueprint" size={34} /></div>
        <h2>{t('blueprint.emptyTitle')}</h2>
        <p>{t('blueprint.emptyDescription')}</p>
        <div className="blueprint-template-row">
          <button className="primary" onClick={() => void create('team')}>
            <Icon name="users" size={15} /> {t('blueprint.templateTeam')}
          </button>
          <button onClick={() => void create('telegram')}>
            <Icon name="telegram" size={15} /> {t('blueprint.templateTelegram')}
          </button>
        </div>
      </div>
    )
  }

  const runState = runs[draft.id] ?? draft.lastRun
  const running = runState?.status === 'running'
  const statusLabel = runState ? t(`blueprint.status.${runState.status}`) : t('blueprint.status.idle')
  const agentModeHintId = `blueprint-agent-mode-hint-${draft.id}`
  const editorGraph = draft.graph ?? linearGraph(draft.steps)
  const routeLabels: BlueprintRoutesLabels = {
    routes: t('blueprint.graphRoutes'),
    route: t('blueprint.graphRoute'),
    routeCondition: t('blueprint.graphRouteCondition'),
    routeAlways: t('blueprint.graphRouteAlways'),
    routeOtherwise: t('blueprint.graphRouteOtherwise'),
    routeSucceeded: t('blueprint.graphRouteSucceeded'),
    routeFailed: t('blueprint.graphRouteFailed'),
    routeContains: t('blueprint.graphRouteContains'),
    routeNotContains: t('blueprint.graphRouteNotContains'),
    routeEquals: t('blueprint.graphRouteEquals'),
    routeNotEquals: t('blueprint.graphRouteNotEquals'),
    routeValue: t('blueprint.graphRouteValue'),
    routeCaseSensitive: t('blueprint.graphRouteCaseSensitive'),
    deleteRoute: t('blueprint.graphDeleteRoute'),
    addRoute: t('blueprint.graphAddRoute'),
    routeTarget: t('blueprint.graphRouteTarget'),
    routeKind: t('blueprint.graphRouteKind'),
    routeFlow: t('blueprint.graphRouteFlow'),
    routeRepeat: t('blueprint.graphRouteRepeat'),
    routeEmpty: t('blueprint.graphRouteEmpty'),
    routeHelp: t('blueprint.graphRouteHelp'),
    routeRepeatOccupied: t('blueprint.graphRouteRepeatOccupied'),
    routeRepeatNeedsPath: t('blueprint.graphRouteRepeatNeedsPath'),
    iterations: t('blueprint.graphIterations')
  }
  const usesAgentMode =
    draft.agentMode ||
    draft.steps.some((step) => step.type === 'agent' && step.agentMode === true)
  // File and shell actions run inside the same Blueprint project as agent-mode tools.
  const usesWorkspaceSteps = draft.steps.some(
    (step) => step.type === 'file' || step.type === 'shell'
  )
  const savedWorkspaceId = workspaces.some((workspace) => workspace.id === draft.workspaceId)
    ? draft.workspaceId ?? ''
    : ''

  return (
    <div className="blueprint-studio">
      <header className="blueprint-header">
        <div className="blueprint-heading">
          <div className="blueprint-eyebrow"><Icon name="blueprint" size={14} /> Blueprint</div>
          <input
            className="blueprint-title-input"
            value={draft.name}
            aria-label={t('blueprint.name')}
            onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
          />
          <input
            className="blueprint-description-input"
            value={draft.description}
            placeholder={t('blueprint.descriptionPlaceholder')}
            onChange={(event) => update((current) => ({ ...current, description: event.target.value }))}
          />
        </div>
        <div className="blueprint-toolbar">
          <span className={`blueprint-status ${runState?.status ?? 'idle'}`}>
            <span className="status-dot" />{statusLabel}
          </span>
          <button disabled={!dirty || saving || running} onClick={() => void save()}>
            <Icon name="save" size={14} /> {saving ? t('blueprint.saving') : t('common.save')}
          </button>
          {running ? (
            <button className="danger" onClick={() => void stopBlueprint(draft.id)}>
              <Icon name="stop" size={14} /> {t('common.stop')}
            </button>
          ) : (
            <button className="primary" disabled={draft.steps.length === 0} onClick={() => void run()}>
              <Icon name="play" size={14} /> {t('blueprint.run')}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="blueprint-error" role="alert">
          <span>{error}</span>
          <button aria-label={t('common.close')} onClick={clearError}><Icon name="close" size={13} /></button>
        </div>
      )}

      <div className="blueprint-scroll">
        <section className="blueprint-overview-grid">
          <div className="blueprint-card blueprint-run-card">
            <div className="blueprint-card-title"><Icon name="play" size={15} /> {t('blueprint.manualRun')}</div>
            <textarea
              value={runInput}
              placeholder={t('blueprint.inputPlaceholder')}
              onChange={(event) => setRunInput(event.target.value)}
            />
            <div className="blueprint-hint">{t('blueprint.variablesHint')}</div>
          </div>
          <div className="blueprint-card blueprint-schedule-card">
            <div className="blueprint-card-title"><Icon name="clock" size={15} /> {t('blueprint.schedule')}</div>
            <label className="blueprint-toggle-row">
              <input
                type="checkbox"
                checked={draft.schedule.enabled}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    schedule: { ...current.schedule, enabled: event.target.checked }
                  }))
                }
              />
              <span>{t('blueprint.runAutomatically')}</span>
            </label>
            <label className="blueprint-field-inline">
              <span>{t('blueprint.every')}</span>
              <input
                type="number"
                min={1}
                max={20160}
                value={draft.schedule.intervalMinutes}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    schedule: {
                      ...current.schedule,
                      intervalMinutes: Math.max(1, Number(event.target.value) || 1)
                    }
                  }))
                }
              />
              <span>{t('blueprint.minutes')}</span>
            </label>
            <input
              value={draft.schedule.input ?? ''}
              placeholder={t('blueprint.scheduleInput')}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  schedule: { ...current.schedule, input: event.target.value }
                }))
              }
            />
            <div className="blueprint-hint">{t('blueprint.scheduleHint')}</div>
          </div>
          <div className="blueprint-card blueprint-agent-mode-card">
            <div className="blueprint-card-title"><Icon name="terminal" size={15} /> {t('blueprint.agentMode')}</div>
            <label className="blueprint-toggle-row">
              <input
                type="checkbox"
                checked={draft.agentMode}
                aria-describedby={agentModeHintId}
                onChange={(event) =>
                  update((current) => ({ ...current, agentMode: event.target.checked }))
                }
              />
              <span>{t('blueprint.agentModeEnabled')}</span>
            </label>
            <div className="blueprint-hint" id={agentModeHintId}>
              <strong className="blueprint-agent-mode-scope">
                {t('blueprint.agentModeAllAgents')}
              </strong>
              <span>{t('blueprint.agentModeHint')}</span>
            </div>
            {(usesAgentMode || usesWorkspaceSteps) && (
              <label className="blueprint-agent-workspace">
                <span>{t('blueprint.agentWorkspace')}</span>
                <select
                  value={savedWorkspaceId}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      workspaceId: event.target.value || undefined
                    }))
                  }
                >
                  <option value="">{t('blueprint.webToolsOnly')}</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name} — {workspace.path}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>

        <section className="blueprint-section">
          <div className="blueprint-section-heading">
            <div>
              <h3><Icon name="users" size={16} /> {t('blueprint.agents')}</h3>
              <p>{t('blueprint.agentsHint')}</p>
            </div>
            <button onClick={addAgent}><Icon name="plus" size={14} /> {t('blueprint.addAgent')}</button>
          </div>
          <div className="blueprint-agent-grid">
            {draft.agents.map((agent, index) => (
              <article className={`blueprint-agent-card${agent.enabled ? '' : ' disabled'}`} key={agent.id}>
                <div className="blueprint-agent-head">
                  <span className="blueprint-agent-number">{index + 1}</span>
                  <input
                    value={agent.name}
                    aria-label={t('blueprint.agentName')}
                    onChange={(event) => updateAgent(agent.id, { name: event.target.value })}
                  />
                  <label className="blueprint-agent-enabled" title={t('blueprint.agentEnabled')}>
                    <input
                      type="checkbox"
                      checked={agent.enabled}
                      onChange={(event) => updateAgent(agent.id, { enabled: event.target.checked })}
                    />
                  </label>
                  <button
                    className="icon-only"
                    title={t('blueprint.removeAgent')}
                    onClick={() => removeAgent(agent.id)}
                  ><Icon name="trash" size={13} /></button>
                </div>
                <input
                  value={agent.role}
                  placeholder={t('blueprint.rolePlaceholder')}
                  onChange={(event) => updateAgent(agent.id, { role: event.target.value })}
                />
                <select
                  value={agent.service}
                  aria-label={t('blueprint.wproviderService')}
                  onChange={(event) =>
                    updateAgent(agent.id, { service: event.target.value as BlueprintAgent['service'] })
                  }
                >
                  {WPROVIDER_SERVICES.map((service) => (
                    <option key={service} value={service}>{WPROVIDER_SERVICE_INFO[service].label}</option>
                  ))}
                </select>
                <textarea
                  value={agent.instructions}
                  placeholder={t('blueprint.instructionsPlaceholder')}
                  onChange={(event) => updateAgent(agent.id, { instructions: event.target.value })}
                />
              </article>
            ))}
          </div>
        </section>

        <section className="blueprint-section">
          <div className="blueprint-section-heading">
            <div>
              <h3><Icon name="blueprint" size={16} /> {t('blueprint.pipeline')}</h3>
              <p>{t(pipelineMode === 'graph' ? 'blueprint.graphHint' : 'blueprint.pipelineHint')}</p>
            </div>
            <div className="blueprint-pipeline-modes" role="group" aria-label={t('blueprint.pipeline')}>
              <button
                className={pipelineMode === 'graph' ? 'active' : ''}
                aria-pressed={pipelineMode === 'graph'}
                onClick={() => setPipelineMode('graph')}
              >
                <Icon name="blueprint" size={13} /> {t('blueprint.pipelineGraph')}
              </button>
              <button
                className={pipelineMode === 'list' ? 'active' : ''}
                aria-pressed={pipelineMode === 'list'}
                onClick={() => setPipelineMode('list')}
              >
                <Icon name="list" size={13} /> {t('blueprint.pipelineList')}
              </button>
            </div>
          </div>
          {pipelineMode === 'graph' ? (
            <BlueprintGraphEditor
              steps={draft.steps}
              agents={draft.agents}
              graph={editorGraph}
              readOnly={running}
              onStepChange={updateStep}
              onRemoveStep={removeStep}
              onAddStep={addStep}
              onGraphChange={(graph) => update((current) => ({ ...current, graph }))}
              labels={{
                ariaLabel: t('blueprint.graphAria'),
                graphTools: t('blueprint.graphTools'),
                start: t('blueprint.graphStart'),
                startHint: t('blueprint.graphStartHint'),
                input: t('blueprint.graphInput'),
                repeatInput: t('blueprint.graphRepeatInput'),
                output: t('blueprint.graphOutput'),
                addAgent: t('blueprint.step.agent'),
                addTelegram: 'Telegram',
                addDelay: t('blueprint.step.delay'),
                addWebhook: 'Webhook',
                addFile: t('blueprint.step.file'),
                addShell: t('blueprint.step.shell'),
                addHttp: t('blueprint.step.http'),
                fileMode: t('blueprint.fileMode'),
                fileRead: t('blueprint.fileRead'),
                fileWrite: t('blueprint.fileWrite'),
                filePath: t('blueprint.filePath'),
                fileContent: t('blueprint.fileContent'),
                command: t('blueprint.command'),
                addNote: t('blueprint.graphAddNote'),
                deleteNote: t('blueprint.graphDeleteNote'),
                notePlaceholder: t('blueprint.graphNotePlaceholder'),
                fitView: t('blueprint.graphFit'),
                zoomIn: t('blueprint.graphZoomIn'),
                zoomOut: t('blueprint.graphZoomOut'),
                zoomReset: t('blueprint.graphZoomReset'),
                deleteNode: t('blueprint.graphDeleteNode'),
                moveNode: t('blueprint.graphMoveNode'),
                nodeName: t('blueprint.graphNodeName'),
                nodeType: t('blueprint.graphNodeType'),
                agent: t('blueprint.agent'),
                prompt: t('blueprint.prompt'),
                message: t('blueprint.message'),
                botToken: t('blueprint.telegramToken'),
                chatId: t('blueprint.telegramChat'),
                delaySeconds: t('blueprint.delaySeconds'),
                method: t('blueprint.method'),
                headers: t('blueprint.headersJson'),
                body: t('blueprint.body'),
                repeat: t('blueprint.repeat'),
                iterations: t('blueprint.graphIterations'),
                routes: t('blueprint.graphRoutes'),
                route: t('blueprint.graphRoute'),
                routeCondition: t('blueprint.graphRouteCondition'),
                routeAlways: t('blueprint.graphRouteAlways'),
                routeOtherwise: t('blueprint.graphRouteOtherwise'),
                routeSucceeded: t('blueprint.graphRouteSucceeded'),
                routeFailed: t('blueprint.graphRouteFailed'),
                routeContains: t('blueprint.graphRouteContains'),
                routeNotContains: t('blueprint.graphRouteNotContains'),
                routeEquals: t('blueprint.graphRouteEquals'),
                routeNotEquals: t('blueprint.graphRouteNotEquals'),
                routeValue: t('blueprint.graphRouteValue'),
                routeCaseSensitive: t('blueprint.graphRouteCaseSensitive'),
                deleteRoute: t('blueprint.graphDeleteRoute'),
                addRoute: t('blueprint.graphAddRoute'),
                routeTarget: t('blueprint.graphRouteTarget'),
                routeKind: t('blueprint.graphRouteKind'),
                routeFlow: t('blueprint.graphRouteFlow'),
                routeRepeat: t('blueprint.graphRouteRepeat'),
                routeEmpty: t('blueprint.graphRouteEmpty'),
                routeHelp: t('blueprint.graphRouteHelp'),
                routeRepeatOccupied: t('blueprint.graphRouteRepeatOccupied'),
                routeRepeatNeedsPath: t('blueprint.graphRouteRepeatNeedsPath'),
                agentMode: t('blueprint.stepAgentMode'),
                continueOnError: t('blueprint.continueOnError'),
                empty: t('blueprint.graphEmpty')
              }}
            />
          ) : (
            <>
              <div className="blueprint-step-list">
            {draft.steps.map((step, index) => (
              <article className={`blueprint-step-card type-${step.type}`} key={step.id}>
                <div className="blueprint-step-rail">
                  <span>{index + 1}</span>
                  {index < draft.steps.length - 1 && <i />}
                </div>
                <div className="blueprint-step-content">
                  <div className="blueprint-step-head">
                    <span className="blueprint-step-icon">{stepIcon(step.type)}</span>
                    <input
                      className="blueprint-step-name"
                      value={step.name}
                      onChange={(event) => updateStep(step.id, { name: event.target.value })}
                    />
                    <select
                      className="blueprint-step-type"
                      value={step.type}
                      onChange={(event) => updateStep(step.id, { type: event.target.value as BlueprintStepType })}
                    >
                      <option value="agent">{t('blueprint.step.agent')}</option>
                      <option value="telegram">Telegram</option>
                      <option value="delay">{t('blueprint.step.delay')}</option>
                      <option value="webhook">Webhook</option>
                      <option value="file">{t('blueprint.step.file')}</option>
                      <option value="shell">{t('blueprint.step.shell')}</option>
                      <option value="http">{t('blueprint.step.http')}</option>
                    </select>
                    <button className="icon-only" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                      <Icon name="arrowUp" size={13} />
                    </button>
                    <button className="icon-only" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}>
                      <Icon name="arrowDown" size={13} />
                    </button>
                    <button className="icon-only" onClick={() => removeStep(step.id)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>

                  {step.type === 'agent' && (
                    <div className="blueprint-step-fields">
                      <label>
                        <span>{t('blueprint.agent')}</span>
                        <select value={step.agentId ?? ''} onChange={(event) => updateStep(step.id, { agentId: event.target.value })}>
                          <option value="">—</option>
                          {draft.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                        </select>
                      </label>
                      <label className="wide">
                        <span>{t('blueprint.prompt')}</span>
                        <textarea value={step.prompt ?? ''} onChange={(event) => updateStep(step.id, { prompt: event.target.value })} />
                      </label>
                    </div>
                  )}

                  {step.type === 'telegram' && (
                    <div className="blueprint-step-fields telegram-fields">
                      <label>
                        <span>{t('blueprint.telegramToken')}</span>
                        <input type="password" value={step.telegramBotToken ?? ''} onChange={(event) => updateStep(step.id, { telegramBotToken: event.target.value })} />
                      </label>
                      <label>
                        <span>{t('blueprint.telegramChat')}</span>
                        <input value={step.telegramChatId ?? ''} onChange={(event) => updateStep(step.id, { telegramChatId: event.target.value })} />
                      </label>
                      <label className="wide">
                        <span>{t('blueprint.message')}</span>
                        <textarea value={step.message ?? ''} onChange={(event) => updateStep(step.id, { message: event.target.value })} />
                      </label>
                    </div>
                  )}

                  {step.type === 'delay' && (
                    <div className="blueprint-step-fields">
                      <label>
                        <span>{t('blueprint.delaySeconds')}</span>
                        <input type="number" min={0} max={86400} value={step.delaySeconds ?? 1} onChange={(event) => updateStep(step.id, { delaySeconds: Math.max(0, Number(event.target.value) || 0) })} />
                      </label>
                    </div>
                  )}

                  {step.type === 'webhook' && (
                    <div className="blueprint-step-fields webhook-fields">
                      <label className="wide">
                        <span>URL</span>
                        <input value={step.webhookUrl ?? ''} placeholder="https://example.com/hook" onChange={(event) => updateStep(step.id, { webhookUrl: event.target.value })} />
                      </label>
                      <label>
                        <span>{t('blueprint.method')}</span>
                        <select value={step.webhookMethod ?? 'POST'} onChange={(event) => updateStep(step.id, { webhookMethod: event.target.value as 'POST' | 'PUT' | 'PATCH' })}>
                          <option>POST</option><option>PUT</option><option>PATCH</option>
                        </select>
                      </label>
                      <label>
                        <span>{t('blueprint.headersJson')}</span>
                        <textarea value={step.webhookHeaders ?? ''} onChange={(event) => updateStep(step.id, { webhookHeaders: event.target.value })} />
                      </label>
                      <label className="wide">
                        <span>{t('blueprint.body')}</span>
                        <textarea value={step.webhookBody ?? ''} onChange={(event) => updateStep(step.id, { webhookBody: event.target.value })} />
                      </label>
                    </div>
                  )}

                  {step.type === 'file' && (
                    <div className="blueprint-step-fields">
                      <label className="wide">
                        <span>{t('blueprint.filePath')}</span>
                        <input value={step.filePath ?? ''} placeholder="reports/summary.md" onChange={(event) => updateStep(step.id, { filePath: event.target.value })} />
                      </label>
                      <label>
                        <span>{t('blueprint.fileMode')}</span>
                        <select value={step.fileMode ?? 'read'} onChange={(event) => updateStep(step.id, { fileMode: event.target.value as 'read' | 'write' })}>
                          <option value="read">{t('blueprint.fileRead')}</option>
                          <option value="write">{t('blueprint.fileWrite')}</option>
                        </select>
                      </label>
                      {step.fileMode === 'write' && (
                        <label className="wide">
                          <span>{t('blueprint.fileContent')}</span>
                          <textarea value={step.fileContent ?? ''} onChange={(event) => updateStep(step.id, { fileContent: event.target.value })} />
                        </label>
                      )}
                    </div>
                  )}

                  {step.type === 'shell' && (
                    <div className="blueprint-step-fields">
                      <label className="wide">
                        <span>{t('blueprint.command')}</span>
                        <textarea value={step.command ?? ''} placeholder="npm test" onChange={(event) => updateStep(step.id, { command: event.target.value })} />
                      </label>
                    </div>
                  )}

                  {step.type === 'http' && (
                    <div className="blueprint-step-fields webhook-fields">
                      <label className="wide">
                        <span>URL</span>
                        <input value={step.httpUrl ?? ''} placeholder="https://api.example.com/status" onChange={(event) => updateStep(step.id, { httpUrl: event.target.value })} />
                      </label>
                      <label>
                        <span>{t('blueprint.method')}</span>
                        <select value={step.httpMethod ?? 'GET'} onChange={(event) => updateStep(step.id, { httpMethod: event.target.value as BlueprintStep['httpMethod'] })}>
                          <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                        </select>
                      </label>
                      <label>
                        <span>{t('blueprint.headersJson')}</span>
                        <textarea value={step.httpHeaders ?? ''} onChange={(event) => updateStep(step.id, { httpHeaders: event.target.value })} />
                      </label>
                      {step.httpMethod !== 'GET' && step.httpMethod !== 'DELETE' && (
                        <label className="wide">
                          <span>{t('blueprint.body')}</span>
                          <textarea value={step.httpBody ?? ''} onChange={(event) => updateStep(step.id, { httpBody: event.target.value })} />
                        </label>
                      )}
                    </div>
                  )}

                  <BlueprintStepRoutes
                    className="blueprint-list-routes"
                    step={step}
                    steps={draft.steps}
                    connections={editorGraph.connections}
                    labels={routeLabels}
                    readOnly={running}
                    onConnectionsChange={(connections) =>
                      update((current) => {
                        const graph = current.graph ?? linearGraph(current.steps)
                        return { ...current, graph: { ...graph, connections } }
                      })
                    }
                  />

                  <div className="blueprint-step-options">
                    <label>{t('blueprint.repeat')} <input type="number" min={1} max={20} value={step.repeat ?? 1} onChange={(event) => updateStep(step.id, { repeat: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label>
                    {step.type === 'agent' && (
                      <label><input type="checkbox" checked={step.agentMode === true} onChange={(event) => updateStep(step.id, { agentMode: event.target.checked })} /> {t('blueprint.stepAgentMode')}</label>
                    )}
                    <label><input type="checkbox" checked={step.continueOnError === true} onChange={(event) => updateStep(step.id, { continueOnError: event.target.checked })} /> {t('blueprint.continueOnError')}</label>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="blueprint-add-actions">
            <span>{t('blueprint.addStep')}:</span>
            <button onClick={() => addStep('agent')}><Icon name="users" size={13} /> {t('blueprint.step.agent')}</button>
            <button onClick={() => addStep('telegram')}><Icon name="telegram" size={13} /> Telegram</button>
            <button onClick={() => addStep('delay')}><Icon name="clock" size={13} /> {t('blueprint.step.delay')}</button>
            <button onClick={() => addStep('webhook')}><Icon name="webhook" size={13} /> Webhook</button>
            <button onClick={() => addStep('file')}><Icon name="file" size={13} /> {t('blueprint.step.file')}</button>
            <button onClick={() => addStep('shell')}><Icon name="terminal" size={13} /> {t('blueprint.step.shell')}</button>
            <button onClick={() => addStep('http')}><Icon name="globe" size={13} /> {t('blueprint.step.http')}</button>
          </div>
            </>
          )}
        </section>

        <section className="blueprint-section blueprint-run-log">
          <div className="blueprint-section-heading">
            <div>
              <h3><Icon name="terminal" size={16} /> {t('blueprint.execution')}</h3>
              <p>
                {runState
                  ? `${runState.trigger === 'schedule' ? t('blueprint.triggerSchedule') : t('blueprint.triggerManual')} · ${new Intl.DateTimeFormat(localeForLanguage(appLanguage), { dateStyle: 'medium', timeStyle: 'medium' }).format(runState.startedAt)}`
                  : t('blueprint.neverRun')}
              </p>
            </div>
          </div>
          {runState && runState.steps.length > 0 ? (
            <div className="blueprint-log-list">
              {runState.steps.map((stepRun) => {
                const delta = deltas[`${runState.id}:${stepRun.stepId}`]
                return (
                  <div className={`blueprint-log-item ${stepRun.status}`} key={stepRun.id}>
                    <div className="blueprint-log-head">
                      <span className="status-dot" />
                      <strong>{stepRun.stepName}</strong>
                      {stepRun.attempt > 1 && <span>#{stepRun.attempt}</span>}
                      <span>{t(`blueprint.stepStatus.${stepRun.status}`)}</span>
                    </div>
                    {(stepRun.output || stepRun.error || (stepRun.status === 'running' && delta)) && (
                      <pre>{stepRun.error || stepRun.output || delta}</pre>
                    )}
                    {stepRun.tools && stepRun.tools.length > 0 && (
                      <div className="blueprint-tool-audit">
                        <div className="blueprint-tool-audit-title">
                          {t('blueprint.tools')} · {stepRun.tools.length}
                        </div>
                        {stepRun.tools.map((toolRun) => {
                          const details = [
                            Object.keys(toolRun.args).length > 0
                              ? `${t('blueprint.toolArguments')}:\n${JSON.stringify(toolRun.args, null, 2)}`
                              : '',
                            toolRun.error
                              ? `${t('blueprint.toolError')}:\n${toolRun.error}`
                              : toolRun.output
                                ? `${t('blueprint.toolResult')}:\n${toolRun.output}`
                                : ''
                          ].filter(Boolean).join('\n\n')
                          return (
                            <details
                              className={`blueprint-tool-audit-item ${toolRun.status}`}
                              open={toolRun.status !== 'completed'}
                              key={toolRun.id}
                            >
                              <summary>
                                <span className="status-dot" />
                                <code>{toolRun.tool}</code>
                                <span>{toolStatusLabel(toolRun.status)}</span>
                              </summary>
                              {details && <pre>{details}</pre>}
                            </details>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="blueprint-log-empty">{t('blueprint.noExecution')}</div>
          )}
        </section>
      </div>
    </div>
  )
}
