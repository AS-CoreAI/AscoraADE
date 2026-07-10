import { useEffect, useMemo, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useBlueprints } from '@/state/blueprints'

interface HubMessage {
  id: string
  text: string
  createdAt: number
  blueprintIds: string[]
}

const STORAGE_KEY = 'ascora.blueprintHub.connected'

function readConnected(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function BlueprintHub(): JSX.Element {
  const items = useBlueprints((state) => state.items)
  const runs = useBlueprints((state) => state.runs)
  const deltas = useBlueprints((state) => state.deltas)
  const loading = useBlueprints((state) => state.loading)
  const init = useBlueprints((state) => state.init)
  const runBlueprint = useBlueprints((state) => state.runBlueprint)
  const [connected, setConnected] = useState<string[]>(readConnected)
  const [messages, setMessages] = useState<HubMessage[]>([])
  const [input, setInput] = useState('')

  useEffect(() => { void init() }, [init])
  useEffect(() => {
    const valid = connected.filter((id) => items.some((item) => item.id === id))
    if (valid.length !== connected.length) setConnected(valid)
  }, [connected, items])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(connected)) }, [connected])

  const connectedItems = useMemo(
    () => connected.flatMap((id) => items.find((item) => item.id === id) ?? []),
    [connected, items]
  )

  const toggle = (id: string): void => {
    setConnected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || connected.length === 0) return
    const blueprintIds = [...connected]
    setMessages((current) => [...current, { id: crypto.randomUUID(), text, createdAt: Date.now(), blueprintIds }])
    setInput('')
    await Promise.allSettled(blueprintIds.map((id) => runBlueprint(id, text)))
  }

  return (
    <div className="blueprint-hub">
      <aside className="blueprint-hub-catalog">
        <header>
          <div><Icon name="blueprint" size={16} /><strong>Каталог сценариев</strong></div>
          <span>{connected.length} подключено</span>
        </header>
        <p>Выберите один или несколько Blueprint. Один запрос будет передан всем их агентам.</p>
        <div className="blueprint-hub-list">
          {loading && items.length === 0 && <div className="blueprint-hub-empty">Загрузка…</div>}
          {!loading && items.length === 0 && <div className="blueprint-hub-empty">Сначала создайте Blueprint в списке слева.</div>}
          {items.map((blueprint) => {
            const active = connected.includes(blueprint.id)
            return (
              <button className={`blueprint-hub-item${active ? ' connected' : ''}`} key={blueprint.id} onClick={() => toggle(blueprint.id)}>
                <span className="blueprint-hub-item-icon"><Icon name="blueprint" size={16} /></span>
                <span className="blueprint-hub-item-copy">
                  <strong>{blueprint.name}</strong>
                  <small>{blueprint.description || `${blueprint.agents.length} агентов · ${blueprint.steps.length} шагов`}</small>
                </span>
                <span className="blueprint-hub-check"><Icon name={active ? 'check' : 'plus'} size={13} /></span>
              </button>
            )
          })}
        </div>
      </aside>

      <main className="blueprint-hub-chat">
        <header>
          <div><Icon name="users" size={16} /><strong>Командный чат</strong></div>
          <div className="blueprint-hub-chips">
            {connectedItems.map((blueprint) => <span key={blueprint.id}>{blueprint.name}</span>)}
          </div>
        </header>
        <div className="blueprint-hub-messages">
          {messages.length === 0 && (
            <div className="blueprint-hub-welcome">
              <Icon name="message" size={28} />
              <strong>Подключите сценарии и поставьте общую задачу</strong>
              <span>Агенты каждого Blueprint выполнят свои шаги, а результаты появятся здесь.</span>
            </div>
          )}
          {messages.map((message) => (
            <div className="blueprint-hub-turn" key={message.id}>
              <div className="blueprint-hub-user">{message.text}</div>
              <div className="blueprint-hub-replies">
                {message.blueprintIds.map((id) => {
                  const blueprint = items.find((item) => item.id === id)
                  const run = runs[id]
                  const belongsToTurn = run && run.startedAt >= message.createdAt
                  const output = belongsToTurn
                    ? [...run.steps].reverse().find((step) => step.output || step.error)
                    : undefined
                  const live = belongsToTurn && run
                    ? [...run.steps].reverse().map((step) => deltas[`${run.id}:${step.stepId}`]).find(Boolean)
                    : undefined
                  return (
                    <article className={`blueprint-hub-reply ${belongsToTurn ? run.status : 'pending'}`} key={id}>
                      <div><Icon name="blueprint" size={14} /><strong>{blueprint?.name ?? 'Blueprint'}</strong><span>{belongsToTurn ? run.status : 'запускается'}</span></div>
                      <pre>{output?.error || output?.output || live || 'Агенты работают…'}</pre>
                    </article>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="blueprint-hub-composer">
          <textarea value={input} placeholder={connected.length ? 'Сообщение всем подключённым сценариям…' : 'Сначала подключите Blueprint из каталога'} disabled={connected.length === 0} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
          }} />
          <button title="Отправить" disabled={!input.trim() || connected.length === 0} onClick={() => void send()}><Icon name="send" size={16} /></button>
        </div>
      </main>
    </div>
  )
}
