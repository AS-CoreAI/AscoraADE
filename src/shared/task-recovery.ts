import type { LlmMessage, TaskMessage, TaskRecord } from './ipc'

const INTERRUPTED = 'The application stopped before this operation finished. Its outcome is unknown; inspect the current state before retrying.'

/** Include streamed prose in a checkpoint without treating reasoning as an answer. */
export function checkpointConversation(convo: LlmMessage[], messages: TaskMessage[], streamId: string | null): LlmMessage[] {
  const partial = streamId ? messages.find((message) => message.id === streamId && !message.reasoning && !message.contextSummary)?.text : ''
  return partial?.trim() ? [...convo, { role: 'assistant', content: partial }] : convo
}

/** Repair a saved in-flight turn without replaying commands or tool approvals. */
export function recoverInterruptedTask(task: TaskRecord): TaskRecord {
  if (task.status !== 'running') return task
  const convo = [...(task.convo ?? [])]
  const pending = new Set<string>()
  for (const message of convo) {
    for (const call of message.tool_calls ?? []) pending.add(call.id)
    if (message.role === 'tool' && message.tool_call_id) pending.delete(message.tool_call_id)
  }
  for (const id of pending) convo.push({ role: 'tool', tool_call_id: id, content: INTERRUPTED })
  convo.push({ role: 'user', content: '[Recovery checkpoint] The previous run was interrupted. Continue from the saved progress when the user asks. Do not assume unfinished operations succeeded; verify their effects before retrying.' })
  return {
    ...task, status: 'idle', convo,
    messages: (task.messages ?? []).map((message) =>
      message.status === 'running' || message.status === 'awaiting'
        ? { ...message, status: 'error', error: INTERRUPTED } : message)
  }
}
