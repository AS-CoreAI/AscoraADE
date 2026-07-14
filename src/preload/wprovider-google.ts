/**
 * Preload for the visible Google sign-in window only.
 *
 * The window's user agent is spoofed to Firefox (see runner.ts) so Google's
 * sign-in accepts it as a supported browser instead of an embedded Chromium
 * frame. But the UA string is only half of the identity: the page still runs
 * on Chromium, so JS-level tells that genuine Firefox never exposes —
 * `navigator.userAgentData`, `window.chrome`, `navigator.connection`,
 * `navigator.deviceMemory` — remain present. Google's sign-in integrity check
 * (BotGuard) reads that contradiction between the Firefox UA and a Chromium
 * feature surface as an "insecure"/automated browser and blocks the login with
 * "This browser or app may not be secure".
 *
 * Running with contextIsolation OFF, this preload executes in the page's own
 * world before any page script, so removing those members makes them genuinely
 * absent (indistinguishable from real Firefox, not a detectable fake getter).
 * Nothing is exposed to the page and no network APIs are touched.
 */

const g = globalThis as unknown as {
  navigator?: Record<string, unknown>
  Navigator?: { prototype: Record<string, unknown> }
  chrome?: unknown
}

function drop(obj: Record<string, unknown> | undefined, key: string): void {
  if (!obj) return
  try {
    delete obj[key]
  } catch {
    /* non-configurable on this build — leave it rather than break the page */
  }
}

// Web IDL attributes live as configurable accessors on Navigator.prototype, so
// they must be removed there — deleting off the instance would be a no-op.
drop(g.Navigator?.prototype, 'userAgentData')
drop(g.Navigator?.prototype, 'connection')
drop(g.Navigator?.prototype, 'deviceMemory')
// window.chrome is a plain own data property of the global object.
drop(g, 'chrome')
