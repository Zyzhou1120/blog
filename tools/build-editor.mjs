import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const katexDist = join(dirname(require.resolve('katex/package.json')), 'dist')
mkdirSync('source/vendor/katex', { recursive: true })
cpSync(join(katexDist, 'katex.min.css'), 'source/vendor/katex/katex.min.css')
cpSync(join(katexDist, 'fonts'), 'source/vendor/katex/fonts', { recursive: true })

await build({
  entryPoints: ['editor-src/app.js'],
  outfile: 'source/editor/editor.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
})

await build({ entryPoints: ['editor-src/live-reader.js'], outfile: 'source/js/live.js', bundle: true, minify: true, format: 'iife', target: 'es2022' })

const config = JSON.parse(readFileSync('realtime.config.json', 'utf8'))
const origin = config.endpoint ? new URL(config.endpoint).origin : ''
if (origin && !origin.startsWith('https://')) throw new Error('The production live endpoint must use HTTPS')
const html = readFileSync('source/editor/index.html', 'utf8')
writeFileSync('source/editor/index.html', html.replace(/connect-src [^;]+;/, `connect-src 'self' https://api.github.com${origin ? ` ${origin}` : ''};`))
