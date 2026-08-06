// Sanity checks on the built page: structure, substituted env, and that the
// Arabic UI strings survived bundling (esbuild escapes them by default).
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const escapedArabic = html.match(/\\u06[0-9a-f]{2}/gi) || []
const rawArabic = html.match(/[؀-ۿ]/g) || []

const checks = {
  'doctype present': html.startsWith('<!doctype html>'),
  'root element': html.includes('id="root"'),
  'document closes': html.trim().endsWith('</html>'),
  'no unreplaced import.meta': !html.includes('import.meta'),
  'agent styles inlined': html.includes('agent-panel') && html.includes('commands-card'),
  'api routes referenced': ['chat', 'stt', 'tts'].every((r) => html.includes(`/api/agent/${r}`)),
  'arabic strings present': escapedArabic.length + rawArabic.length > 100,
  'rtl shell': html.includes('dir="rtl"'),
}

let failed = 0
for (const [name, passed] of Object.entries(checks)) {
  if (!passed) failed += 1
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${name}`)
}
console.log(`arabic: ${escapedArabic.length} escaped, ${rawArabic.length} raw`)
process.exit(failed ? 1 : 0)
