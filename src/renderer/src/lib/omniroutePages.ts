import type { IconName } from '@/components/Icon'
import type { TranslationKey } from '@/language'

/** Native Ascora pages backed by the bundled OmniRoute API. The path values
 * are internal navigation ids (kept aligned with upstream route names), not
 * URLs loaded from the sidecar. */
export interface OmniroutePage {
  path: string
  labelKey: TranslationKey
  subtitleKey?: TranslationKey
  icon: IconName
  group: OmniroutePageGroupId
  accent?: string
}

export type OmniroutePageGroupId = 'overview' | 'connections' | 'workflows' | 'tools' | 'agentic'

export interface OmniroutePageGroup {
  id: OmniroutePageGroupId
  labelKey: TranslationKey
}

export const OMNI_PAGE_GROUPS: OmniroutePageGroup[] = [
  { id: 'overview', labelKey: 'omni.group.overview' },
  { id: 'connections', labelKey: 'omni.group.connections' },
  { id: 'workflows', labelKey: 'omni.group.workflows' },
  { id: 'tools', labelKey: 'omni.group.tools' },
  { id: 'agentic', labelKey: 'omni.group.agentic' }
]

export const OMNI_PAGES: OmniroutePage[] = [
  { path: '/home', labelKey: 'omni.home', icon: 'home', group: 'overview' },
  { path: '/dashboard/endpoint', labelKey: 'omni.endpoints', icon: 'plug', group: 'connections' },
  { path: '/dashboard/api-manager', labelKey: 'omni.apiManager', icon: 'key', group: 'connections' },
  { path: '/dashboard/providers', labelKey: 'omni.providers', icon: 'server', group: 'connections' },
  { path: '/dashboard/quota', labelKey: 'omni.quota', icon: 'sliders', group: 'connections' },
  { path: '/dashboard/combos', labelKey: 'omni.combos', icon: 'layers', group: 'workflows' },
  { path: '/dashboard/combos/live', labelKey: 'omni.comboStudio', icon: 'gitBranch', group: 'workflows' },
  { path: '/dashboard/compression/studio', labelKey: 'omni.compressionStudio', icon: 'barChart', group: 'workflows' },
  { path: '/dashboard/cli-code', labelKey: 'omni.cliCode', icon: 'terminal', group: 'tools' },
  { path: '/dashboard/tools/traffic-inspector', labelKey: 'omni.trafficInspector', icon: 'activity', group: 'tools' },
  { path: '/dashboard/playground', labelKey: 'omni.playground', icon: 'flask', group: 'tools' },
  { path: '/dashboard/memory', labelKey: 'omni.memory', subtitleKey: 'omni.memorySubtitle', icon: 'bulb', group: 'agentic', accent: '#10B981' },
  { path: '/dashboard/agent-skills', labelKey: 'omni.agentSkills', subtitleKey: 'omni.agentSkillsSubtitle', icon: 'gitBranch', group: 'agentic', accent: '#D946EF' },
  { path: '/dashboard/chaos', labelKey: 'omni.chaos', subtitleKey: 'omni.chaosSubtitle', icon: 'sparkles', group: 'agentic', accent: '#E03ED8' },
  { path: '/dashboard/omni-skills', labelKey: 'omni.omniSkills', subtitleKey: 'omni.omniSkillsSubtitle', icon: 'flask', group: 'agentic', accent: '#F43F5E' },
  { path: '/dashboard/mcp', labelKey: 'omni.mcp', subtitleKey: 'omni.mcpSubtitle', icon: 'layers', group: 'agentic', accent: '#8B5CF6' },
  { path: '/dashboard/a2a', labelKey: 'omni.a2a', subtitleKey: 'omni.a2aSubtitle', icon: 'route', group: 'agentic', accent: '#06B6D4' },
  { path: '/dashboard/plugins', labelKey: 'omni.plugins', subtitleKey: 'omni.pluginsSubtitle', icon: 'plug', group: 'agentic', accent: '#BFE03E' }
]

export const AGENTIC_PAGE_PATHS = new Set(OMNI_PAGES.filter((page) => page.group === 'agentic').map((page) => page.path))
