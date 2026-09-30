const { marked } = require('marked')

// Use source tokens, so formula accessibility markup cannot duplicate the excerpt.
module.exports = function excerpt(markdown) {
  function plain(tokens) {
    return tokens.map((token) => {
      if (token.type === 'html' || token.type === 'image' || token.type === 'hr') return ' '
      if (token.type === 'list') return token.items.map((item) => plain(item.tokens)).join(' ')
      if (token.type === 'table') return [...token.header, ...token.rows.flat()].map((cell) => plain(cell.tokens)).join(' ')
      const text = token.tokens ? plain(token.tokens) : token.text || ''
      return ['paragraph', 'heading', 'code', 'blockquote', 'space', 'br'].includes(token.type) ? ` ${text} ` : text
    }).join('')
  }
  return plain(marked.lexer(markdown || '')).replace(/\$\$?|\\[()[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 600)
}
