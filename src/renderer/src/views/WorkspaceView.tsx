import { useState, type JSX } from 'react'
import { Allotment } from 'allotment'
import { Explorer } from '@/components/Explorer'
import { EditorPane } from '@/components/EditorPane'
import { TerminalPanel } from '@/components/TerminalPanel'
import { AgentChat } from '@/components/AgentChat'
import { GitPanel } from '@/components/GitPanel'
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
          // IDE layout: sidebar (explorer | git) + editor/terminal + side chat.
          <Allotment>
            <Allotment.Pane minSize={180} preferredSize={250}>
              {tab === 'explorer' ? <Explorer /> : <GitPanel />}
            </Allotment.Pane>

            <Allotment.Pane minSize={320}>
              <Allotment vertical>
                <Allotment.Pane minSize={120}>
                  <EditorPane />
                </Allotment.Pane>
                <Allotment.Pane minSize={80} preferredSize={190}>
                  <TerminalPanel />
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>

            <Allotment.Pane minSize={280} preferredSize={360}>
              <AgentChat />
            </Allotment.Pane>
          </Allotment>
        )}
      </div>
    </div>
  )
}
