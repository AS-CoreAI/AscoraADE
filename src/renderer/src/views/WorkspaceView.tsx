import { useState, type JSX } from 'react'
import { AgentChat } from '@/components/AgentChat'
import { DockLayout } from '@/components/DockLayout'
import { Icon } from '@/components/Icon'

type Tab = 'chat' | 'explorer' | 'git'

export function WorkspaceView(): JSX.Element {
  const [tab, setTab] = useState<Tab>('chat')

  return (
    <div className="workspace" style={{ display: 'flex' }}>
      <div className="activity-bar">
        <button
          className={`activity-btn${tab === 'chat' ? ' active' : ''}`}
          title="Chat"
          onClick={() => setTab('chat')}
        >
          <Icon name="message" size={19} />
        </button>
        <button
          className={`activity-btn${tab === 'explorer' ? ' active' : ''}`}
          title="Explorer"
          onClick={() => setTab('explorer')}
        >
          <Icon name="folder" size={19} />
        </button>
        <button
          className={`activity-btn${tab === 'git' ? ' active' : ''}`}
          title="Source Control"
          onClick={() => setTab('git')}
        >
          <Icon name="gitBranch" size={19} />
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {tab === 'chat' ? (
          // Full-screen chat (like the ZCode task view).
          <AgentChat full />
        ) : (
          // VS Code-style dockable IDE layout: every view is a draggable panel.
          <DockLayout focus={tab === 'git' ? 'git' : 'explorer'} />
        )}
      </div>
    </div>
  )
}
