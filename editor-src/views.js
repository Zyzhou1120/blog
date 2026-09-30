import { liveRequest } from './live-api.js'

const counts = new Map()
const pending = new Map()

export function showArticleViews(post, container) {
  let label = container.querySelector('.article-views')
  if (!label) {
    label = document.createElement('span')
    label.className = 'article-views'
    label.title = '同一浏览器每篇文章每天计一次'
    container.append(document.createTextNode(' · '), label)
  }
  const display = count => { label.textContent = `浏览量：${Number.isSafeInteger(count) ? count : '暂不可用'}` }
  label.textContent = counts.has(post.name) ? `浏览量：${counts.get(post.name)}` : '浏览量：加载中…'
  if (counts.has(post.name)) return
  if (!pending.has(post.name)) {
    let visitor
    try {
      visitor = localStorage.getItem('blog-views:visitor')
      if (!/^[a-f0-9-]{36}$/i.test(visitor || '')) {
        visitor = crypto.randomUUID()
        localStorage.setItem('blog-views:visitor', visitor)
      }
    } catch { visitor = null }
    // The server deduplicates retries, reloads, tabs and old article links.
    const request = liveRequest(`/views/${encodeURIComponent(post.name)}`, visitor ? { method: 'POST', body: JSON.stringify({ visitor }) } : {})
      .then(result => {
        if (!Number.isSafeInteger(result.count) || result.count < 0) throw new Error('Invalid count')
        counts.set(post.name, result.count)
        return result.count
      }).finally(() => pending.delete(post.name))
    pending.set(post.name, request)
  }
  pending.get(post.name).then(display, () => display(null))
}
