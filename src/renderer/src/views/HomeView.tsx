import type { JSX } from 'react'
import { Composer } from '@/components/Composer'
import { useApp } from '@/state/store'
import { tr } from '@/language'

export function HomeView(): JSX.Element {
  const active = useApp((s) => s.active)
  const appLanguage = useApp((s) => s.appLanguage)

  return (
    <div className="home">
      <div className="home-watermark" aria-hidden="true">
        <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M40 70 L150 70 L70 150" />
          <path d="M60 60 L170 60 L90 140" opacity="0.5" />
        </svg>
      </div>

      <div className="home-inner">
        <h1 className="home-title">
          {tr(appLanguage, 'home.startTask', { name: active ? active.name : 'Ascora' })}
        </h1>
        <Composer showFolder />
      </div>
    </div>
  )
}
