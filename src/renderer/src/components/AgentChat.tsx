import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { Composer } from './Composer'
import { Icon } from './Icon'
import { useApp, type ChatMessage, type ToolStatus } from '@/state/store'
import { lineDiff } from '@/lib/diff'

const TOOL_LABEL: Record<string, string> = {
  list_dir: 'List directory',
  read_file: 'Read file',
  write_file: 'Edit file',
  run_command: 'Run command',
  apply_patch: 'Edit files'
}

function toolIcon(tool?: string): 'terminal' | 'folder' | 'file' {
  if (tool === 'run_command') return 'terminal'
  if (tool === 'list_dir') return 'folder'
  return 'file'
}

function toolSummary(m: ChatMessage): string {
  if (m.tool === 'run_command') return String(m.args?.command ?? '')
  return String(m.args?.path ?? '')
}

const STATUS_TEXT: Record<ToolStatus, string> = {
  awaiting: 'needs review',
  running: 'running…',
  done: 'done',
  rejected: 'rejected',
  error: 'error'
}

function Diff({ oldText, newText }: { oldText: string; newText: string }): JSX.Element {
  const lines = lineDiff(oldText, newText)
  if (lines.length === 0) return <div className="tool-note">No changes.</div>
  return (
    <pre className="tool-diff">
      {lines.map((l, i) => (
        <div key={i} className={`diff-line ${l.type}`}>
          <span className="diff-gutter">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
          {l.text}
        </div>
      ))}
    </pre>
  )
}

function ToolCard({ m }: { m: ChatMessage }): JSX.Element {
  const approveTool = useApp((s) => s.approveTool)
  const rejectTool = useApp((s) => s.rejectTool)
  const status = m.status ?? 'done'

  return (
    <div className={`tool-card ${status}`}>
      <div className="tool-head">
        <Icon name={toolIcon(m.tool)} size={14} />
        <span className="tool-name">{TOOL_LABEL[m.tool ?? ''] ?? m.tool}</span>
        <code className="tool-arg">{toolSummary(m)}</code>
        <span className="spacer" />
        <span className={`tool-status ${status}`}>{STATUS_TEXT[status]}</span>
      </div>

      {m.tool === 'write_file' && (status === 'awaiting' || status === 'running' || status === 'done') && (
        <Diff oldText={m.oldContent ?? ''} newText={m.newContent ?? ''} />
      )}

      {m.tool === 'run_command' && (m.output?.trim() || m.stderr?.trim()) && (
        <pre className="tool-output">
          {m.output}
          {m.stderr?.trim() ? <span className="tool-stderr">{m.output ? '\n' : ''}{m.stderr}</span> : null}
          {typeof m.exitCode === 'number' && m.exitCode !== 0 ? (
            <span className="tool-stderr">{`\n[exit ${m.exitCode}]`}</span>
          ) : null}
        </pre>
      )}

      {(m.tool === 'list_dir' || m.tool === 'read_file') && m.output && status === 'done' && (
        <div className="tool-note">{m.output}</div>
      )}

      {m.tool === 'apply_patch' && m.output && <pre className="tool-output">{m.output}</pre>}

      {status === 'error' && m.error && <div className="tool-error">{m.error}</div>}

      {status === 'awaiting' && (
        <div className="tool-actions">
          <button className="tool-approve" onClick={() => approveTool(m.id)}>
            <Icon name="check" size={14} /> Approve
          </button>
          <button className="tool-reject" onClick={() => rejectTool(m.id)}>
            <Icon name="x" size={14} /> Reject
          </button>
        </div>
      )}
    </div>
  )
}

function ReasoningBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`reasoning-block${open ? ' open' : ''}`}>
      <button className="reasoning-head" onClick={() => setOpen((o) => !o)}>
        <Icon name="sparkles" size={13} />
        <span>Thought process</span>
        <span className="spacer" />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  )
}

function Messages({ messages }: { messages: ChatMessage[] }): JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        Describe a task and the agent will read and edit files and run commands in your project.
        In “Ask before changes” mode it shows a diff and waits for your approval; switch to
        “Auto-apply” to let it work uninterrupted.
      </div>
    )
  }
  return (
    <>
      {messages.map((m) =>
        m.kind === 'tool' ? (
          <ToolCard key={m.id} m={m} />
        ) : m.reasoning ? (
          <ReasoningBlock key={m.id} text={m.text} />
        ) : (
          <div key={m.id} className={`msg ${m.role}`}>
            <span className="role">{m.role === 'user' ? 'You' : 'Ascora'}</span>
            <div className="bubble">{m.text}</div>
          </div>
        )
      )}
    </>
  )
}

export function AgentChat({ full = false }: { full?: boolean }): JSX.Element {
  const messages = useApp((s) => s.messages)
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [messages])

  if (full) {
    return (
      <div className="chat-full">
        <div className="chat-full-scroll" ref={scrollRef}>
          <div className="chat-col chat-messages-col">
            <Messages messages={messages} />
          </div>
        </div>
        <div className="chat-full-composer">
          <div className="chat-col">
            <Composer showFolder={false} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel panel-side">
      <div className="panel-header">
        <Icon name="message" size={13} />
        Agent
        <span className="spacer" />
      </div>

      <div className="chat">
        <div className="chat-messages" ref={scrollRef}>
          <Messages messages={messages} />
        </div>
        <div className="chat-composer">
          <Composer showFolder={false} />
        </div>
      </div>
    </div>
  )
}
