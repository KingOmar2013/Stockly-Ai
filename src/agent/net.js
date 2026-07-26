/**
 * A dead API server surfaces as a bare TypeError from fetch, which reads as a
 * mystery failure in the UI. Name the actual cause instead.
 */
export function describeFetchError(error, fallback) {
  if (error instanceof TypeError) return 'Cannot reach the API server — start it with: npm run dev:server'
  return error?.message || fallback
}
