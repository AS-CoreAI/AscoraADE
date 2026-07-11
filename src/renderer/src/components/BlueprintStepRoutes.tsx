import { useMemo, useState, type JSX } from 'react'
import {
  type BlueprintConnection,
  type BlueprintConnectionCondition,
  type BlueprintConnectionConditionOperator,
  type BlueprintStep
} from '@shared/ipc'
import { Icon } from './Icon'

export interface BlueprintRoutesLabels {
  routes: string
  route: string
  routeCondition: string
  routeAlways: string
  routeOtherwise: string
  routeSucceeded: string
  routeFailed: string
  routeContains: string
  routeNotContains: string
  routeEquals: string
  routeNotEquals: string
  routeValue: string
  routeCaseSensitive: string
  deleteRoute: string
  addRoute: string
  routeTarget: string
  routeKind: string
  routeFlow: string
  routeRepeat: string
  routeEmpty: string
  routeHelp: string
  routeRepeatOccupied: string
  routeRepeatNeedsPath: string
  iterations: string
}

interface BlueprintStepRoutesProps {
  step: BlueprintStep
  steps: BlueprintStep[]
  connections: BlueprintConnection[]
  labels: BlueprintRoutesLabels
  onConnectionsChange: (connections: BlueprintConnection[]) => void
  onSelectConnection?: (connectionId: string) => void
  readOnly?: boolean
  className?: string
}

type DestinationPort = 'input' | 'repeat'
type RouteDraft = { targetId: string; toPort: DestinationPort }

const OUTPUT_OPERATORS = new Set<BlueprintConnectionConditionOperator>([
  'contains',
  'not_contains',
  'equals',
  'not_equals'
])

