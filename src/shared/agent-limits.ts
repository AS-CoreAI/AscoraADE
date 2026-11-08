export const AGENT_STEP_LIMIT_SETTING = 'agent.stepLimit'

export interface AgentStepLimit {
  enabled: boolean
  maxSteps: number
}

export const DEFAULT_AGENT_STEP_LIMIT: AgentStepLimit = { enabled: false, maxSteps: 16 }

export function normalizeAgentStepLimit(value: unknown): AgentStepLimit {
  const saved = value && typeof value === 'object' ? value as Partial<AgentStepLimit> : {}
  return {
    enabled: saved.enabled === true,
    maxSteps: typeof saved.maxSteps === 'number' && Number.isSafeInteger(saved.maxSteps) && saved.maxSteps > 0
      ? saved.maxSteps : DEFAULT_AGENT_STEP_LIMIT.maxSteps
  }
}
