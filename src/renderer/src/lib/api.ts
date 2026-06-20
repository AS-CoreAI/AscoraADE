/**
 * Thin accessor for the preload bridge. Importing from here (instead of
 * touching `window.ascora` directly) keeps renderer code tidy and makes the
 * bridge easy to mock in tests later.
 */
export const api = window.ascora
