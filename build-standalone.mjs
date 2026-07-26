// Builds a single self-contained index.html from src/ — no dev server, no
// external app bundle. GitHub Pages (served from the branch root) can read it
// directly. Re-run this after editing anything under src/:  node build-standalone.mjs
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const srcDir = join(root, 'src')

// Entry mirrors src/main.jsx but skips the CSS imports (we inline those below).
const entry = `
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)
`

const result = await build({
  stdin: { contents: entry, resolveDir: srcDir, loader: 'jsx', sourcefile: 'entry.jsx' },
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.css': 'empty' }, // App.jsx imports App.css; ignore here, inlined as <style>
  define: {
    'import.meta.env.VITE_ANTHROPIC_API_KEY': '""',
    'process.env.NODE_ENV': '"production"',
  },
  write: false,
})

// Escaping "</script" keeps a stray closing tag inside a JS string from ending
// the inline <script> block early. Harmless everywhere else in JS.
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const css = ['index.css', 'App.css', 'agent/agent.css']
  .map((file) => readFileSync(join(srcDir, file), 'utf8'))
  .join('\n')

const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Stockly AI</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>${js}</script>
  </body>
</html>
`

writeFileSync(join(root, 'index.html'), html)
console.log('Wrote index.html —', (html.length / 1024).toFixed(0), 'KB')
