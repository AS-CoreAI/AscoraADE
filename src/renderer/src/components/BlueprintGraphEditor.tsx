import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent
} from 'react'
import {
  BLUEPRINT_START_NODE_ID,
  type BlueprintConnection,
  type BlueprintConnectionCondition,
  type BlueprintConnectionConditionOperator,
  type BlueprintAgent,
  type BlueprintGraph,
  type BlueprintNodePosition,
  type BlueprintStep,
  type BlueprintStepType
} from '@shared/ipc'
import { Icon } from './Icon'
import type { BlueprintRoutesLabels } from './BlueprintStepRoutes'
import '@/styles/blueprint-graph.css'

export type BlueprintGraphSelection =
  | { kind: 'node'; id: string }
  | { kind: 'connection'; id: string }

export interface BlueprintGraphEditorLabels extends BlueprintRoutesLabels {
  ariaLabel: string
  graphTools: string
  start: string
  startHint: string
  input: string
  repeatInput: string
  output: string
  addAgent: string
  addTelegram: string
  addDelay: string
  addWebhook: string
  fitView: string
  zoomIn: string
  zoomOut: string
  deleteNode: string
  moveNode: string
  nodeName: string
  nodeType: string
  agent: string
  prompt: string
  message: string
  botToken: string
  chatId: string
  delaySeconds: string
  method: string
  headers: string
  body: string
  repeat: string
  iterations: string
  agentMode: string
  continueOnError: string
  empty: string
}

export interface BlueprintGraphEditorProps {
  steps: BlueprintStep[]
  agents: BlueprintAgent[]
  onStepChange: (stepId: string, patch: Partial<BlueprintStep>) => void
  onRemoveStep: (stepId: string) => void
  onAddStep: (type: BlueprintStepType) => void
  graph: BlueprintGraph
  onGraphChange: (graph: BlueprintGraph) => void
  selection?: BlueprintGraphSelection | null
  onSelectionChange?: (selection: BlueprintGraphSelection | null) => void
  labels?: Partial<BlueprintGraphEditorLabels>
  className?: string
  readOnly?: boolean
}

const NODE_WIDTH = 286
const START_NODE_WIDTH = 214
const START_PORT_Y = 65
const INPUT_PORT_Y = 60
const REPEAT_PORT_Y = 84
const OUTPUT_PORT_Y = 71
const MIN_ZOOM = 0.2
const MAX_ZOOM = 1.8
const GRID_SIZE = 24

const DEFAULT_LABELS: BlueprintGraphEditorLabels = {
  ariaLabel: 'Blueprint graph editor',
  graphTools: 'Graph tools',
  start: 'Start',
  startHint: 'The workflow starts here',
  input: 'In',
  repeatInput: 'Repeat',
  output: 'Out',
  addAgent: 'Agent',
  addTelegram: 'Telegram',
  addDelay: 'Delay',
  addWebhook: 'Webhook',
  fitView: 'Fit view',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  deleteNode: 'Delete node',
  moveNode: 'Move node',
  nodeName: 'Node name',
  nodeType: 'Node type',
  agent: 'Agent',
  prompt: 'Prompt',
  message: 'Message',
  botToken: 'Bot token',
  chatId: 'Chat ID',
  delaySeconds: 'Delay, seconds',
  method: 'Method',
  headers: 'Headers (JSON)',
  body: 'Body',
  repeat: 'Repeat',
  iterations: 'Passes',
  routes: 'Routes',
  route: 'Route',
  routeCondition: 'Condition',
  routeAlways: 'Always',
  routeOtherwise: 'Otherwise',
  routeSucceeded: 'Step succeeded',
  routeFailed: 'Step failed',
  routeContains: 'Output contains',
  routeNotContains: 'Output does not contain',
  routeEquals: 'Output equals',
  routeNotEquals: 'Output does not equal',
  routeValue: 'Comparison text',
  routeCaseSensitive: 'Case-sensitive',
  deleteRoute: 'Delete route',
  addRoute: 'Add route',
  routeTarget: 'Target node',
  routeKind: 'Route type',
  routeFlow: 'Forward',
  routeRepeat: 'Feedback loop',
  routeEmpty: 'No outgoing routes yet',
  routeHelp: 'Add any number of conditional targets. A feedback loop returns to an earlier node and is bounded by passes.',
  routeRepeatOccupied: 'A feedback loop is already configured:',
  routeRepeatNeedsPath: 'A feedback loop can only return to an earlier node on this flow path.',
  agentMode: 'Agent mode',
  continueOnError: 'Continue on error',
  empty: 'Add a node to build the workflow'
}

type Viewport = { x: number; y: number; zoom: number }
type RouteDraft = { targetId: string; toPort: DestinationPort }

type Gesture =
  | {
      kind: 'pan'
      pointerId: number
      clientX: number
      clientY: number
      originX: number
      originY: number
    }
  | {
      kind: 'node'
      pointerId: number
      nodeId: string
      clientX: number
      clientY: number
      origin: BlueprintNodePosition
    }
  | {
      kind: 'connect'
      pointerId: number
      sourceId: string
    }

function stepIcon(type: BlueprintStepType): JSX.Element {
  if (type === 'agent') return <Icon name="users" size={14} />
  if (type === 'telegram') return <Icon name="telegram" size={14} />
  if (type === 'delay') return <Icon name="clock" size={14} />
  return <Icon name="webhook" size={14} />
}

type DestinationPort = 'input' | 'repeat'

const OUTPUT_CONDITION_OPERATORS = new Set<BlueprintConnectionConditionOperator>([
  'contains',
  'not_contains',
  'equals',
  'not_equals'
])

