// Shared helpers for OmniRoute's live model list (`/v1/models`).

/** `auto/*` and `combo:` are virtual routing entries, not a single provider model. */
export function isAutoOmniModel(id: string): boolean {
  return id === 'auto' || id.startsWith('auto/') || id.startsWith('combo:')
}
