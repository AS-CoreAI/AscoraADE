import type { JSX } from 'react'
import { Icon } from './Icon'

/** A short monogram + brand colour used to render a file-type badge. */
interface FileType {
  label: string
  color: string
}

/**
 * Extension → badge. Colours lean toward each tech's brand hue but are picked to
 * stay legible on both the dark and light themes (the badge fills with a faint
 * tint of the same colour, so very pale hues are avoided).
 */
const BY_EXT: Record<string, FileType> = {
  ts: { label: 'TS', color: '#3178c6' },
  mts: { label: 'TS', color: '#3178c6' },
  cts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TSX', color: '#3178c6' },
  js: { label: 'JS', color: '#d7a829' },
  mjs: { label: 'JS', color: '#d7a829' },
  cjs: { label: 'JS', color: '#d7a829' },
  jsx: { label: 'JSX', color: '#d7a829' },
  json: { label: 'JSON', color: '#cbb026' },
  jsonc: { label: 'JSON', color: '#cbb026' },
  css: { label: 'CSS', color: '#4a9bff' },
  scss: { label: 'SCSS', color: '#cf649a' },
  sass: { label: 'SASS', color: '#cf649a' },
  less: { label: 'LESS', color: '#2a6fb0' },
  html: { label: 'HTML', color: '#e6643c' },
  htm: { label: 'HTML', color: '#e6643c' },
  xml: { label: 'XML', color: '#e6643c' },
  svg: { label: 'SVG', color: '#e0992f' },
  vue: { label: 'VUE', color: '#41b883' },
  md: { label: 'MD', color: '#6a9fd8' },
  mdx: { label: 'MDX', color: '#6a9fd8' },
  markdown: { label: 'MD', color: '#6a9fd8' },
  py: { label: 'PY', color: '#4b8bbe' },
  rs: { label: 'RS', color: '#d98b56' },
  go: { label: 'GO', color: '#46c0d6' },
  rb: { label: 'RB', color: '#d0524a' },
  php: { label: 'PHP', color: '#8a93c4' },
  java: { label: 'JAVA', color: '#d9694b' },
  c: { label: 'C', color: '#6196cf' },
  h: { label: 'H', color: '#6196cf' },
  cpp: { label: 'C++', color: '#6196cf' },
  cc: { label: 'C++', color: '#6196cf' },
  cs: { label: 'C#', color: '#8a6fc6' },
  sh: { label: 'SH', color: '#6cae6c' },
  bash: { label: 'SH', color: '#6cae6c' },
  zsh: { label: 'SH', color: '#6cae6c' },
  ps1: { label: 'PS', color: '#4f86c6' },
  yml: { label: 'YML', color: '#cf6f4a' },
  yaml: { label: 'YML', color: '#cf6f4a' },
  toml: { label: 'TOML', color: '#9c6b4a' },
  ini: { label: 'INI', color: '#9c9c9c' },
  env: { label: 'ENV', color: '#d7a829' },
  txt: { label: 'TXT', color: '#9c9c9c' },
  log: { label: 'LOG', color: '#9c9c9c' },
  lock: { label: 'LOCK', color: '#9c9c9c' },
  sql: { label: 'SQL', color: '#e38c00' },
  png: { label: 'IMG', color: '#c586c0' },
  jpg: { label: 'IMG', color: '#c586c0' },
  jpeg: { label: 'IMG', color: '#c586c0' },
  gif: { label: 'IMG', color: '#c586c0' },
  webp: { label: 'IMG', color: '#c586c0' },
  ico: { label: 'IMG', color: '#c586c0' },
  bmp: { label: 'IMG', color: '#c586c0' }
}

/** Resolve a file name to its badge, honouring a few well-known full names. */
function classify(name: string): FileType | null {
  const lower = name.toLowerCase()
  if (lower === 'package.json') return { label: 'NPM', color: '#cb3837' }
  if (lower === 'package-lock.json') return { label: 'LOCK', color: '#cb3837' }
  if (lower.startsWith('tsconfig')) return { label: 'TS', color: '#3178c6' }
  if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules')
    return { label: 'GIT', color: '#e6643c' }
  if (lower === '.env' || lower.startsWith('.env.')) return { label: 'ENV', color: '#d7a829' }
  const dot = lower.lastIndexOf('.')
  const ext = dot > 0 ? lower.slice(dot + 1) : ''
  return BY_EXT[ext] ?? null
}

/**
 * File-type icon for the Explorer and editor tabs. Known types render as a small
 * coloured monogram badge (VS Code "TS"/"JS" style); anything else falls back to
 * the neutral document glyph.
 */
export function FileIcon({ name, size = 15 }: { name: string; size?: number }): JSX.Element {
  const type = classify(name)
  if (!type) return <Icon name="file" size={size} />
  const fontSize = type.label.length >= 4 ? 6.8 : type.label.length === 3 ? 8 : 9.8
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="2.5"
        y="4.5"
        width="19"
        height="15"
        rx="3.5"
        fill={type.color}
        fillOpacity="0.16"
        stroke={type.color}
        strokeOpacity="0.55"
        strokeWidth="1.3"
      />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fill={type.color}
        style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '-0.4px' }}
      >
        {type.label}
      </text>
    </svg>
  )
}