function cleanCondition(
  condition: BlueprintConnectionCondition | undefined
): BlueprintConnectionCondition | undefined {
  if (!condition) return undefined
  return {
    operator: condition.operator,
    ...(OUTPUT_CONDITION_OPERATORS.has(condition.operator)
      ? { value: condition.value ?? '', caseSensitive: condition.caseSensitive === true }
      : {})
  }
}

function conditionOptions(labels: BlueprintGraphEditorLabels): JSX.Element {
  return (
    <>
      <option value="always">{labels.routeAlways}</option>
      <option value="otherwise">{labels.routeOtherwise}</option>
      <option value="succeeded">{labels.routeSucceeded}</option>
      <option value="failed">{labels.routeFailed}</option>
      <option value="contains">{labels.routeContains}</option>
      <option value="not_contains">{labels.routeNotContains}</option>
      <option value="equals">{labels.routeEquals}</option>
      <option value="not_equals">{labels.routeNotEquals}</option>
    </>
  )
}

function destinationPort(connection: BlueprintConnection): DestinationPort {
  return connection.toPort === 'repeat' ? 'repeat' : 'input'
}

function connectionId(
  sourceId: string,
  targetId: string,
  toPort: DestinationPort
): string {
  return toPort === 'repeat'
    ? `${sourceId}::repeat::${targetId}`
    : `${sourceId}::${targetId}`
}

function connectionConditionClass(connection: BlueprintConnection): string {
  const operator = connection.condition?.operator ?? 'always'
  if (operator === 'failed') return ' when-failed'
  if (operator === 'succeeded') return ' when-succeeded'
  if (operator === 'otherwise') return ' when-otherwise'
  if (operator !== 'always') return ' when-output'
  return ''
}

function defaultPosition(index: number): BlueprintNodePosition {
  if (index < 0) return { x: 72, y: 170 }
  return {
    x: 356 + index * 344,
    y: 112 + (index % 2) * 116
  }
}

function ensurePositions(
  steps: BlueprintStep[],
  current: Record<string, BlueprintNodePosition>
): Record<string, BlueprintNodePosition> {
  const validIds = new Set([BLUEPRINT_START_NODE_ID, ...steps.map((step) => step.id)])
  const next: Record<string, BlueprintNodePosition> = {}
  for (const [id, point] of Object.entries(current)) {
    if (validIds.has(id)) next[id] = point
  }
  next[BLUEPRINT_START_NODE_ID] ??= defaultPosition(-1)
  steps.forEach((step, index) => {
    next[step.id] ??= defaultPosition(index)
  })
  return next
}

function cleanConnections(
  steps: BlueprintStep[],
  connections: BlueprintConnection[]
): BlueprintConnection[] {
  const validSources = new Set([BLUEPRINT_START_NODE_ID, ...steps.map((step) => step.id)])
  const validTargets = new Set(steps.map((step) => step.id))
  const ids = new Set<string>()
  const pairs = new Set<string>()
  return connections.flatMap((connection) => {
    const toPort = destinationPort(connection)
    const pair = `${toPort}\u0000${connection.from}\u0000${connection.to}`
    if (
      !validSources.has(connection.from) ||
      !validTargets.has(connection.to) ||
      connection.from === connection.to ||
      (toPort === 'repeat' && connection.from === BLUEPRINT_START_NODE_ID) ||
      ids.has(connection.id) ||
      pairs.has(pair)
    ) {
      return []
    }
    ids.add(connection.id)
    pairs.add(pair)
    const condition = cleanCondition(connection.condition)
    return [
      toPort === 'repeat'
        ? {
            id: connection.id,
            from: connection.from,
            to: connection.to,
            toPort,
            iterations: Math.max(2, Math.min(20, Number(connection.iterations) || 2)),
            ...(condition ? { condition } : {})
          }
        : {
            id: connection.id,
            from: connection.from,
            to: connection.to,
            ...(condition ? { condition } : {})
          }
    ]
  })
}

function pathBetween(source: BlueprintNodePosition, target: BlueprintNodePosition): string {
  const distance = Math.abs(target.x - source.x)
  const bend = Math.max(72, Math.min(230, distance * 0.48))
  const direction = target.x >= source.x ? 1 : -1
  return `M ${source.x} ${source.y} C ${source.x + bend * direction} ${source.y}, ${target.x - bend * direction} ${target.y}, ${target.x} ${target.y}`
}

function repeatPathBetween(
  source: BlueprintNodePosition,
  target: BlueprintNodePosition
): string {
  const direction = source.x >= target.x ? 1 : -1
  const distance = Math.abs(source.x - target.x)
  const lift = Math.max(78, Math.min(180, distance * 0.2))
  const top = Math.min(source.y, target.y) - lift
  return `M ${source.x} ${source.y} C ${source.x + 72 * direction} ${top}, ${target.x - 72 * direction} ${top}, ${target.x} ${target.y}`
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function createsCycle(
  connections: BlueprintConnection[],
  sourceId: string,
  targetId: string
): boolean {
  const outgoing = new Map<string, string[]>()
  for (const connection of connections) {
    if (destinationPort(connection) === 'repeat') continue
    const targets = outgoing.get(connection.from) ?? []
    targets.push(connection.to)
    outgoing.set(connection.from, targets)
  }
  const pending = [targetId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(outgoing.get(current) ?? []))
  }
  return false
}

function hasFlowPath(
  connections: BlueprintConnection[],
  sourceId: string,
  targetId: string
): boolean {
  if (sourceId === targetId) return true
  const outgoing = new Map<string, string[]>()
  for (const connection of connections) {
    if (destinationPort(connection) === 'repeat') continue
    const targets = outgoing.get(connection.from) ?? []
    targets.push(connection.to)
    outgoing.set(connection.from, targets)
  }
  const pending = [sourceId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current === targetId) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(outgoing.get(current) ?? []))
  }
  return false
}

