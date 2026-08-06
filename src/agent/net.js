/**
 * Where the API server lives. Empty means "same origin", which is what the Vite
 * dev proxy provides locally. For a static deploy (GitHub Pages) this must point
 * at the host running server.js, e.g. https://stockly-api.onrender.com
 */
// The bare `import.meta.env.VITE_API_BASE` expression is what the build
// replaces, so it has to survive verbatim — but it throws outside a bundler
// (plain Node, tests), where an empty base is the right answer anyway.
let configuredBase = ''
try {
  configuredBase = import.meta.env.VITE_API_BASE || ''
} catch {
  configuredBase = ''
}

export const API_BASE = configuredBase.replace(/\/$/, '')

export const apiUrl = (path) => `${API_BASE}${path}`

/**
 * A dead or unreachable API server surfaces as a bare TypeError from fetch, and
 * a static host answers POSTs with 405 — both read as a mystery failure in the
 * UI. Name the actual cause instead.
 */
export function describeFetchError(error, fallback) {
  if (error instanceof TypeError) {
    return API_BASE
      ? `Cannot reach the API server at ${API_BASE}.`
      : 'Cannot reach the API server — start it with: npm run dev:server'
  }
  return error?.message || fallback
}

/** Turns a non-ok response into a message that says what actually went wrong. */
export function describeHttpError(status, bodyError, fallback) {
  if (bodyError) return bodyError
  if (status === 405 || status === 404) {
    return API_BASE
      ? `${fallback} The API server at ${API_BASE} has no such route (HTTP ${status}).`
      : `${fallback} This page is served by a static host that cannot run the API — set VITE_API_BASE to your API server (HTTP ${status}).`
  }
  return `${fallback} (HTTP ${status})`
}
