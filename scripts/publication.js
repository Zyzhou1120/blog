const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')

function contentSha(source) {
  const raw = readFileSync(path.join(hexo.source_dir, source))
  return createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex')
}

hexo.extend.filter.register('after_post_render', function (post) {
  if (post.source?.startsWith('_posts/')) {
    post.content += `<span hidden id="blog-publication" data-source="${encodeURIComponent(post.source.slice(7))}" data-sha="${contentSha(post.source)}"></span>`
  }
  return post
})

hexo.extend.generator.register('publication-status', function (locals) {
  const posts = {}
  for (const post of locals.posts.toArray()) {
    if (!post.source.startsWith('_posts/')) continue
    const sha = contentSha(post.source)
    posts[post.source.slice('_posts/'.length)] = {
      sha,
      url: this.extend.helper.get('url_for').call(this, post.path),
    }
  }
  return { path: 'publish-status.json', data: JSON.stringify({ commit: process.env.GITHUB_SHA || null, posts }) }
})
