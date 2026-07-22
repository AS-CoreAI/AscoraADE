import { useEffect, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type {
  DeveloperToolId,
  DeveloperToolsInfo,
  DeveloperToolsManager,
  DeveloperToolsPlatform
} from '@shared/ipc'
import { Icon } from './Icon'
import { api } from '@/lib/api'
import { tr, type TranslationKey } from '@/language'
import { useApp } from '@/state/store'

interface DeveloperToolsModalProps {
  open: boolean
  onClose: () => void
}

interface ToolDefinition {
  id: DeveloperToolId
  name: string
  descriptionKey: TranslationKey
  windows: string
  linux: Record<'apt' | 'dnf' | 'pacman', string>
  macos: string
}

const PLATFORMS: DeveloperToolsPlatform[] = ['win32', 'linux', 'darwin']

const TOOLS: ToolDefinition[] = [
  {
    id: 'ripgrep',
    name: 'ripgrep',
    descriptionKey: 'tools.ripgrepDescription',
    windows: 'winget install --id BurntSushi.ripgrep.MSVC -e',
    linux: { apt: 'sudo apt install ripgrep', dnf: 'sudo dnf install ripgrep', pacman: 'sudo pacman -S ripgrep' },
    macos: 'brew install ripgrep'
  },
  {
    id: 'fd',
    name: 'fd',
    descriptionKey: 'tools.fdDescription',
    windows: 'winget install --id sharkdp.fd -e',
    linux: { apt: 'sudo apt install fd-find', dnf: 'sudo dnf install fd-find', pacman: 'sudo pacman -S fd' },
    macos: 'brew install fd'
  },
  {
    id: 'jq',
    name: 'jq',
    descriptionKey: 'tools.jqDescription',
    windows: 'winget install --id jqlang.jq -e',
    linux: { apt: 'sudo apt install jq', dnf: 'sudo dnf install jq', pacman: 'sudo pacman -S jq' },
    macos: 'brew install jq'
  },
  {
    id: 'sevenZip',
    name: '7-Zip',
    descriptionKey: 'tools.sevenZipDescription',
    windows: 'winget install --id 7zip.7zip -e',
    linux: { apt: 'sudo apt install p7zip-full', dnf: 'sudo dnf install p7zip p7zip-plugins', pacman: 'sudo pacman -S 7zip' },
    macos: 'brew install sevenzip'
  },
  {
    id: 'llvm',
    name: 'LLVM',
    descriptionKey: 'tools.llvmDescription',
    windows: 'winget install --id LLVM.LLVM -e',
    linux: { apt: 'sudo apt install clang', dnf: 'sudo dnf install clang', pacman: 'sudo pacman -S clang' },
    macos: 'brew install llvm'
  },
  {
    id: 'pandoc',
    name: 'Pandoc',
    descriptionKey: 'tools.pandocDescription',
    windows: 'winget install --id JohnMacFarlane.Pandoc -e',
    linux: { apt: 'sudo apt install pandoc', dnf: 'sudo dnf install pandoc', pacman: 'sudo pacman -S pandoc-cli' },
    macos: 'brew install pandoc'
  },
  {
    id: 'libreOffice',
    name: 'LibreOffice',
    descriptionKey: 'tools.libreOfficeDescription',
    windows: 'winget install --id TheDocumentFoundation.LibreOffice -e',
    linux: { apt: 'sudo apt install libreoffice', dnf: 'sudo dnf install libreoffice', pacman: 'sudo pacman -S libreoffice-fresh' },
    macos: 'brew install --cask libreoffice'
  },
  {
    id: 'imageMagick',
    name: 'ImageMagick',
    descriptionKey: 'tools.imageMagickDescription',
    windows: 'winget install --id ImageMagick.ImageMagick -e',
    linux: { apt: 'sudo apt install imagemagick', dnf: 'sudo dnf install ImageMagick', pacman: 'sudo pacman -S imagemagick' },
    macos: 'brew install imagemagick'
  },
  {
    id: 'qpdf',
    name: 'QPDF',
    descriptionKey: 'tools.qpdfDescription',
    windows: 'winget install --id QPDF.QPDF -e',
    linux: { apt: 'sudo apt install qpdf', dnf: 'sudo dnf install qpdf', pacman: 'sudo pacman -S qpdf' },
    macos: 'brew install qpdf'
  },
  {
    id: 'poppler',
    name: 'Poppler',
    descriptionKey: 'tools.popplerDescription',
    windows: 'winget install --id oschwartz10612.Poppler -e',
    linux: { apt: 'sudo apt install poppler-utils', dnf: 'sudo dnf install poppler-utils', pacman: 'sudo pacman -S poppler' },
    macos: 'brew install poppler'
  },
  {
    id: 'graphviz',
    name: 'Graphviz',
    descriptionKey: 'tools.graphvizDescription',
    windows: 'winget install --id Graphviz.Graphviz -e',
    linux: { apt: 'sudo apt install graphviz', dnf: 'sudo dnf install graphviz', pacman: 'sudo pacman -S graphviz' },
    macos: 'brew install graphviz'
  },
  {
    id: 'tesseract',
    name: 'Tesseract OCR',
    descriptionKey: 'tools.tesseractDescription',
    windows: 'winget install --id UB-Mannheim.TesseractOCR -e',
    linux: { apt: 'sudo apt install tesseract-ocr', dnf: 'sudo dnf install tesseract', pacman: 'sudo pacman -S tesseract' },
    macos: 'brew install tesseract'
  }
]

const PLATFORM_LABELS: Record<DeveloperToolsPlatform, TranslationKey> = {
  win32: 'tools.platformWindows',
  linux: 'tools.platformLinux',
  darwin: 'tools.platformMacos'
}

function supportedPlatform(platform: NodeJS.Platform): platform is DeveloperToolsPlatform {
  return PLATFORMS.some((candidate) => candidate === platform)
}

function linuxManager(manager?: DeveloperToolsManager): 'apt' | 'dnf' | 'pacman' {
  return manager === 'dnf' || manager === 'pacman' ? manager : 'apt'
}

function commandFor(
  tool: ToolDefinition,
  platform: DeveloperToolsPlatform,
  manager?: DeveloperToolsManager
): string {
  if (platform === 'win32') return tool.windows
  if (platform === 'darwin') return tool.macos
  return tool.linux[linuxManager(manager)]
}

export function DeveloperToolsModal({ open, onClose }: DeveloperToolsModalProps): JSX.Element | null {
  const language = useApp((state) => state.appLanguage)
  const t = (key: TranslationKey, values?: Record<string, string | number>): string =>
    tr(language, key, values)
  const currentPlatform = supportedPlatform(api.system.platform) ? api.system.platform : 'win32'
  const [platform, setPlatform] = useState<DeveloperToolsPlatform>(currentPlatform)
  const [info, setInfo] = useState<DeveloperToolsInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [installingIds, setInstallingIds] = useState<DeveloperToolId[]>([])
  const [installedIds, setInstalledIds] = useState<Set<DeveloperToolId>>(new Set())
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const busy = installingIds.length > 0

  const refresh = async (): Promise<void> => {
    setChecking(true)
    setMessage(null)
    try {
      const next = await api.developerTools.inspect()
      setInfo(next)
      setInstalledIds(new Set(next.tools.filter((tool) => tool.installed).map((tool) => tool.id)))
    } catch {
      setInfo({
        platform: api.system.platform,
        available: false,
        tools: []
      })
      setInstalledIds(new Set())
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setPlatform(currentPlatform)
    void refresh()
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [busy, onClose, open])

  const installable = platform === currentPlatform && info?.available === true
  const missingIds = useMemo(
    () => TOOLS.filter((tool) => !installedIds.has(tool.id)).map((tool) => tool.id),
    [installedIds]
  )

  const install = async (ids: DeveloperToolId[]): Promise<void> => {
    if (!installable || busy || ids.length === 0) return
    setInstallingIds(ids)
    setMessage(null)
    try {
      const result = await api.developerTools.install(ids)
      if (result.installed.length > 0) {
        setInstalledIds((current) => new Set([...current, ...result.installed]))
      }
      if (result.ok) {
        setMessage({
          kind: 'success',
          text: t('tools.installSuccess', { count: result.installed.length })
        })
      } else {
        const detail = result.error
          ?.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
          ?.split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-2)
          .join(' ')
          .slice(0, 360)
        setMessage({
          kind: 'error',
          text: `${t('tools.installFailed')}${detail ? ` ${detail}` : ''}`
        })
      }
    } catch (error) {
      setMessage({
        kind: 'error',
        text: `${t('tools.installFailed')} ${error instanceof Error ? error.message : String(error)}`
      })
    } finally {
      setInstallingIds([])
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="modal-backdrop tools-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        className="modal tools-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="developer-tools-title"
        aria-describedby="developer-tools-description"
        data-testid="developer-tools-modal"
      >
        <header className="tools-modal-header">
          <span className="tools-modal-symbol"><Icon name="terminal" size={19} /></span>
          <div>
            <h2 id="developer-tools-title">{t('tools.title')}</h2>
            <p id="developer-tools-description">{t('tools.subtitle')}</p>
          </div>
          <button
            className="modal-close"
            title={t('common.close')}
            aria-label={t('common.close')}
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="tools-platform-tabs" role="tablist" aria-label={t('tools.operatingSystem')}>
          {PLATFORMS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={platform === item}
              className={platform === item ? 'active' : undefined}
              onClick={() => {
                setPlatform(item)
                setMessage(null)
              }}
            >
              <span className="tools-platform-dot" />
              {t(PLATFORM_LABELS[item])}
              {item === currentPlatform && <small>{t('tools.currentSystem')}</small>}
            </button>
          ))}
        </div>

        <div className="tools-modal-meta">
          {platform !== currentPlatform ? (
            <span><Icon name="info" size={14} />{t('tools.currentSystemOnly')}</span>
          ) : info && !info.available ? (
            <span className="error"><Icon name="info" size={14} />{t('tools.managerMissing')}</span>
          ) : (
            <span>
              <Icon name="check" size={14} />
              {checking ? t('common.checking') : t('tools.managerLabel', { manager: info?.manager ?? '…' })}
            </span>
          )}
          {platform === currentPlatform && (
            <button type="button" disabled={checking || busy} onClick={() => void refresh()}>
              <Icon name="refresh" size={13} />{t('common.refresh')}
            </button>
          )}
        </div>

        <div className="tools-list">
          {TOOLS.map((tool) => {
            const installed = platform === currentPlatform && installedIds.has(tool.id)
            const installing = installingIds.includes(tool.id)
            return (
              <article className="tool-card" key={tool.id}>
                <div className="tool-card-icon" aria-hidden="true">{tool.name.slice(0, 2).toUpperCase()}</div>
                <div className="tool-card-copy">
                  <div className="tool-card-title">
                    <strong>{tool.name}</strong>
                    {installed && <span className="tool-installed"><Icon name="check" size={11} />{t('tools.installed')}</span>}
                  </div>
                  <p>{t(tool.descriptionKey)}</p>
                  <code title={commandFor(tool, platform, info?.manager)}>
                    {commandFor(tool, platform, info?.manager)}
                  </code>
                </div>
                <button
                  className="tool-install-button"
                  type="button"
                  disabled={!installable || installed || busy || checking}
                  onClick={() => void install([tool.id])}
                  aria-label={`${t(installed ? 'tools.installed' : 'tools.install')} ${tool.name}`}
                >
                  {installing ? <span className="tools-spinner" /> : installed ? <Icon name="check" size={13} /> : <Icon name="arrowDown" size={13} />}
                  {installing ? t('tools.installing') : installed ? t('tools.installed') : t('tools.install')}
                </button>
              </article>
            )
          })}
        </div>

        <footer className="tools-modal-footer">
          <div aria-live="polite">
            {message && <span className={`tools-result ${message.kind}`}>{message.text}</span>}
          </div>
          <button
            className="tools-install-all"
            type="button"
            disabled={!installable || missingIds.length === 0 || busy || checking}
            onClick={() => void install(missingIds)}
          >
            {busy && installingIds.length > 1 ? <span className="tools-spinner" /> : <Icon name="arrowDown" size={14} />}
            {busy && installingIds.length > 1
              ? t('tools.installing')
              : missingIds.length === 0
                ? t('tools.allInstalled')
                : t('tools.installAll', { count: missingIds.length })}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}
