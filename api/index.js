// Vercel serverless entry: the same Express app used locally and on Netlify.
// vercel.json rewrites every /api/* request here, and req.url keeps the
// original path so the app's /api/... routes match unchanged.
import { app } from '../server.js'

export default app
