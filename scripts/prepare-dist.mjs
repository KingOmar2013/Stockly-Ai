// Collects the deployable static files into dist/ for Netlify. Run after
// build-standalone.mjs, which regenerates index.html.
import { cpSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')

mkdirSync(dist, { recursive: true })
copyFileSync(join(root, 'index.html'), join(dist, 'index.html'))
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), dist, { recursive: true })

console.log('Prepared dist/ for deployment')
