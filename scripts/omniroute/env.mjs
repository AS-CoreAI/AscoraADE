// Canonical sidecar environment pins for the bundled OmniRoute gateway.
//
// Every OmniRoute env var we rely on is pinned EXPLICITLY because upstream
// defaults drift between patch releases (e.g. the live-WS port move and the
// OMNIROUTE_DISABLE_LIVE_WS -> OMNIROUTE_ENABLE_LIVE_WS rename).
//
// KEEP IN SYNC with src/main/omniroute/runner.ts (buildSidecarEnv there) —
// the smoke test must spawn the sidecar exactly like production does.

/**
 * @param {{ port: number, dataDir: string, storageKey: string }} opts
 * @returns {Record<string, string>}
 */
export function omnirouteEnvPins({ port, dataDir, storageKey }) {
  return {
    ELECTRON_RUN_AS_NODE: '1',
    OMNIROUTE_SERVER_HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
    REQUIRE_API_KEY: 'false',
    OMNIROUTE_SKIP_POSTINSTALL: '1',
    OMNIROUTE_NO_UPDATE_NOTIFIER: '1',
    // We never surface the bundled Next.js dashboard, so the live-WS side
    // channel stays off. Flip to '1' if an admin API flow turns out to need it.
    OMNIROUTE_ENABLE_LIVE_WS: '0',
    STORAGE_ENCRYPTION_KEY: storageKey,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    NODE_ENV: 'production'
  }
}
