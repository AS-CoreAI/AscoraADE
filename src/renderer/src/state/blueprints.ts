import { create } from 'zustand'
import type {
  BlueprintAgent,
  BlueprintDefinition,
  BlueprintEvent,
  BlueprintRunSummary,
  BlueprintStep,
  WProviderService
} from '@shared/ipc'
import { api } from '@/lib/api'

export type BlueprintTemplate = 'team' | 'telegram'

interface BlueprintState {
  items: BlueprintDefinition[]
  activeId: string | null
  runs: Record<string, BlueprintRunSummary>
  deltas: Record<string, string>
  loaded: boolean
  loading: boolean
  error: string | null
  /** Incremented whenever the dock panel should open/focus. */
  openRequest: number
  init: () => Promise<void>
  open: (id?: string | null) => void
  createBlueprint: (
    template?: BlueprintTemplate,
    service?: WProviderService
  ) => Promise<BlueprintDefinition>
  saveBlueprint: (blueprint: BlueprintDefinition) => Promise<BlueprintDefinition>
  removeBlueprint: (id: string) => Promise<void>
  runBlueprint: (id: string, input: string) => Promise<void>
  stopBlueprint: (id: string) => Promise<void>
  clearError: () => void
}

let unsubscribeEvents: (() => void) | null = null

function newAgent(
  name: string,
  role: string,
  instructions: string,
  service: WProviderService
): BlueprintAgent {
  return { id: crypto.randomUUID(), name, role, instructions, service, enabled: true }
}

function agentStep(name: string, agentId: string, prompt: string): BlueprintStep {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'agent',
    agentId,
    prompt,
    agentMode: false,
    repeat: 1,
    continueOnError: false
  }
}

function blueprintTemplate(
  template: BlueprintTemplate,
  service: WProviderService
): BlueprintDefinition {
  const now = Date.now()
  const researcher = newAgent(
    'Researcher',
    'research and fact-finding specialist',
    'Break the request into facts, assumptions and practical options. Be concise but thorough.',
    service
  )
  const reviewer = newAgent(
    'Reviewer',
    'critical reviewer',
    'Inspect the preceding team result, find gaps and propose concrete corrections.',
    service
  )
  const editor = newAgent(
    'Editor',
    'lead editor and synthesizer',
    'Combine the whole team context into one polished, actionable final result.',
    service
  )
  const research = agentStep('Research', researcher.id, '{{input}}')
  const review = agentStep(
    'Review',
    reviewer.id,
    'Review the research already produced by the team. Correct errors and identify missing details.'
  )
  const final = agentStep(
    'Final synthesis',
    editor.id,
    'Create the final answer from all team results. Return only the deliverable, ready to use.'
  )
  const steps: BlueprintStep[] = [research, review, final]

  if (template === 'telegram') {
    steps.push({
      id: crypto.randomUUID(),
      name: 'Send to Telegram',
      type: 'telegram',
      repeat: 1,
      continueOnError: false,
      telegramBotToken: '',
      telegramChatId: '',
      message: '{{last}}'
    })
  }

  return {
    id: crypto.randomUUID(),
    name: template === 'telegram' ? 'Telegram team digest' : 'Multi-agent workflow',
    description:
      template === 'telegram'
        ? 'A team researches, reviews and sends the final digest to Telegram.'
        : 'Three WProvider agents research, review and synthesize one result.',
    agentMode: false,
    agents: [researcher, reviewer, editor],
    steps,
    schedule: { enabled: false, intervalMinutes: 60, input: '' },
    createdAt: now,
    updatedAt: now
  }
}

function eventDeltaKey(event: BlueprintEvent): string {
  return `${event.runId}:${event.stepId ?? ''}`
}

export const useBlueprints = create<BlueprintState>((set, get) => {
  const ensureEvents = (): void => {
    if (unsubscribeEvents) return
    unsubscribeEvents = api.blueprint.onEvent((event) => {
      set((state) => {
        // A late stop event may arrive after the user deleted the definition.
        // Do not resurrect runtime state for an item that no longer exists.
        if (!state.items.some((item) => item.id === event.blueprintId)) return state
        const items = state.items.map((item) =>
          item.id === event.blueprintId
            ? { ...item, updatedAt: Date.now(), lastRun: event.run }
            : item
        )
        let deltas = state.deltas
        if (event.kind === 'step-started') {
          deltas = Object.fromEntries(
            Object.entries(state.deltas).filter(([key]) => key !== eventDeltaKey(event))
          )
        } else if (event.kind === 'step-delta' && event.delta) {
          deltas = {
            ...state.deltas,
            [eventDeltaKey(event)]: `${state.deltas[eventDeltaKey(event)] ?? ''}${event.delta}`
          }
        } else if (
          event.kind === 'run-completed' ||
          event.kind === 'run-failed' ||
          event.kind === 'run-stopped'
        ) {
          deltas = Object.fromEntries(
            Object.entries(state.deltas).filter(([key]) => !key.startsWith(`${event.runId}:`))
          )
        }
        return {
          items,
          runs: { ...state.runs, [event.blueprintId]: event.run },
          deltas,
          error:
            event.kind === 'run-failed'
              ? event.run.error ?? 'Blueprint run failed.'
              : state.error
        }
      })
    })
  }

  return {
    items: [],
    activeId: null,
    runs: {},
    deltas: {},
    loaded: false,
    loading: false,
    error: null,
    openRequest: 0,

    async init() {
      ensureEvents()
      if (get().loaded || get().loading) return
      set({ loading: true, error: null })
      try {
        const items = await api.blueprint.list()
        set((state) => ({
          items,
          activeId:
            state.activeId && items.some((item) => item.id === state.activeId)
              ? state.activeId
              : items[0]?.id ?? null,
          runs: Object.fromEntries(
            items.filter((item) => item.lastRun).map((item) => [item.id, item.lastRun!])
          ),
          loaded: true,
          loading: false
        }))
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    },

    open(id) {
      const selected = id ?? get().activeId ?? get().items[0]?.id ?? null
      set((state) => ({ activeId: selected, openRequest: state.openRequest + 1 }))
    },

    async createBlueprint(template = 'team', service = 'qwen') {
      ensureEvents()
      const saved = await api.blueprint.save(blueprintTemplate(template, service))
      set((state) => ({
        items: [saved, ...state.items.filter((item) => item.id !== saved.id)],
        activeId: saved.id,
        openRequest: state.openRequest + 1,
        loaded: true,
        error: null
      }))
      return saved
    },

    async saveBlueprint(blueprint) {
      const saved = await api.blueprint.save(blueprint)
      set((state) => ({
        items: [saved, ...state.items.filter((item) => item.id !== saved.id)],
        activeId: saved.id,
        error: null
      }))
      return saved
    },

    async removeBlueprint(id) {
      await api.blueprint.remove(id)
      set((state) => {
        const items = state.items.filter((item) => item.id !== id)
        const runs = { ...state.runs }
        delete runs[id]
        return {
          items,
          runs,
          activeId: state.activeId === id ? items[0]?.id ?? null : state.activeId,
          error: null
        }
      })
    },

    async runBlueprint(id, input) {
      const result = await api.blueprint.run({ blueprintId: id, input })
      if (!result.ok) {
        set({ error: result.error ?? 'Could not start Blueprint.' })
        throw new Error(result.error ?? 'Could not start Blueprint.')
      }
      set({ error: null })
    },

    async stopBlueprint(id) {
      await api.blueprint.stop(id)
    },

    clearError() {
      set({ error: null })
    }
  }
})
