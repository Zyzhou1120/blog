import { build } from 'esbuild'

await build({
  entryPoints: ['editor-src/app.js'],
  outfile: 'source/editor/editor.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
})
