import {
  BLUEPRINT_START_NODE_ID,
  type BlueprintConnection,
  type BlueprintConnectionCondition,
  type BlueprintConnectionConditionOperator,
  type BlueprintDefinition,
  type BlueprintGraph,
  type BlueprintStep
} from '@shared/ipc'

export interface CompiledBlueprintExecution {
  step: BlueprintStep
  /** Zero for ordinary actions; one-based for actions inside a Repeat body. */
  iteration: number
}

export interface CompiledBlueprintGraph {
  connections: BlueprintConnection[]
  repeatConnection?: BlueprintConnection
  repeatBody: Set<string>
}

export interface CompiledBlueprint {
  steps: BlueprintStep[]
  executions: CompiledBlueprintExecution[]
  ancestors: Map<string, Set<string>> | null
  predecessors: Map<string, string[]> | null
  graph: CompiledBlueprintGraph | null
}

export interface BlueprintRouteResult {
  status: 'completed' | 'failed'
  output?: string
  error?: string
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
const MIN_REPEAT_ITERATIONS = 2
const MAX_REPEAT_ITERATIONS = 20
const MAX_STEP_REPEAT = 20
const MAX_ACTION_ATTEMPTS = 2_000
const MAX_CONDITION_VALUE = 4_000
const CONDITION_OPERATORS: BlueprintConnectionConditionOperator[] = [
  'always',
  'otherwise',
  'succeeded',
  'failed',
  'contains',
  'not_contains',
  'equals',
  'not_equals'
]
const OUTPUT_CONDITION_OPERATORS = new Set<BlueprintConnectionConditionOperator>([
  'contains',
  'not_contains',
  'equals',
  'not_equals'
])

const boundedInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Math.round(Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback)
}

const repeatIterations = (value: unknown): number =>
  boundedInteger(value, MIN_REPEAT_ITERATIONS, MIN_REPEAT_ITERATIONS, MAX_REPEAT_ITERATIONS)

const stepAttempts = (step: BlueprintStep): number =>
  boundedInteger(step.repeat, 1, 1, MAX_STEP_REPEAT)

function assertActionAttemptLimit(attempts: number): void {
  if (attempts <= MAX_ACTION_ATTEMPTS) return
  throw new Error(
    `The Blueprint graph would run ${attempts} action attempts; the limit is ${MAX_ACTION_ATTEMPTS}.`
  )
}

function inclusiveClosure(start: string, adjacency: Map<string, string[]>): Set<string> {
  const result = new Set<string>([start])
  const pending = [start]
  while (pending.length > 0) {
    for (const next of adjacency.get(pending.pop()!) ?? []) {
      if (result.has(next)) continue
      result.add(next)
      pending.push(next)
    }
  }
  return result
}

function normalizeConnectionCondition(value: unknown): BlueprintConnectionCondition | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') {
    return { operator: '' as BlueprintConnectionConditionOperator }
  }
  const candidate = value as Partial<BlueprintConnectionCondition>
  return {
    operator: asText(candidate.operator) as BlueprintConnectionConditionOperator,
    value: asText(candidate.value).slice(0, MAX_CONDITION_VALUE),
    caseSensitive: candidate.caseSensitive === true
  }
}

function conditionOperator(connection: BlueprintConnection): BlueprintConnectionConditionOperator {
  return connection.condition?.operator ?? 'always'
}

function validateConnectionCondition(connection: BlueprintConnection): void {
  const operator = conditionOperator(connection)
  if (!CONDITION_OPERATORS.includes(operator)) {
    throw new Error(`A Blueprint connection has an invalid route condition: ${operator || '(empty)'}.`)
  }
  if (
    connection.from === BLUEPRINT_START_NODE_ID &&
    connection.condition &&
    operator !== 'always'
  ) {
    throw new Error('Connections from Start must be unconditional.')
  }
  if (OUTPUT_CONDITION_OPERATORS.has(operator) && !connection.condition?.value?.trim()) {
    throw new Error('Enter comparison text for every output route condition.')
  }
}

