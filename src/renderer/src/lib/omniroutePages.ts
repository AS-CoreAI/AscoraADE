import type { IconName } from '@/components/Icon'
import type { TranslationKey } from '@/language'

/** Native Ascora pages backed by the bundled OmniRoute API. The path values
 * are internal navigation ids (kept aligned with upstream route names), not
 * URLs loaded from the sidecar. */
export interface OmniroutePage {
  path: string
  labelKey: TranslationKey
  icon: IconName
}

export const OMNI_PAGES: OmniroutePage[] = [
  { path: '/home', labelKey: 'omni.home', icon: 'home' },
  { path: '/dashboard/endpoint', labelKey: 'omni.endpoints', icon: 'plug' },
  { path: '/dashboard/api-manager', labelKey: 'omni.apiManager', icon: 'key' },
  { path: '/dashboard/providers', labelKey: 'omni.providers', icon: 'server' },
  { path: '/dashboard/combos', labelKey: 'omni.combos', icon: 'layers' },
  { path: '/dashboard/combos/live', labelKey: 'omni.comboStudio', icon: 'gitBranch' },
  { path: '/dashboard/quota', labelKey: 'omni.quota', icon: 'sliders' },
  { path: '/dashboard/compression/studio', labelKey: 'omni.compressionStudio', icon: 'barChart' },
  { path: '/dashboard/cli-code', labelKey: 'omni.cliCode', icon: 'terminal' },
  { path: '/dashboard/tools/traffic-inspector', labelKey: 'omni.trafficInspector', icon: 'activity' },
  { path: '/dashboard/playground', labelKey: 'omni.playground', icon: 'flask' }
]
