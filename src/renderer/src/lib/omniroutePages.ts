import type { IconName } from '@/components/Icon'
import type { TranslationKey } from '@/language'

/** Native Ascora pages backed by the bundled OmniRoute API. The path values
 * are internal navigation ids (kept aligned with upstream route names), not
 * URLs loaded from the sidecar. */
export interface OmniroutePage {
  path: string
  labelKey: TranslationKey
  icon: IconName
  group: OmniroutePageGroupId
}

export type OmniroutePageGroupId = 'overview' | 'connections' | 'workflows' | 'tools'

export interface OmniroutePageGroup {
  id: OmniroutePageGroupId
  labelKey: TranslationKey
}

export const OMNI_PAGE_GROUPS: OmniroutePageGroup[] = [
  { id: 'overview', labelKey: 'omni.group.overview' },
  { id: 'connections', labelKey: 'omni.group.connections' },
  { id: 'workflows', labelKey: 'omni.group.workflows' },
  { id: 'tools', labelKey: 'omni.group.tools' }
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
  { path: '/dashboard/playground', labelKey: 'omni.playground', icon: 'flask', group: 'tools' }
]
