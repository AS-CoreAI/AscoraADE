/** Accept either the Studio server address or its /v1 API base. */
export function normalizeUnslothBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim() || 'http://127.0.0.1:8888/v1') }
  catch { throw new Error('Unsloth: enter a valid HTTP or HTTPS server address.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Unsloth: use an HTTP or HTTPS server address without credentials, query parameters or fragments.')
  }
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/v1') ? path : `${path}/v1`
  return url.toString().replace(/\/+$/, '')
}

export function normalizeUnslothApiKey(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, '').trim()
}
