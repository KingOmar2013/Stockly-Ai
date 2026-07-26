// Netlify runs the same Express app as local development and any plain Node
// host; netlify.toml rewrites /api/* onto this function.
import serverless from 'serverless-http'
import { app } from '../../server.js'

const PREFIX = '/.netlify/functions/api'

const wrapped = serverless(app, {
  // Audio flows both ways — uploads to /api/agent/stt and mp3 out of
  // /api/agent/tts — so these must survive as binary rather than be mangled
  // as UTF-8 text.
  binary: ['audio/*', 'application/octet-stream'],
})

/**
 * Netlify invokes this with the rewritten path
 * (/.netlify/functions/api/api/agent/chat). Strip the function prefix so the
 * Express routes, which are declared as /api/..., still match.
 */
export const handler = (event, context) => {
  const path = event.path?.startsWith(PREFIX) ? event.path.slice(PREFIX.length) || '/' : event.path
  const rawUrl = event.rawUrl?.replace(PREFIX, '')
  return wrapped({ ...event, path, ...(rawUrl ? { rawUrl } : {}) }, context)
}