export function BlueprintGraphEditor({
  steps,
  agents,
  onStepChange,
  onRemoveStep,
  onAddStep,
  graph,
  onGraphChange,
  selection,
  onSelectionChange,
  labels: labelOverrides,
  className,
  readOnly = false
}: BlueprintGraphEditorProps): JSX.Element {
  const labels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...labelOverrides }),
    [labelOverrides]
  )
  const stepIds = useMemo(() => steps.map((step) => step.id).join('\u0000'), [steps])
  const editorRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 36, y: 28, zoom: 0.9 })
  const [cursor, setCursor] = useState<BlueprintNodePosition | null>(null)
  const [localSelection, setLocalSelection] = useState<BlueprintGraphSelection | null>(null)
  const [routeDrafts, setRouteDrafts] = useState<Record<string, RouteDraft>>({})
  const [openRouteEditors, setOpenRouteEditors] = useState<Record<string, boolean>>({})
  const graphPositions = useMemo(
    () => ensurePositions(steps, graph.positions),
    [graph.positions, stepIds]
  )
  const graphConnections = useMemo(
    () => cleanConnections(steps, graph.connections),
    [graph.connections, stepIds]
  )
  const reachableNodes = useMemo(() => {
    const entryTargets = new Set(
      graphConnections
        .filter(
          (connection) =>
            connection.from === BLUEPRINT_START_NODE_ID &&
            destinationPort(connection) === 'input'
        )
        .map((connection) => connection.to)
    )
    const predecessors = new Map<string, string[]>()
    for (const connection of graphConnections) {
      if (
        connection.from === BLUEPRINT_START_NODE_ID ||
        destinationPort(connection) === 'repeat'
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
    return reachable
  }, [graphConnections, stepIds, steps])

  const activeSelection = selection === undefined ? localSelection : selection
  const selectedConnection = activeSelection?.kind === 'connection'
    ? graphConnections.find((connection) => connection.id === activeSelection.id)
    : undefined

  useEffect(() => {
    if (!activeSelection) return
    const exists =
      activeSelection.kind === 'node'
        ? activeSelection.id === BLUEPRINT_START_NODE_ID ||
          steps.some((step) => step.id === activeSelection.id)
        : graphConnections.some((connection) => connection.id === activeSelection.id)
    if (!exists) {
      setLocalSelection(null)
      onSelectionChange?.(null)
    }
  }, [activeSelection, graphConnections, onSelectionChange, stepIds, steps])

  const select = useCallback(
    (next: BlueprintGraphSelection | null): void => {
      setLocalSelection(next)
      onSelectionChange?.(next)
    },
    [onSelectionChange]
  )

  const publishPositions = useCallback(
    (next: Record<string, BlueprintNodePosition>): void => {
      onGraphChange({ ...graph, positions: next })
    },
    [graph, onGraphChange]
  )

  const publishConnections = useCallback(
    (next: BlueprintConnection[]): void => {
      const clean = cleanConnections(steps, next)
      onGraphChange({ ...graph, connections: clean })
    },
    [graph, onGraphChange, steps]
  )

  const updateConnectionCondition = useCallback(
    (
      connectionIdToUpdate: string,
      operator: BlueprintConnectionConditionOperator,
      patch: Partial<BlueprintConnectionCondition> = {}
    ): void => {
      publishConnections(
        graphConnections.map((connection) => {
          if (connection.id !== connectionIdToUpdate) return connection
          if (operator === 'always') {
            return { ...connection, condition: undefined }
          }
          return {
            ...connection,
            condition: {
              operator,
              ...(OUTPUT_CONDITION_OPERATORS.has(operator)
                ? {
                    value: patch.value ?? connection.condition?.value ?? '',
                    caseSensitive:
                      patch.caseSensitive ?? connection.condition?.caseSensitive === true
                  }
                : {})
            }
          }
        })
      )
    },
    [graphConnections, publishConnections]
  )

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): BlueprintNodePosition => {
      const rect = viewportRef.current?.getBoundingClientRect()
      return {
        x: (clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
        y: (clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom
      }
    },
    [viewport]
  )

  const portPoint = useCallback(
    (
      nodeId: string,
      side: 'input' | 'output',
      toPort: DestinationPort = 'input'
    ): BlueprintNodePosition => {
      const position = graphPositions[nodeId] ?? defaultPosition(-1)
      const width = nodeId === BLUEPRINT_START_NODE_ID ? START_NODE_WIDTH : NODE_WIDTH
      const portY =
        nodeId === BLUEPRINT_START_NODE_ID
          ? START_PORT_Y
          : side === 'output'
            ? OUTPUT_PORT_Y
            : toPort === 'repeat'
              ? REPEAT_PORT_Y
              : INPUT_PORT_Y
      return {
        x: position.x + (side === 'output' ? width : 0),
        y: position.y + portY
      }
    },
    [graphPositions]
  )

  const finishConnection = useCallback(
    (sourceId: string, targetId: string, toPort: DestinationPort): void => {
      if (
        readOnly ||
        sourceId === targetId ||
        targetId === BLUEPRINT_START_NODE_ID ||
        (toPort === 'input' && createsCycle(graphConnections, sourceId, targetId)) ||
        (toPort === 'repeat' &&
          (sourceId === BLUEPRINT_START_NODE_ID ||
            !hasFlowPath(graphConnections, targetId, sourceId)))
      ) {
        return
      }
      const existing = graphConnections.find(
        (connection) =>
          connection.from === sourceId &&
          connection.to === targetId &&
          destinationPort(connection) === toPort
      )
      if (existing) {
        select({ kind: 'connection', id: existing.id })
        return
      }
      if (
        toPort === 'repeat' &&
        graphConnections.some((connection) => destinationPort(connection) === 'repeat')
      ) return
      const created: BlueprintConnection = {
        id: connectionId(sourceId, targetId, toPort),
        from: sourceId,
        to: targetId,
        ...(toPort === 'repeat' ? { toPort, iterations: 2 } : {})
      }
      publishConnections([...graphConnections, created])
      select({ kind: 'connection', id: created.id })
    },
    [graphConnections, publishConnections, readOnly, select]
  )

  const startNodeDrag = (
    event: PointerEvent<HTMLButtonElement>,
    nodeId: string
  ): void => {
    if (readOnly || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    gestureRef.current = {
      kind: 'node',
      pointerId: event.pointerId,
      nodeId,
      clientX: event.clientX,
      clientY: event.clientY,
      origin: graphPositions[nodeId] ?? defaultPosition(-1)
    }
    viewportRef.current?.setPointerCapture(event.pointerId)
    select({ kind: 'node', id: nodeId })
  }

  const startConnection = (
    event: PointerEvent<HTMLButtonElement>,
    sourceId: string
  ): void => {
    if (readOnly || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    gestureRef.current = { kind: 'connect', pointerId: event.pointerId, sourceId }
    setCursor(clientToWorld(event.clientX, event.clientY))
    viewportRef.current?.setPointerCapture(event.pointerId)
    select({ kind: 'node', id: sourceId })
  }

  const handleCanvasPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.button !== 1) return
    const target = event.target as HTMLElement
    if (target.closest('.blueprint-graph-node, .blueprint-graph-connection')) return
    event.preventDefault()
    gestureRef.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: viewport.x,
      originY: viewport.y
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    editorRef.current?.focus({ preventScroll: true })
    select(null)
  }

  const handleCanvasPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'pan') {
      setViewport((current) => ({
        ...current,
        x: gesture.originX + event.clientX - gesture.clientX,
        y: gesture.originY + event.clientY - gesture.clientY
      }))
      return
    }
    if (gesture.kind === 'node') {
      publishPositions({
        ...graphPositions,
        [gesture.nodeId]: {
          x: Math.round((gesture.origin.x + (event.clientX - gesture.clientX) / viewport.zoom) * 2) / 2,
          y: Math.round((gesture.origin.y + (event.clientY - gesture.clientY) / viewport.zoom) * 2) / 2
        }
      })
      return
    }
    setCursor(clientToWorld(event.clientX, event.clientY))
  }

  const handleCanvasPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'connect' && event.type === 'pointerup') {
      const hovered = document.elementFromPoint(event.clientX, event.clientY)
      const input = hovered?.closest<HTMLElement>('[data-blueprint-graph-input]')
      const targetId = input?.dataset.blueprintGraphInput
      const toPort = input?.dataset.blueprintGraphInputPort === 'repeat' ? 'repeat' : 'input'
      if (targetId) finishConnection(gesture.sourceId, targetId, toPort)
    }
    gestureRef.current = null
    setCursor(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.target instanceof Element && event.target.closest('input, textarea, select')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const worldX = (localX - viewport.x) / viewport.zoom
    const worldY = (localY - viewport.y) / viewport.zoom
    const nextZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, viewport.zoom * Math.exp(-event.deltaY * 0.0014))
    )
    setViewport({
      zoom: nextZoom,
      x: localX - worldX * nextZoom,
      y: localY - worldY * nextZoom
    })
  }

  const zoomBy = (factor: number): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const worldX = (centerX - viewport.x) / viewport.zoom
    const worldY = (centerY - viewport.y) / viewport.zoom
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor))
    setViewport({
      zoom,
      x: centerX - worldX * zoom,
      y: centerY - worldY * zoom
    })
  }

  const fitView = (): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const points = Object.values(graphPositions)
    if (points.length === 0) return
    const minX = Math.min(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxX = Math.max(
      ...Object.entries(graphPositions).map(([id, point]) =>
        point.x + (id === BLUEPRINT_START_NODE_ID ? START_NODE_WIDTH : NODE_WIDTH)
      )
    )
    const maxY = Math.max(
      ...Object.entries(graphPositions).map(([id, point]) => {
        if (id === BLUEPRINT_START_NODE_ID) return point.y + 110
        const routeCount = graphConnections.filter((connection) => connection.from === id).length
        return point.y + (openRouteEditors[id] ? 500 + routeCount * 118 : 420)
      })
    )
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((rect.width - 88) / width, (rect.height - 88) / height)))
    setViewport({
      zoom,
      x: (rect.width - width * zoom) / 2 - minX * zoom,
      y: (rect.height - height * zoom) / 2 - minY * zoom
    })
  }

  const removeNode = (nodeId: string): void => {
    if (readOnly || nodeId === BLUEPRINT_START_NODE_ID) return
    const nextConnections = graphConnections.filter(
      (connection) => connection.from !== nodeId && connection.to !== nodeId
    )
    const nextPositions = { ...graphPositions }
    delete nextPositions[nodeId]
    onRemoveStep(nodeId)
    onGraphChange({ positions: nextPositions, connections: nextConnections })
    select(null)
  }

  const removeConnection = (connectionIdToRemove: string): void => {
    if (readOnly) return
    publishConnections(
      graphConnections.filter((connection) => connection.id !== connectionIdToRemove)
    )
    if (
      activeSelection?.kind === 'connection' &&
      activeSelection.id === connectionIdToRemove
    ) {
      select(null)
    }
  }

  const removeSelection = (): void => {
    if (readOnly || !activeSelection) return
    if (activeSelection.kind === 'connection') {
      removeConnection(activeSelection.id)
      return
    }
    removeNode(activeSelection.id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      gestureRef.current = null
      setCursor(null)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !isEditableTarget(event.target)) {
      event.preventDefault()
      removeSelection()
    }
  }

  const worldStyle: CSSProperties = {
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
  }
  const canvasStyle = {
    '--blueprint-graph-grid-size': `${GRID_SIZE * viewport.zoom}px`,
    '--blueprint-graph-grid-x': `${viewport.x % (GRID_SIZE * viewport.zoom)}px`,
    '--blueprint-graph-grid-y': `${viewport.y % (GRID_SIZE * viewport.zoom)}px`
  } as CSSProperties
  const connectingSource = gestureRef.current?.kind === 'connect'
    ? gestureRef.current.sourceId
    : null
  const globalRepeatConnection = graphConnections.find(
    (connection) => destinationPort(connection) === 'repeat'
  )
  const repeatConnectionExists = !!globalRepeatConnection

  return (
    <div
      ref={editorRef}
      className={`blueprint-graph-editor${className ? ` ${className}` : ''}`}
      role="application"
      aria-label={labels.ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="blueprint-graph-toolbar" role="toolbar" aria-label={labels.graphTools}>
        <div className="blueprint-graph-add-group">
          <button disabled={readOnly} onClick={() => onAddStep('agent')}>
            <Icon name="users" size={13} /> {labels.addAgent}
          </button>
          <button disabled={readOnly} onClick={() => onAddStep('telegram')}>
            <Icon name="telegram" size={13} /> {labels.addTelegram}
          </button>
          <button disabled={readOnly} onClick={() => onAddStep('delay')}>
            <Icon name="clock" size={13} /> {labels.addDelay}
          </button>
          <button disabled={readOnly} onClick={() => onAddStep('webhook')}>
            <Icon name="webhook" size={13} /> {labels.addWebhook}
          </button>
        </div>
        <div className="blueprint-graph-view-group">
          <button className="icon-only" title={labels.zoomOut} aria-label={labels.zoomOut} onClick={() => zoomBy(0.86)}>−</button>
          <span>{Math.round(viewport.zoom * 100)}%</span>
          <button className="icon-only" title={labels.zoomIn} aria-label={labels.zoomIn} onClick={() => zoomBy(1.16)}>+</button>
          <button className="icon-only" title={labels.fitView} aria-label={labels.fitView} onClick={fitView}>
            <Icon name="collapse" size={13} />
          </button>
        </div>
      </div>

      {selectedConnection && (
        <aside className="blueprint-graph-route-editor" aria-label={labels.route}>
          <div className="blueprint-graph-route-head">
            <div>
              <strong>{labels.route}</strong>
              <span>
                {selectedConnection.from === BLUEPRINT_START_NODE_ID
                  ? labels.start
                  : steps.find((step) => step.id === selectedConnection.from)?.name ?? '—'}
                {' → '}
                {steps.find((step) => step.id === selectedConnection.to)?.name ?? '—'}
              </span>
            </div>
            <button
              title={labels.deleteRoute}
              aria-label={labels.deleteRoute}
              disabled={readOnly}
              onClick={removeSelection}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
          <label>
            <span>{labels.routeCondition}</span>
            <select
              value={selectedConnection.condition?.operator ?? 'always'}
              disabled={readOnly || selectedConnection.from === BLUEPRINT_START_NODE_ID}
              onChange={(event) =>
                updateConnectionCondition(
                  selectedConnection.id,
                  event.target.value as BlueprintConnectionConditionOperator
                )
              }
            >
              {conditionOptions(labels)}
            </select>
          </label>
          {OUTPUT_CONDITION_OPERATORS.has(
            selectedConnection.condition?.operator ?? 'always'
          ) && (
            <>
              <label>
                <span>{labels.routeValue}</span>
                <input
                  value={selectedConnection.condition?.value ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateConnectionCondition(
                      selectedConnection.id,
                      selectedConnection.condition!.operator,
                      { value: event.target.value }
                    )
                  }
                />
              </label>
              <label className="blueprint-graph-route-check">
                <input
                  type="checkbox"
                  checked={selectedConnection.condition?.caseSensitive === true}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateConnectionCondition(
                      selectedConnection.id,
                      selectedConnection.condition!.operator,
                      { caseSensitive: event.target.checked }
                    )
                  }
                />
                <span>{labels.routeCaseSensitive}</span>
              </label>
            </>
          )}
          {destinationPort(selectedConnection) === 'repeat' && (
            <label>
              <span>{labels.iterations}</span>
              <input
                type="number"
                min={2}
                max={20}
                value={selectedConnection.iterations ?? 2}
                disabled={readOnly}
                onChange={(event) =>
                  publishConnections(
                    graphConnections.map((connection) =>
                      connection.id === selectedConnection.id
                        ? {
                            ...connection,
                            iterations: Math.max(
                              2,
                              Math.min(20, Number(event.target.value) || 2)
                            )
                          }
                        : connection
                    )
                  )
                }
              />
            </label>
          )}
        </aside>
      )}

      <div
        ref={viewportRef}
        className={`blueprint-graph-canvas${gestureRef.current?.kind === 'pan' ? ' is-panning' : ''}`}
        style={canvasStyle}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onWheel={handleWheel}
      >
        <div className="blueprint-graph-world" style={worldStyle}>
          <svg className="blueprint-graph-connections" aria-hidden="true">
            {graphConnections.map((connection) => {
              const source = portPoint(connection.from, 'output')
              const toPort = destinationPort(connection)
              const target = portPoint(connection.to, 'input', toPort)
              const selected =
                activeSelection?.kind === 'connection' && activeSelection.id === connection.id
              const path = toPort === 'repeat'
                ? repeatPathBetween(source, target)
                : pathBetween(source, target)
              return (
                <g
                  className={`blueprint-graph-connection${
                    toPort === 'repeat' ? ' repeat' : ''
                  }${connectionConditionClass(connection)}${selected ? ' selected' : ''}${
                    !reachableNodes.has(connection.to) ||
                    (connection.from !== BLUEPRINT_START_NODE_ID && !reachableNodes.has(connection.from))
                      ? ' disconnected'
                      : ''
                  }`}
                  key={connection.id}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    editorRef.current?.focus({ preventScroll: true })
                    select({ kind: 'connection', id: connection.id })
                  }}
                >
                  <path className="blueprint-graph-wire-shadow" d={path} />
                  <path className="blueprint-graph-wire" d={path} />
                  <path className="blueprint-graph-wire-hit" d={path} />
                </g>
              )
            })}
            {connectingSource && cursor && (
              <path
                className="blueprint-graph-wire blueprint-graph-wire-preview"
                d={pathBetween(portPoint(connectingSource, 'output'), cursor)}
              />
            )}
          </svg>

          <article
            className={`blueprint-graph-node blueprint-graph-start${
              activeSelection?.kind === 'node' && activeSelection.id === BLUEPRINT_START_NODE_ID
                ? ' selected'
                : ''
            }`}
            style={{
              left: graphPositions[BLUEPRINT_START_NODE_ID]?.x,
              top: graphPositions[BLUEPRINT_START_NODE_ID]?.y
            }}
            onPointerDown={(event) => {
              if (!isEditableTarget(event.target)) editorRef.current?.focus({ preventScroll: true })
              select({ kind: 'node', id: BLUEPRINT_START_NODE_ID })
            }}
          >
            <div className="blueprint-graph-node-head">
              <button
                className="blueprint-graph-node-drag"
                aria-label={`${labels.moveNode}: ${labels.start}`}
                disabled={readOnly}
                onPointerDown={(event) => startNodeDrag(event, BLUEPRINT_START_NODE_ID)}
              >
                <Icon name="hand" size={12} />
              </button>
              <span className="blueprint-graph-node-icon"><Icon name="play" size={13} /></span>
              <strong>{labels.start}</strong>
            </div>
            <div className="blueprint-graph-exec-row single-output">
              <span>{labels.startHint}</span>
              <button
                className="blueprint-graph-port output"
                title={labels.output}
                disabled={readOnly}
                onPointerDown={(event) => startConnection(event, BLUEPRINT_START_NODE_ID)}
              />
            </div>
          </article>

          {steps.map((step) => {
            const repeatConnection = graphConnections.find(
              (connection) =>
                connection.to === step.id && destinationPort(connection) === 'repeat'
            )
            const outgoingConnections = graphConnections.filter(
              (connection) => connection.from === step.id
            )
            const outgoingCount = outgoingConnections.length
            const routeDraft = routeDrafts[step.id] ?? { targetId: '', toPort: 'input' }
            const routeCandidates = steps.filter((candidate) => {
              if (candidate.id === step.id) return false
              if (
                graphConnections.some(
                  (connection) =>
                    connection.from === step.id &&
                    connection.to === candidate.id &&
                    destinationPort(connection) === routeDraft.toPort
                )
              ) return false
              if (routeDraft.toPort === 'repeat') {
                return !repeatConnectionExists &&
                  hasFlowPath(graphConnections, candidate.id, step.id)
              }
              return !createsCycle(graphConnections, step.id, candidate.id)
            })
            const repeatSourceName = repeatConnectionExists
              ? steps.find((candidate) =>
                  candidate.id === globalRepeatConnection?.from
                )?.name ?? '—'
              : ''
            const repeatTargetName = repeatConnectionExists
              ? steps.find((candidate) =>
                  candidate.id === globalRepeatConnection?.to
                )?.name ?? '—'
              : ''
            return (
              <article
              className={`blueprint-graph-node type-${step.type}${
                activeSelection?.kind === 'node' && activeSelection.id === step.id ? ' selected' : ''
              }${reachableNodes.has(step.id) ? '' : ' disconnected'}`}
              key={step.id}
              style={{ left: graphPositions[step.id]?.x, top: graphPositions[step.id]?.y }}
              onPointerDown={(event) => {
                if (!isEditableTarget(event.target)) editorRef.current?.focus({ preventScroll: true })
                select({ kind: 'node', id: step.id })
              }}
            >
              <div className="blueprint-graph-node-head">
                <button
                  className="blueprint-graph-node-drag"
                  aria-label={`${labels.moveNode}: ${step.name}`}
                  disabled={readOnly}
                  onPointerDown={(event) => startNodeDrag(event, step.id)}
                >
                  <Icon name="hand" size={12} />
                </button>
                <span className="blueprint-graph-node-icon">{stepIcon(step.type)}</span>
                <input
                  value={step.name}
                  aria-label={labels.nodeName}
                  disabled={readOnly}
                  onChange={(event) => onStepChange(step.id, { name: event.target.value })}
                />
                <select
                  value={step.type}
                  aria-label={labels.nodeType}
                  disabled={readOnly}
                  onChange={(event) =>
                    onStepChange(step.id, { type: event.target.value as BlueprintStepType })
                  }
                >
                  <option value="agent">{labels.agent}</option>
                  <option value="telegram">{labels.addTelegram}</option>
                  <option value="delay">{labels.addDelay}</option>
                  <option value="webhook">{labels.addWebhook}</option>
                </select>
              </div>

              <div className="blueprint-graph-exec-row has-repeat-input">
                <button
                  className="blueprint-graph-port input flow-input"
                  data-blueprint-graph-input={step.id}
                  data-blueprint-graph-input-port="input"
                  title={labels.input}
                  disabled={readOnly}
                />
                <button
                  className={`blueprint-graph-port input repeat-input${
                    repeatConnection ? ' connected' : ''
                  }`}
                  data-blueprint-graph-input={step.id}
                  data-blueprint-graph-input-port="repeat"
                  title={labels.repeatInput}
                  disabled={readOnly || (repeatConnectionExists && !repeatConnection)}
                />
                <div className="blueprint-graph-input-labels">
                  <span>{labels.input}</span>
                  <label title={labels.iterations}>
                    <span>{labels.repeatInput}</span>
                    {repeatConnection && (
                      <>
                        <b>×</b>
                        <input
                          type="number"
                          min={2}
                          max={20}
                          value={repeatConnection.iterations ?? 2}
                          disabled={readOnly}
                          aria-label={labels.iterations}
                          onChange={(event) =>
                            publishConnections(
                              graphConnections.map((connection) =>
                                connection.id === repeatConnection.id
                                  ? {
                                      ...connection,
                                      iterations: Math.max(
                                        2,
                                        Math.min(20, Number(event.target.value) || 2)
                                      )
                                    }
                                  : connection
                              )
                            )
                          }
                        />
                      </>
                    )}
                  </label>
                </div>
                <i />
                <span>
                  {labels.routes}{outgoingCount > 0 ? ` ×${outgoingCount}` : ''}
                </span>
                <button
                  className="blueprint-graph-port output"
                  title={labels.routes}
                  disabled={readOnly}
                  onPointerDown={(event) => startConnection(event, step.id)}
                />
              </div>

              <div className="blueprint-graph-node-body">
                {step.type === 'agent' && (
                  <>
                    <label>
                      <span>{labels.agent}</span>
                      <select
                        value={step.agentId ?? ''}
                        disabled={readOnly}
                        onChange={(event) => onStepChange(step.id, { agentId: event.target.value })}
                      >
                        <option value="">—</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{labels.prompt}</span>
                      <textarea
                        value={step.prompt ?? ''}
                        disabled={readOnly}
                        onChange={(event) => onStepChange(step.id, { prompt: event.target.value })}
                      />
                    </label>
                  </>
                )}

                {step.type === 'telegram' && (
                  <>
                    <div className="blueprint-graph-field-pair">
                      <label>
                        <span>{labels.botToken}</span>
                        <input
                          type="password"
                          value={step.telegramBotToken ?? ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            onStepChange(step.id, { telegramBotToken: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>{labels.chatId}</span>
                        <input
                          value={step.telegramChatId ?? ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            onStepChange(step.id, { telegramChatId: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      <span>{labels.message}</span>
                      <textarea
                        value={step.message ?? ''}
                        disabled={readOnly}
                        onChange={(event) => onStepChange(step.id, { message: event.target.value })}
                      />
                    </label>
                  </>
                )}

                {step.type === 'delay' && (
                  <label>
                    <span>{labels.delaySeconds}</span>
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      value={step.delaySeconds ?? 1}
                      disabled={readOnly}
                      onChange={(event) =>
                        onStepChange(step.id, {
                          delaySeconds: Math.max(0, Number(event.target.value) || 0)
                        })
                      }
                    />
                  </label>
                )}

                {step.type === 'webhook' && (
                  <>
                    <div className="blueprint-graph-field-pair webhook">
                      <label className="url-field">
                        <span>URL</span>
                        <input
                          value={step.webhookUrl ?? ''}
                          placeholder="https://example.com/hook"
                          disabled={readOnly}
                          onChange={(event) =>
                            onStepChange(step.id, { webhookUrl: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>{labels.method}</span>
                        <select
                          value={step.webhookMethod ?? 'POST'}
                          disabled={readOnly}
                          onChange={(event) =>
                            onStepChange(step.id, {
                              webhookMethod: event.target.value as 'POST' | 'PUT' | 'PATCH'
                            })
                          }
                        >
                          <option>POST</option>
                          <option>PUT</option>
                          <option>PATCH</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      <span>{labels.headers}</span>
                      <textarea
                        value={step.webhookHeaders ?? ''}
                        disabled={readOnly}
                        onChange={(event) =>
                          onStepChange(step.id, { webhookHeaders: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>{labels.body}</span>
                      <textarea
                        value={step.webhookBody ?? ''}
                        disabled={readOnly}
                        onChange={(event) =>
                          onStepChange(step.id, { webhookBody: event.target.value })
                        }
                      />
                    </label>
                  </>
                )}

                <section
                  className={`blueprint-graph-routes${openRouteEditors[step.id] ? ' open' : ' collapsed'}`}
                  aria-label={`${labels.routes}: ${step.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="blueprint-graph-routes-toggle"
                    aria-expanded={openRouteEditors[step.id] === true}
                    onClick={() =>
                      setOpenRouteEditors((current) => ({
                        ...current,
                        [step.id]: !current[step.id]
                      }))
                    }
                  >
                    <Icon
                      name={openRouteEditors[step.id] ? 'chevronDown' : 'chevronRight'}
                      size={11}
                    />
                    <strong>{labels.routes}</strong>
                    <span>{outgoingCount}</span>
                  </button>

                  {outgoingConnections.length === 0 && (
                    <div className="blueprint-graph-routes-empty">{labels.routeEmpty}</div>
                  )}

                  {outgoingConnections.map((connection) => {
                    const operator = connection.condition?.operator ?? 'always'
                    const targetName = steps.find(
                      (candidate) => candidate.id === connection.to
                    )?.name ?? '—'
                    return (
                      <div
                        className={`blueprint-graph-route-card${connectionConditionClass(connection)}`}
                        key={connection.id}
                      >
                        <div className="blueprint-graph-route-card-head">
                          <button
                            className="blueprint-graph-route-target"
                            title={`${labels.route}: ${step.name} → ${targetName}`}
                            onClick={() => select({ kind: 'connection', id: connection.id })}
                          >
                            <span>→</span>{targetName}
                          </button>
                          {destinationPort(connection) === 'repeat' && (
                            <label className="blueprint-graph-route-passes">
                              {labels.routeRepeat}
                              <input
                                type="number"
                                min={2}
                                max={20}
                                value={connection.iterations ?? 2}
                                disabled={readOnly}
                                aria-label={labels.iterations}
                                onChange={(event) =>
                                  publishConnections(
                                    graphConnections.map((candidate) =>
                                      candidate.id === connection.id
                                        ? {
                                            ...candidate,
                                            iterations: Math.max(
                                              2,
                                              Math.min(20, Number(event.target.value) || 2)
                                            )
                                          }
                                        : candidate
                                    )
                                  )
                                }
                              />
                            </label>
                          )}
                          <button
                            className="blueprint-graph-route-delete"
                            title={labels.deleteRoute}
                            aria-label={`${labels.deleteRoute}: ${targetName}`}
                            disabled={readOnly}
                            onClick={() => removeConnection(connection.id)}
                          >
                            <Icon name="trash" size={11} />
                          </button>
                        </div>

                        <label>
                          <span>{labels.routeCondition}</span>
                          <select
                            value={operator}
                            disabled={readOnly}
                            onChange={(event) =>
                              updateConnectionCondition(
                                connection.id,
                                event.target.value as BlueprintConnectionConditionOperator
                              )
                            }
                          >
                            {conditionOptions(labels)}
                          </select>
                        </label>

                        {OUTPUT_CONDITION_OPERATORS.has(operator) && (
                          <div className="blueprint-graph-route-value-row">
                            <label>
                              <span>{labels.routeValue}</span>
                              <input
                                value={connection.condition?.value ?? ''}
                                placeholder="RESULT=PASS"
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateConnectionCondition(connection.id, operator, {
                                    value: event.target.value
                                  })
                                }
                              />
                            </label>
                            <label className="blueprint-graph-route-inline-check">
                              <input
                                type="checkbox"
                                checked={connection.condition?.caseSensitive === true}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateConnectionCondition(connection.id, operator, {
                                    caseSensitive: event.target.checked
                                  })
                                }
                              />
                              <span>{labels.routeCaseSensitive}</span>
                            </label>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <div className="blueprint-graph-route-builder">
                    <select
                      aria-label={labels.routeKind}
                      value={routeDraft.toPort}
                      disabled={readOnly}
                      onChange={(event) =>
                        setRouteDrafts((current) => ({
                          ...current,
                          [step.id]: {
                            targetId: '',
                            toPort: event.target.value as DestinationPort
                          }
                        }))
                      }
                    >
                      <option value="input">{labels.routeFlow}</option>
                      <option value="repeat">{labels.routeRepeat}</option>
                    </select>
                    <select
                      aria-label={labels.routeTarget}
                      value={routeDraft.targetId}
                      disabled={readOnly || (routeDraft.toPort === 'repeat' && repeatConnectionExists)}
                      onChange={(event) =>
                        setRouteDrafts((current) => ({
                          ...current,
                          [step.id]: { ...routeDraft, targetId: event.target.value }
                        }))
                      }
                    >
                      <option value="">{labels.routeTarget}…</option>
                      {routeCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                      ))}
                    </select>
                    <button
                      disabled={readOnly || !routeDraft.targetId}
                      onClick={() => {
                        if (!routeDraft.targetId) return
                        finishConnection(step.id, routeDraft.targetId, routeDraft.toPort)
                        setRouteDrafts((current) => ({
                          ...current,
                          [step.id]: { ...routeDraft, targetId: '' }
                        }))
                      }}
                    >
                      + {labels.addRoute}
                    </button>
                  </div>
                  {routeDraft.toPort === 'repeat' && repeatConnectionExists ? (
                    <div className="blueprint-graph-route-notice warning">
                      {labels.routeRepeatOccupied} {repeatSourceName} → {repeatTargetName}
                    </div>
                  ) : routeDraft.toPort === 'repeat' && routeCandidates.length === 0 ? (
                    <div className="blueprint-graph-route-notice">
                      {labels.routeRepeatNeedsPath}
                    </div>
                  ) : null}
                  <small>{labels.routeHelp}</small>
                </section>
              </div>

              <div className="blueprint-graph-node-foot">
                <label>
                  {labels.repeat}
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={step.repeat ?? 1}
                    disabled={readOnly}
                    onChange={(event) =>
                      onStepChange(step.id, {
                        repeat: Math.max(1, Math.min(20, Number(event.target.value) || 1))
                      })
                    }
                  />
                </label>
                {step.type === 'agent' && (
                  <label className="agent-mode-option">
                    <input
                      type="checkbox"
                      checked={step.agentMode === true}
                      disabled={readOnly}
                      onChange={(event) =>
                        onStepChange(step.id, { agentMode: event.target.checked })
                      }
                    />
                    {labels.agentMode}
                  </label>
                )}
                <label className="continue-option">
                  <input
                    type="checkbox"
                    checked={step.continueOnError === true}
                    disabled={readOnly}
                    onChange={(event) =>
                      onStepChange(step.id, { continueOnError: event.target.checked })
                    }
                  />
                  {labels.continueOnError}
                </label>
                <button
                  className="blueprint-graph-delete"
                  title={labels.deleteNode}
                  disabled={readOnly}
                  onClick={() => removeNode(step.id)}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
              </article>
            )
          })}
        </div>

        {steps.length === 0 && (
          <div className="blueprint-graph-empty">
            <Icon name="blueprint" size={24} />
            <span>{labels.empty}</span>
          </div>
        )}
      </div>
    </div>
  )
}
