import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'
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