/** Test whether an executed source action activates a graph connection. */
export function matchesBlueprintConnection(
  connection: BlueprintConnection,
  result: BlueprintRouteResult
): boolean {
  const condition = connection.condition
  const operator = condition?.operator ?? 'always'
  if (operator === 'always') return true
  if (operator === 'otherwise') return false
  if (operator === 'succeeded') return result.status === 'completed'
  if (operator === 'failed') return result.status === 'failed'
  if (result.status !== 'completed') return false

  const caseSensitive = condition?.caseSensitive === true
  const normalize = (value: string): string => (caseSensitive ? value : value.toLowerCase())
  const output = normalize(result.output ?? '')
  const expected = normalize(condition?.value ?? '')
  if (operator === 'contains') return output.includes(expected)
  if (operator === 'not_contains') return !output.includes(expected)
  if (operator === 'equals') return output.trim() === expected.trim()
  if (operator === 'not_equals') return output.trim() !== expected.trim()
  return false
}

/**
 * Return every activated route. `otherwise` is a fallback group: all fallback
 * routes activate only when no ordinary route from the same source matched.
 */
export function matchingBlueprintConnections(
  connections: BlueprintConnection[],
  result: BlueprintRouteResult
): BlueprintConnection[] {
  const unconditional = connections.filter(
    (connection) => (connection.condition?.operator ?? 'always') === 'always'
  )
  const matched = connections.filter((connection) => {
    const operator = connection.condition?.operator ?? 'always'
    return operator !== 'always' &&
      operator !== 'otherwise' &&
      matchesBlueprintConnection(connection, result)
  })
  const branch = matched.length > 0
    ? matched
    : connections.filter((connection) => connection.condition?.operator === 'otherwise')
  return [...unconditional, ...branch]
}

/** Preserve graph mode whenever the field exists; malformed graphs fail closed. */
export function normalizeBlueprintGraph(
  value: Partial<BlueprintGraph> | undefined,
  steps: BlueprintStep[]
): BlueprintGraph | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') return { positions: {}, connections: [] }
  const stepIds = new Set(steps.map((step) => step.id))
  const allowedPositionIds = new Set([BLUEPRINT_START_NODE_ID, ...stepIds])
  const positions = Object.fromEntries(
    Object.entries(value.positions ?? {}).flatMap(([id, position]) => {
      if (!allowedPositionIds.has(id) || !position || typeof position !== 'object') return []
      const x = Number(position.x)
      const y = Number(position.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return []
      return [
        [
          id,
          {
            x: Math.max(-100_000, Math.min(100_000, x)),
            y: Math.max(-100_000, Math.min(100_000, y))
          }
        ]
      ]
    })
  )
  const connections = (Array.isArray(value.connections) ? value.connections : []).flatMap(
    (candidate, index) => {
      if (!candidate || typeof candidate !== 'object') return []
      const from = asText(candidate.from)
      const to = asText(candidate.to)
      const id = asText(candidate.id) || `connection:${index}:${from}:${to}`
      const condition = normalizeConnectionCondition(candidate.condition)
      if (candidate.toPort === 'repeat') {
        return [
          {
            id,
            from,
            to,
            toPort: 'repeat' as const,
            iterations: repeatIterations(candidate.iterations),
            ...(condition ? { condition } : {})
          }
        ]
      }
      return [{ id, from, to, ...(condition ? { condition } : {}) }]
    }
  )
  return { positions, connections }
}

