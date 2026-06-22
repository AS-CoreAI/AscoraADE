import { useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '@/state/store'

/**
 * Live Server preview content, hosted inside a dockview panel (the panel's tab
 * provides the title, drag handle and close button). Renders the served HTML in
 * an iframe that auto-reloads on file changes, with a slim toolbar to reload,
 * pop out into a separate window, or open in the system browser.
 */
export function LivePreview(): JSX.Element | null {
  const previewUrl = useApp((s) => s.previewUrl)
  const detachPreview = useApp((s) => s.detachPreview)
  const openPreviewInBrowser = useApp((s) => s.openPreviewInBrowser)
  // Bumping the key remounts the iframe → a hard reload of the page.
  const [reloadKey, setReloadKey] = useState(0)

  if (!previewUrl) return null

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <button title="Reload" onClick={() => setReloadKey((k) => k + 1)}>
          <Icon name="refresh" size={14} />
        </button>
        <button title="Open in a separate window" onClick={detachPreview}>
          <Icon name="maximize" size={13} />
        </button>
        <button title="Open in the system browser" onClick={openPreviewInBrowser}>
          <Icon name="external" size={14} />
        </button>
        <span className="preview-url" title={previewUrl}>
          {previewUrl}
        </span>
      </div>
      <div className="preview-host">
        <iframe
          key={reloadKey}
          className="preview-frame"
          src={previewUrl}
          title="Live Preview"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
        />
      </div>
    </div>
  )
}
