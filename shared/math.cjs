const markedKatex = require('marked-katex-extension')
const katex = require('katex')

// Shared by the editor, live reader, and Hexo so the same source renders alike.
module.exports = function mathExtension() {
  const options = { throwOnError: false, trust: false, nonStandard: true }
  const renderer = (token) => katex.renderToString(token.text, { ...options, displayMode: token.displayMode })
  return {
    extensions: [
      ...markedKatex(options).extensions,
      {
        name: 'multilineDollarInline',
        level: 'inline',
        start(src) { const index = src.indexOf('$'); return index < 0 ? undefined : index },
        tokenizer(src) {
          // Soft line breaks belong to the formula; paragraphs and code do not.
          const match = src.match(/^\$(?!\$)((?:\\[^\n]|[^\\$`])+?)\$(?!\$)/)
          if (match && match[1].includes('\n') && !/\n[ \t]*\n/.test(match[1]) && match[1].trim()) {
            return { type: 'multilineDollarInline', raw: match[0], text: match[1].trim(), displayMode: false }
          }
        },
        renderer,
      },
      {
        name: 'dollarDisplayBlock',
        level: 'block',
        start(src) { return src.match(/(?:^|\n)(?= {0,3}\$\$(?!\$))/)?.index },
        tokenizer(src) {
          // Delimiters may share a line with the formula, even across multiple lines.
          const match = src.match(/^ {0,3}\$\$(?!\$)((?:\\[\s\S]|(?!\$\$)[^\\])+?)\$\$[ \t]*(?:\n|$)/)
          if (match && match[1].trim()) return { type: 'dollarDisplayBlock', raw: match[0], text: match[1].trim(), displayMode: true }
        },
        renderer,
      },
      {
        name: 'latexBracketBlock',
        level: 'block',
        start(src) { return src.match(/(?:^|\n)(?= {0,3}\\\[)/)?.index },
        tokenizer(src) {
          const match = src.match(/^ {0,3}\\\[([\s\S]*?)\\\][ \t]*(?:\n|$)/)
          if (match) return { type: 'latexBracketBlock', raw: match[0], text: match[1].trim(), displayMode: true }
        },
        renderer,
      },
      {
        name: 'latexBracketInline',
        level: 'inline',
        start(src) {
          const index = src.search(/\\(?:\(|\[)/)
          return index === -1 ? undefined : index
        },
        tokenizer(src) {
          const match = src.match(/^\\\(([^\n]*?)\\\)/) || src.match(/^\\\[([^\n]*?)\\\]/)
          if (match) return { type: 'latexBracketInline', raw: match[0], text: match[1].trim(), displayMode: src.startsWith('\\[') }
        },
        renderer,
      },
    ],
  }
}
