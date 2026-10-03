// Keep the renderer's original block markup and link definitions. Source positions
// refer to the body textarea (metadata lives in separate fields).
export function renderSourcePreview(marked, source) {
  const tokens = marked.lexer(source)
  let line = 0
  return tokens.map((token) => {
    const start = line
    line += (token.raw.match(/\n/g) || []).length
    const block = [token]
    block.links = tokens.links
    const html = marked.parser(block)
    return html.replace(/^(\s*<[a-z][\w-]*)(?=[\s>])/i, `$1 data-source-line="${start}"`)
  }).join('')
}