/** Validate and compile a legacy sequence or a dependency graph with one bounded repeat path. */
export function compileBlueprint(blueprint: BlueprintDefinition): CompiledBlueprint {
  if (!blueprint.graph) {
    return {
      steps: blueprint.steps,
      executions: blueprint.steps.map((step) => ({ step, iteration: 0 })),
      ancestors: null,
      predecessors: null,
      graph: null
    }
  }

  const stepById = new Map<string, BlueprintStep>()
  const order = new Map<string, number>()
  blueprint.steps.forEach((step, index) => {
    if (step.id === BLUEPRINT_START_NODE_ID) {
      throw new Error(`The step id ${BLUEPRINT_START_NODE_ID} is reserved by the Blueprint graph.`)
    }
    if (stepById.has(step.id)) {
      throw new Error(`The Blueprint graph has a duplicate step id: ${step.id}.`)
    }
    stepById.set(step.id, step)
    order.set(step.id, index)
  })

  const adjacency = new Map<string, string[]>()
  const reverseAdjacency = new Map<string, string[]>()
  const indegree = new Map(blueprint.steps.map((step) => [step.id, 0]))
  const edgeIds = new Set<string>()
  const pairs = new Set<string>()
  const entryTargets: string[] = []
  const flowConnections: BlueprintConnection[] = []
  let repeatConnection: BlueprintConnection | undefined

  for (const connection of blueprint.graph.connections) {
    if (edgeIds.has(connection.id)) {
      throw new Error(`The Blueprint graph has a duplicate connection id: ${connection.id}.`)
    }
    edgeIds.add(connection.id)
    validateConnectionCondition(connection)
    if (connection.from !== BLUEPRINT_START_NODE_ID && !stepById.has(connection.from)) {
      throw new Error(`A Blueprint connection starts at a missing step: ${connection.from}.`)
    }
    if (!stepById.has(connection.to)) {
      throw new Error(`A Blueprint connection points to a missing step: ${connection.to}.`)
    }
    if (connection.from === connection.to) {
      throw new Error('A Blueprint node cannot connect to itself.')
    }
    const pair = `${connection.from}\0${connection.to}`
    if (pairs.has(pair)) throw new Error('The Blueprint graph contains a duplicate connection.')
    pairs.add(pair)
    if (connection.toPort === 'repeat') {
      if (repeatConnection) {
        throw new Error('The Blueprint graph can contain only one repeat connection.')
      }
      if (connection.from === BLUEPRINT_START_NODE_ID) {
        throw new Error('A repeat connection must start at an action node.')
      }
      repeatConnection = connection
      continue
    }
    flowConnections.push(connection)
    if (connection.from === BLUEPRINT_START_NODE_ID) {
      entryTargets.push(connection.to)
      continue
    }
    const targets = adjacency.get(connection.from) ?? []
    targets.push(connection.to)
    adjacency.set(connection.from, targets)
    const sources = reverseAdjacency.get(connection.to) ?? []
    sources.push(connection.from)
    reverseAdjacency.set(connection.to, sources)
    indegree.set(connection.to, (indegree.get(connection.to) ?? 0) + 1)
  }

  const byStepOrder = (left: string, right: string): number =>
    (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right) ?? Number.MAX_SAFE_INTEGER)
  const queue = blueprint.steps
    .filter((step) => (indegree.get(step.id) ?? 0) === 0)
    .map((step) => step.id)
    .sort(byStepOrder)
  const topological: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    topological.push(id)
    for (const target of adjacency.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) {
        queue.push(target)
        queue.sort(byStepOrder)
      }
    }
  }
  if (topological.length !== blueprint.steps.length) {
    throw new Error('The Blueprint graph contains a cycle. Remove a connection before running it.')
  }

  // Incoming action edges are AND dependencies. A node becomes executable only
  // when it is connected to Start (directly or through predecessors) and every
  // action feeding it is itself executable.
  const entryTargetSet = new Set(entryTargets)
  const reachable = new Set<string>()
  for (const id of topological) {
    const predecessors = reverseAdjacency.get(id) ?? []
    const connected = entryTargetSet.has(id) || predecessors.length > 0
    if (connected && predecessors.every((predecessor) => reachable.has(predecessor))) {
      reachable.add(id)
    }
  }

  const compiled = topological.flatMap((id) =>
    reachable.has(id) ? [stepById.get(id)!] : []
  )
  if (compiled.length === 0) {
    throw new Error('Connect Start to at least one action before running the Blueprint graph.')
  }

  const predecessors = new Map<string, string[]>()
  const ancestors = new Map<string, Set<string>>()
  for (const step of compiled) {
    const direct = (reverseAdjacency.get(step.id) ?? []).filter((id) => reachable.has(id))
    predecessors.set(step.id, direct)
    const inherited = new Set<string>()
    for (const predecessor of direct) {
      inherited.add(predecessor)
      for (const ancestor of ancestors.get(predecessor) ?? []) inherited.add(ancestor)
    }
    ancestors.set(step.id, inherited)
  }

  let executionSteps = compiled
  let estimatedAttempts = compiled.reduce((total, step) => total + stepAttempts(step), 0)
  if (repeatConnection) {
    const repeatSource = repeatConnection.from
    const repeatTarget = repeatConnection.to
    if (!reachable.has(repeatSource) || !reachable.has(repeatTarget)) {
      throw new Error('Both ends of a repeat connection must be reachable from Start.')
    }

    const descendants = inclusiveClosure(repeatTarget, adjacency)
    if (!descendants.has(repeatSource)) {
      throw new Error('A repeat connection must return to the start of an existing flow path.')
    }
    const sourceAncestors = inclusiveClosure(repeatSource, reverseAdjacency)
    const body = new Set([...descendants].filter((id) => sourceAncestors.has(id)))

    for (const connection of flowConnections) {
      const fromInBody = body.has(connection.from)
      const toInBody = body.has(connection.to)
      if (!fromInBody && toInBody && connection.to !== repeatTarget) {
        throw new Error(
          'A repeat body cannot have an incoming connection except at its repeat target.'
        )
      }
      // Outgoing routes from any body action are valid. They are evaluated
      // after the bounded feedback body finishes, against that action's most
      // recent result. This enables Review -> Fix -> Review with success routes
      // leaving Review for deploy/notification actions.
    }

    // The repeat source is the most recent predecessor when the target starts
    // its second and subsequent passes. On the first pass the ordinary flow
    // predecessors still provide the input.
    const targetPredecessors = predecessors.get(repeatTarget) ?? []
    if (!targetPredecessors.includes(repeatSource)) targetPredecessors.push(repeatSource)
    predecessors.set(repeatTarget, targetPredecessors)

    // Runtime context is keyed by stable step ids. Giving every body action the
    // complete body as contextual ancestors exposes results from earlier passes
    // without manufacturing per-iteration step ids.
    for (const id of body) {
      const contextualAncestors = ancestors.get(id) ?? new Set<string>()
      for (const bodyId of body) {
        if (bodyId !== id) contextualAncestors.add(bodyId)
      }
      ancestors.set(id, contextualAncestors)
    }

    const bodySteps = compiled.filter((step) => body.has(step.id))
    const iterations = repeatIterations(repeatConnection.iterations)
    const bodyAttempts = bodySteps.reduce((total, step) => total + stepAttempts(step), 0)
    estimatedAttempts += bodyAttempts * (iterations - 1)
    assertActionAttemptLimit(estimatedAttempts)
    const expanded: BlueprintStep[] = []
    const expandedExecutions: CompiledBlueprintExecution[] = []
    let insertedBody = false
    for (const step of compiled) {
      if (!body.has(step.id)) {
        expanded.push(step)
        expandedExecutions.push({ step, iteration: 0 })
        continue
      }
      if (insertedBody) continue
      insertedBody = true
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        expanded.push(...bodySteps)
        expandedExecutions.push(...bodySteps.map((bodyStep) => ({ step: bodyStep, iteration })))
      }
    }
    executionSteps = expanded
    assertActionAttemptLimit(estimatedAttempts)
    return {
      steps: executionSteps,
      executions: expandedExecutions,
      ancestors,
      predecessors,
      graph: {
        connections: blueprint.graph.connections,
        repeatConnection,
        repeatBody: body
      }
    }
  }

  assertActionAttemptLimit(estimatedAttempts)

  return {
    steps: executionSteps,
    executions: executionSteps.map((step) => ({ step, iteration: 0 })),
    ancestors,
    predecessors,
    graph: {
      connections: blueprint.graph.connections,
      repeatConnection,
      repeatBody: new Set()
    }
  }
}
