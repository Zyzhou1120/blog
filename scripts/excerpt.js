const { readFileSync } = require('node:fs')
const path = require('node:path')
const excerpt = require('../shared/excerpt.cjs')

// Build the same opening summary for visitors whose live request is still loading.
hexo.extend.filter.register('before_generate', () => {
  hexo.extend.helper.register('postDesc', (post) => {
    if (!post.source?.startsWith('_posts/')) return ''
    const source = readFileSync(path.join(hexo.source_dir, post.source), 'utf8')
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    // Butterfly inserts postDesc as HTML, so escape source text here.
    return excerpt(body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  })
})
