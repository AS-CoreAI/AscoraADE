import { PROVIDERS } from '@/lib/providers'
import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { Icon } from './Icon'
import type { LlmProvider } from '@shared/ipc'

export interface ProviderSelectOption {
  value: LlmProvider
  label: string
  disabled?: boolean
  tooltip?: string
}

export function ProviderSelect({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  placement = 'bottom'
}: {
  value: LlmProvider
  options: ProviderSelectOption[]
  onChange: (value: LlmProvider) => void
  className: string
  ariaLabel: string
  placement?: 'top' | 'bottom'
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selected = options.find((option) => option.value === value)

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

  const choose = (option: ProviderSelectOption): void => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  return (
    <span
      className={`provider-select-wrap provider-dropdown${open ? ' open' : ''}`}
      data-placement={placement}
      ref={rootRef}
    >
      <button
        type="button"
        className={`provider-select-button ${className}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="provider-select-label">{selected?.label ?? PROVIDERS.find((item) => item.id === value)?.name ?? value}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="provider-dropdown-menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className="provider-dropdown-option"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-disabled={option.disabled || undefined}
              data-tooltip={option.tooltip || undefined}
              onClick={() => choose(option)}
            >
              <span className="provider-option-label">{option.label}</span>
              {option.tooltip && <span className="provider-option-tooltip">{option.tooltip}</span>}
              {option.value === value && <Icon name="check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
