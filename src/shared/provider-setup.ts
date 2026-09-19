export interface ProviderSoftwareInfo {
  available: boolean
  command?: string
  url?: string
  error?: string
}

export interface ProviderInstallResult {
  ok: boolean
  error?: string
}

export interface ProviderCreditInfo {
  ok: boolean
  /** USD remaining under this API key's spending cap; null means no key cap. */
  remaining?: number | null
  limit?: number | null
  used?: number
  error?: string
}
