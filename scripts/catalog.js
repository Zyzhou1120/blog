const { readFileSync } = require('node:fs')
const path = require('node:path')
const { comparePosts, priority } = require('../shared/catalog.cjs')

hexo.extend.filter.register('before_generate', function () {
  const posts = hexo.locals.get('posts').toArray()
  const sorted = posts.map(post => ({ post, name: post.source, priority: priority(post.priority), date: post.date.toISOString() })).sort(comparePosts)
  sorted.forEach((item, index) => {
    item.post._blogOrder = index
    item.post.priority = item.priority
    item.post.sticky = item.priority
  })
})

// Search still works against the last built articles if the live service is unavailable.
hexo.extend.generator.register('blog-catalog', function (locals) {
  const posts = locals.posts.toArray().filter(post => post.source?.startsWith('_posts/')).map(post => ({
    name: post.source.slice(7),
    text: readFileSync(path.join(this.source_dir, post.source), 'utf8'),
    updated: post.updated.toISOString(),
    href: this.extend.helper.get('url_for').call(this, post.path),
  }))
  return { path: 'blog-catalog.json', data: JSON.stringify({ posts }) }
})
