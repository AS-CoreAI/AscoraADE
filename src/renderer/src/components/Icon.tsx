import type { JSX } from 'react'

export type IconName =
  | 'plus'
  | 'search'
  | 'sparkles'
  | 'folder'
  | 'folderOpen'
  | 'file'
  | 'chevronRight'
  | 'chevronDown'
  | 'arrowLeft'
  | 'arrowRight'
  | 'arrowUp'
  | 'arrowDown'
  | 'hand'
  | 'send'
  | 'minimize'
  | 'maximize'
  | 'close'
  | 'terminal'
  | 'gitBranch'
  | 'message'
  | 'archive'
  | 'collapse'
  | 'refresh'
  | 'settings'
  | 'check'
  | 'copy'
  | 'save'
  | 'trash'
  | 'barChart'
  | 'globe'
  | 'external'
  | 'info'
  | 'x'
  | 'blueprint'
  | 'play'
  | 'stop'
  | 'users'
  | 'clock'
  | 'bulb'
  | 'telegram'
  | 'webhook'
  | 'list'
  | 'route'
  | 'home'
  | 'plug'
  | 'key'
  | 'server'
  | 'layers'
  | 'sliders'
  | 'activity'
  | 'flask'
  | 'shield'

const paths: Record<IconName, JSX.Element> = {
  shield: (
    <>
      <path d="M12 3 20 6v5c0 5.2-3.2 8.4-8 10-4.8-1.6-8-4.8-8-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.8 4.8L18.6 9.6 13.8 11.4 12 16.2 10.2 11.4 5.4 9.6l4.8-1.8z" />
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  folderOpen: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2" />
      <path d="M3 9h18l-2 8a2 2 0 0 1-2 1.5H5A2 2 0 0 1 3 17z" />
    </>
  ),
  file: (
    <>
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    </>
  ),
  chevronRight: <polyline points="9 6 15 12 9 18" />,
  chevronDown: <polyline points="6 9 12 15 18 9" />,
  arrowLeft: (
    <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </>
  ),
  arrowRight: (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
  arrowUp: (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </>
  ),
  arrowDown: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="5 12 12 19 19 12" />
    </>
  ),
  send: (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </>
  ),
  hand: (
    <path d="M18 11V6a2 2 0 0 0-4 0v5m0 0V4a2 2 0 0 0-4 0v7m0 0V6a2 2 0 0 0-4 0v9a6 6 0 0 0 6 6h2a6 6 0 0 0 6-6v-2a2 2 0 0 0-4 0" />
  ),
  minimize: <line x1="5" y1="12" x2="19" y2="12" />,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  x: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  terminal: (
    <>
      <polyline points="4 7 9 12 4 17" />
      <line x1="12" y1="17" x2="20" y2="17" />
    </>
  ),
  gitBranch: (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  message: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </>
  ),
  collapse: (
    <>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
    </>
  ),
  refresh: (
    <>
      <polyline points="21 3 21 9 15 9" />
      <polyline points="3 21 3 15 9 15" />
      <path d="M20.5 13a8 8 0 0 1-13.2 3.1L3 15" />
      <path d="M3.5 11a8 8 0 0 1 13.2-3.1L21 9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h12l2 2v16H5z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 21v-7h8v7" />
    </>
  ),
  barChart: (
    <>
      <line x1="4" y1="20" x2="4" y2="11" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="20" y1="20" x2="20" y2="14" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <line x1="20" y1="4" x2="11" y2="13" />
      <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>
  ),
  blueprint: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="9" y="15" width="6" height="6" rx="1" />
      <path d="M6 9v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9" />
      <line x1="12" y1="13" x2="12" y2="15" />
    </>
  ),
  play: <polygon points="8 5 19 12 8 19 8 5" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6" />
      <path d="M17 14a5 5 0 0 1 4 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </>
  ),
  bulb: (
    <>
      <path d="M12 3a6 6 0 0 0-3.9 10.6c.7.6 1.3 1.4 1.5 2.4h4.8c.2-1 .8-1.8 1.5-2.4A6 6 0 0 0 12 3z" />
      <line x1="9.6" y1="19" x2="14.4" y2="19" />
      <line x1="10.5" y1="21.5" x2="13.5" y2="21.5" />
    </>
  ),
  telegram: (
    <>
      <path d="M21 4L3.8 10.6c-1.2.5-1.2 1.2-.2 1.5l4.4 1.4 1.7 5.1c.2.7.1 1 .9 1 .6 0 .9-.3 1.2-.6l2.2-2.1 4.6 3.4c.8.5 1.5.3 1.7-.8L23 5.4c.3-1.4-.5-2-2-1.4z" />
      <path d="M8 13.5L19 7" />
    </>
  ),
  webhook: (
    <>
      <circle cx="7" cy="6" r="3" />
      <circle cx="17" cy="18" r="3" />
      <path d="M7 9v2a5 5 0 0 0 5 5h2" />
      <path d="M17 15v-2a5 5 0 0 0-5-5h-2" />
    </>
  ),
  list: (
    <>
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="9" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <line x1="12" y1="16" x2="12" y2="16.01" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M9 19h6.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H15" />
    </>
  ),
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.8V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.8" />
    </>
  ),
  plug: (
    <>
      <line x1="9" y1="7" x2="9" y2="3" />
      <line x1="15" y1="7" x2="15" y2="3" />
      <path d="M6 7h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2" />
      <path d="M15.5 7.5 19 11" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <line x1="6.5" y1="7.5" x2="6.51" y2="7.5" />
      <line x1="6.5" y1="16.5" x2="6.51" y2="16.5" />
    </>
  ),
  layers: (
    <>
      <polygon points="12 2 22 7.5 12 13 2 7.5 12 2" />
      <polyline points="2 12.5 12 18 22 12.5" />
      <polyline points="2 17.5 12 23 22 17.5" />
    </>
  ),
  sliders: (
    <>
      <line x1="21" y1="6" x2="14" y2="6" />
      <line x1="10" y1="6" x2="3" y2="6" />
      <line x1="21" y1="12" x2="12" y2="12" />
      <line x1="8" y1="12" x2="3" y2="12" />
      <line x1="21" y1="18" x2="16" y2="18" />
      <line x1="12" y1="18" x2="3" y2="18" />
      <line x1="14" y1="4" x2="14" y2="8" />
      <line x1="8" y1="10" x2="8" y2="14" />
      <line x1="16" y1="16" x2="16" y2="20" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  flask: (
    <>
      <path d="M10 2.5v6L4.6 17.8A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.8-3.2L14 8.5v-6" />
      <line x1="8.5" y1="2.5" x2="15.5" y2="2.5" />
      <line x1="7" y1="15" x2="17" y2="15" />
    </>
  )
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.6
}: {
  name: IconName
  size?: number
  strokeWidth?: number
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