function destinationPort(connection: BlueprintConnection): DestinationPort {
  return connection.toPort === 'repeat' ? 'repeat' : 'input'
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

function conditionOptions(labels: BlueprintRoutesLabels): JSX.Element {
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

function conditionClass(connection: BlueprintConnection): string {
  const operator = connection.condition?.operator ?? 'always'
  if (operator === 'failed') return ' when-failed'
  if (operator === 'succeeded') return ' when-succeeded'
  if (operator === 'otherwise') return ' when-otherwise'
  if (operator !== 'always') return ' when-output'
  return ''
}

export function BlueprintStepRoutes({
  step,
  steps,
  connections,
  labels,
  onConnectionsChange,
  onSelectConnection,
  readOnly = false,
  className
}: BlueprintStepRoutesProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<RouteDraft>({ targetId: '', toPort: 'input' })
  const outgoing = useMemo(
    () => connections.filter((connection) => connection.from === step.id),
    [connections, step.id]
  )
  const repeatConnection = connections.find(
    (connection) => destinationPort(connection) === 'repeat'
  )
  const repeatSourceName = repeatConnection
    ? steps.find((candidate) => candidate.id === repeatConnection.from)?.name ?? '—'
    : ''
  const repeatTargetName = repeatConnection
    ? steps.find((candidate) => candidate.id === repeatConnection.to)?.name ?? '—'
    : ''
  const candidates = steps.filter((candidate) => {
    if (candidate.id === step.id) return false
    if (
      connections.some(
        (connection) =>
          connection.from === step.id &&
          connection.to === candidate.id &&
          destinationPort(connection) === draft.toPort
      )
    ) return false
    if (draft.toPort === 'repeat') {
      return !repeatConnection && hasFlowPath(connections, candidate.id, step.id)
    }
    return !createsCycle(connections, step.id, candidate.id)
  })

  const publishCondition = (
    connectionId: string,
    operator: BlueprintConnectionConditionOperator,
    patch: Partial<BlueprintConnectionCondition> = {}
  ): void => {
    onConnectionsChange(
      connections.map((connection) => {
        if (connection.id !== connectionId) return connection
        if (operator === 'always') return { ...connection, condition: undefined }
        return {
          ...connection,
          condition: {
            operator,
            ...(OUTPUT_OPERATORS.has(operator)
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
  }

  const addRoute = (): void => {
    if (!draft.targetId || readOnly) return
    if (draft.toPort === 'repeat' && repeatConnection) return
    if (draft.toPort === 'input' && createsCycle(connections, step.id, draft.targetId)) return
    if (
      draft.toPort === 'repeat' &&
      !hasFlowPath(connections, draft.targetId, step.id)
    ) return
    const connection: BlueprintConnection = {
      id: crypto.randomUUID(),
      from: step.id,
      to: draft.targetId,
      ...(draft.toPort === 'repeat' ? { toPort: 'repeat', iterations: 2 } : {})
    }
    onConnectionsChange([...connections, connection])
    setDraft((current) => ({ ...current, targetId: '' }))
    onSelectConnection?.(connection.id)
  }

  return (
    <section
      className={`blueprint-graph-routes${open ? ' open' : ' collapsed'}${className ? ` ${className}` : ''}`}
      aria-label={`${labels.routes}: ${step.name}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="blueprint-graph-routes-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
        <strong>{labels.routes}</strong>
        <span>{outgoing.length}</span>
      </button>

      {open && (
        <div className="blueprint-graph-routes-content">
          {outgoing.length === 0 && (
            <div className="blueprint-graph-routes-empty">{labels.routeEmpty}</div>
          )}

          {outgoing.map((connection) => {
            const operator = connection.condition?.operator ?? 'always'
            const targetName = steps.find((candidate) => candidate.id === connection.to)?.name ?? '—'
            return (
              <div className={`blueprint-graph-route-card${conditionClass(connection)}`} key={connection.id}>
                <div className="blueprint-graph-route-card-head">
                  {onSelectConnection ? (
                    <button
                      className="blueprint-graph-route-target"
                      type="button"
                      title={`${labels.route}: ${step.name} → ${targetName}`}
                      onClick={() => onSelectConnection(connection.id)}
                    >
                      <span>→</span>{targetName}
                    </button>
                  ) : (
                    <div className="blueprint-graph-route-target">
                      <span>→</span>{targetName}
                    </div>
                  )}
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
                          onConnectionsChange(
                            connections.map((candidate) =>
                              candidate.id === connection.id
                                ? {
                                    ...candidate,
                                    iterations: Math.max(2, Math.min(20, Number(event.target.value) || 2))
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
                    type="button"
                    title={labels.deleteRoute}
                    aria-label={`${labels.deleteRoute}: ${targetName}`}
                    disabled={readOnly}
                    onClick={() =>
                      onConnectionsChange(
                        connections.filter((candidate) => candidate.id !== connection.id)
                      )
                    }
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
                      publishCondition(
                        connection.id,
                        event.target.value as BlueprintConnectionConditionOperator
                      )
                    }
                  >
                    {conditionOptions(labels)}
                  </select>
                </label>

                {OUTPUT_OPERATORS.has(operator) && (
                  <div className="blueprint-graph-route-value-row">
                    <label>
                      <span>{labels.routeValue}</span>
                      <input
                        value={connection.condition?.value ?? ''}
                        placeholder="RESULT=PASS"
                        disabled={readOnly}
                        onChange={(event) =>
                          publishCondition(connection.id, operator, { value: event.target.value })
                        }
                      />
                    </label>
                    <label className="blueprint-graph-route-inline-check">
                      <input
                        type="checkbox"
                        checked={connection.condition?.caseSensitive === true}
                        disabled={readOnly}
                        onChange={(event) =>
                          publishCondition(connection.id, operator, {
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
              value={draft.toPort}
              disabled={readOnly}
              onChange={(event) =>
                setDraft({ targetId: '', toPort: event.target.value as DestinationPort })
              }
            >
              <option value="input">{labels.routeFlow}</option>
              <option value="repeat">{labels.routeRepeat}</option>
            </select>
            <select
              aria-label={labels.routeTarget}
              value={draft.targetId}
              disabled={readOnly || (draft.toPort === 'repeat' && !!repeatConnection)}
              onChange={(event) => setDraft((current) => ({ ...current, targetId: event.target.value }))}
            >
              <option value="">{labels.routeTarget}…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
            <button type="button" disabled={readOnly || !draft.targetId} onClick={addRoute}>
              + {labels.addRoute}
            </button>
          </div>

          {draft.toPort === 'repeat' && repeatConnection ? (
            <div className="blueprint-graph-route-notice warning">
              {labels.routeRepeatOccupied} {repeatSourceName} → {repeatTargetName}
            </div>
          ) : draft.toPort === 'repeat' && candidates.length === 0 ? (
            <div className="blueprint-graph-route-notice">{labels.routeRepeatNeedsPath}</div>
          ) : null}
          <small>{labels.routeHelp}</small>
        </div>
      )}
    </section>
  )
}
