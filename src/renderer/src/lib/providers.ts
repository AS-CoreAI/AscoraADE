import type { LlmProvider } from '@shared/ipc'

export const PROVIDERS: { id: LlmProvider; name: string }[] = [
  { id: 'lmstudio', name: 'LM Studio' },
  { id: 'ollama', name: 'Ollama' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'omniroute', name: 'OmniRoute' },
  { id: 'codex', name: 'Codex' },
  { id: 'copilot', name: 'GitHub Copilot' },
  { id: 'claude', name: 'Claude' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'grok', name: 'Grok CLI' },
  { id: 'glm', name: 'GLM (ZCode)' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'wprovider', name: 'Ascora WProvider' }
]

export type SettingsSection = 'appearance' | 'providers' | 'tools'
