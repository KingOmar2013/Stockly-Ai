// Vercel serverless entry. The filename is a catch-all, so every /api/* request
// maps here directly without needing a rewrite, and req.url keeps its original
// path so the Express routes (/api/agent/chat, ...) match unchanged.
import { app } from '../server.js'

export default function handler(req, res) {
  // Vercel's runtime already consumed and parsed the request body: JSON becomes
  // an object, anything else a Buffer. Flag it as parsed so Express's
  // express.json() / express.raw() skip re-reading a stream that is now empty.
  if (req.body !== undefined) req._body = true
  return app(req, res)
}
