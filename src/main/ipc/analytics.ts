import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC, type UsageEvent, type UsageEventInput } from '@shared/ipc'
import { getStore } from '../store'

/** Rough token estimate when a backend doesn't report real usage (~4 chars/token). */
function estTokens(text: string): number {
  return Math.max(0, Math.round((text?.length ?? 0) / 4))
}

/**
 * One-time backfill so the dashboard isn't empty on first open: turn each
 * previously-saved task into an estimated usage event. We can't know the model
 * or exact tokens for old tasks, so they're attributed to "(history)" and
 * flagged `estimated`. Gated by a settings flag so it runs at most once.
 */
function seedHistoryOnce(): void {
  const store = getStore()
  if (store.getSetting<boolean>('analytics.seeded')) return
  store.setSetting('analytics.seeded', true)
  try {
    for (const ws of store.listWorkspaces()) {
      for (const summary of store.listTasks(ws.id)) {
        const task = store.getTask(summary.id)
        if (!task) continue
        let inputTokens = 0
        let outputTokens = 0
        let userMessages = 0
        let assistantMessages = 0
        for (const m of task.messages) {
          if (m.kind !== 'text') continue
          if (m.role === 'user') {
            inputTokens += estTokens(m.text)
            userMessages += 1
          } else {
            outputTokens += estTokens(m.text)
            assistantMessages += 1
          }
        }
        if (userMessages === 0 && assistantMessages === 0) continue
        store.addUsage({
          id: randomUUID(),
          ts: task.updatedAt,
          workspaceId: ws.id,
          workspaceName: ws.name,
          taskId: task.id,
          provider: 'lmstudio',
          model: '(history)',
          inputTokens,
          outputTokens,
          userMessages,
          assistantMessages,
          estimated: true
        })
      }
    }
  } catch (err) {
    console.warn('[analytics] history seed failed:', err)
  }
}

export function registerAnalyticsHandlers(): void {
  ipcMain.handle(IPC.analytics.record, (_e, input: UsageEventInput): UsageEvent => {
    const event: UsageEvent = { ...input, id: randomUUID(), ts: input.ts ?? Date.now() }
    getStore().addUsage(event)
    return event
  })

  ipcMain.handle(IPC.analytics.list, (): UsageEvent[] => {
    seedHistoryOnce()
    return getStore().listUsage()
  })
}
