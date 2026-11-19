import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { OMNI_PROVIDER_CATALOG } from '@/lib/omnirouteProviderCatalog.generated'
import { OMNI_BUILTIN_MODELS, OMNI_PROVIDER_ID_TO_ALIAS } from '@/lib/omnirouteProviderModels.generated'
import { isAutoOmniModel } from '@/lib/omniModels'
import { tr } from '@/language'
import { useApp } from '@/state/store'

// The composer's OmniRoute model list shows only models that are routable right
// now — the live gateway catalog (`/v1/models`, passed as `runtimeModels`) = your
// connections plus always-on no-auth providers. The static built-in catalog is
// used only to give those live ids nicer display names and provider grouping.

interface CatalogModel {
  id: string
  name: string
  providerId: string
  providerName: string
}

const AUTO_GROUP_ID = '__auto__'
const NO_ACCOUNT_GROUP_ID = '__no_account__'

// Providers that answer agent requests (including tool calls) with no account,
// key, local CLI or browser runtime — verified live against OmniRoute 3.8.54 on
// 2026-11-19. Its other no-auth providers need a local CLI (Devin, Auggie, ZCode,
// MiniMax Code, Codex app-server), a Chromium runtime Ascora does not bundle
// (Cloudflare Playground) or a key (UncloseAI's beta is closed), or serve only
// images/video; Pollinations' keyless tier rejects requests that carry tools.
const NO_ACCOUNT_PROVIDERS = new Set(['duckduckgo-web'])

const PROVIDER_NAME = new Map<string, string>(OMNI_PROVIDER_CATALOG.map((p) => [p.id, p.name]))
const ALIAS_TO_PROVIDER = new Map<string, { providerId: string; providerName: string }>()
for (const [providerId, alias] of Object.entries(OMNI_PROVIDER_ID_TO_ALIAS)) {
  ALIAS_TO_PROVIDER.set(alias, { providerId, providerName: PROVIDER_NAME.get(providerId) ?? providerId })
}

// id -> display metadata, so a live `<alias>/<model>` id can show a friendly name.
const CATALOG_BY_ID = new Map<string, { name: string; providerId: string; providerName: string }>()
for (const [alias, models] of Object.entries(OMNI_BUILTIN_MODELS)) {
  const meta = ALIAS_TO_PROVIDER.get(alias)
  const providerId = meta?.providerId ?? alias
  const providerName = meta?.providerName ?? alias
  for (const model of models) CATALOG_BY_ID.set(`${alias}/${model.id}`, { name: model.name, providerId, providerName })
}

function describe(id: string): CatalogModel {
  if (isAutoOmniModel(id)) return { id, name: id, providerId: AUTO_GROUP_ID, providerName: 'auto' }
  const hit = CATALOG_BY_ID.get(id)
  if (hit) return { id, name: hit.name, providerId: hit.providerId, providerName: hit.providerName }
  const prefix = id.includes('/') ? id.slice(0, id.indexOf('/')) : id
  const meta = ALIAS_TO_PROVIDER.get(prefix)
  return { id, name: id, providerId: meta?.providerId ?? prefix, providerName: meta?.providerName ?? prefix }
}

interface DisplayGroup {
  providerId: string
  providerName: string
  models: CatalogModel[]
}

export function OmniModelPicker({
  value,
  runtimeModels,
  onChange,
  onConnect,
  className,
  ariaLabel,
  placement = 'bottom',
  disabled = false,
  connectLabel,
  searchPlaceholder,
  emptyLabel
}: {
  value: string
  runtimeModels: string[]
  onChange: (id: string) => void
  onConnect: () => void
  className: string
  ariaLabel: string
  placement?: 'top' | 'bottom'
  disabled?: boolean
  connectLabel: string
  searchPlaceholder: string
  emptyLabel: string
}): JSX.Element {
  const language = useApp((s) => s.appLanguage)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  // Every routable model (the gateway's /v1/models), grouped by provider. Search
  // filters within them.
  const groups = useMemo<DisplayGroup[]>(() => {
    const needle = query.trim().toLowerCase()
    const map = new Map<string, DisplayGroup>()
    const seen = new Set<string>()
    for (const id of runtimeModels) {
      if (seen.has(id)) continue
      seen.add(id)
      const model = describe(id)
      if (
        needle &&
        !model.id.toLowerCase().includes(needle) &&
        !model.name.toLowerCase().includes(needle) &&
        !model.providerName.toLowerCase().includes(needle)
      )
        continue
      const groupId = NO_ACCOUNT_PROVIDERS.has(model.providerId) ? NO_ACCOUNT_GROUP_ID : model.providerId
      const group = map.get(groupId) ?? {
        providerId: groupId,
        providerName: groupId === NO_ACCOUNT_GROUP_ID ? tr(language, 'composer.modelGroupNoAccount') : model.providerName,
        models: []
      }
      group.models.push(model)
      map.set(groupId, group)
    }
    const arr = [...map.values()]
    for (const group of arr) group.models.sort((a, b) => a.id.localeCompare(b.id))
    const pinned = [AUTO_GROUP_ID, NO_ACCOUNT_GROUP_ID]
    arr.sort((a, b) => {
      const rank = (group: DisplayGroup): number => {
        const index = pinned.indexOf(group.providerId)
        return index < 0 ? pinned.length : index
      }
      return rank(a) - rank(b) || a.providerName.localeCompare(b.providerName)
    })
    return arr
  }, [query, runtimeModels, language])

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    if (open) window.setTimeout(() => searchRef.current?.focus(), 0)
    else setQuery('')
  }, [open])

  const choose = (id: string): void => {
    onChange(id)
    setOpen(false)
  }

  return (
    <span className={`provider-select-wrap provider-dropdown omni-model-picker${open ? ' open' : ''}`} data-placement={placement} ref={rootRef}>
      <button
        type="button"
        className={`provider-select-button ${className}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="provider-select-label">{value || 'auto'}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="provider-dropdown-menu omni-model-menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          <div className="omni-model-search">
            <Icon name="search" size={13} />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} />
          </div>
          <div className="omni-model-list">
            {groups.length === 0 ? (
              <div className="omni-model-empty">{emptyLabel}</div>
            ) : (
              groups.map((group) => (
                <div className="omni-model-group" key={group.providerId}>
                  <div className="omni-model-group-head">{group.providerName}</div>
                  {group.models.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      className="provider-dropdown-option omni-model-option"
                      role="option"
                      aria-selected={model.id === value}
                      title={model.id}
                      onClick={() => choose(model.id)}
                    >
                      <span className="provider-option-label">{model.id}</span>
                      {model.id === value && <Icon name="check" size={13} />}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="omni-model-foot">
            <button type="button" className="omni-model-connect" onClick={() => { setOpen(false); onConnect() }}>
              <Icon name="plug" size={12} />
              {connectLabel}
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
