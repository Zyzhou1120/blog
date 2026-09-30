import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { parse } from 'yaml'
import mathExtension from '../shared/math.cjs'
import { liveEndpoint, liveRequest, liveUrl } from './live-api.js'
import { categoryPaths, categoryUrl, inCategory, renderCategories } from './categories.js'

marked.use(mathExtension())
marked.setOptions({ breaks: true })
const script = document.currentScript?.src
const root = script ? new URL('../', script) : new URL('/blog/', location.href)
const reader = document.getElementById('live-reader')

function content(post) {
  const match = post.text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  let meta = {}
  try { meta = match ? parse(match[1], { maxAliasCount: 20 }) || {} : {} } catch { /* Still display a readable article. */ }
  return { ...post, title: String(meta.title || post.name.replace(/\.md$/, '')), date: String(meta.date || '').slice(0, 10), description: String(meta.description || ''), categoryPaths: categoryPaths(meta.categories), body: match ? post.text.slice(match[0].length) : post.text }
}
function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}
function link(post, className) {
  const node = element('a', className, post.title)
  node.href = liveUrl(post.name, root)
  return node
}
function renderPost(post) {
  const target = reader || document.getElementById('article-container')
  if (!target) return
  const anchor = document.getElementById('blog-publication')
  if (!reader && anchor?.dataset.sha === post.sha) return
  target.innerHTML = DOMPurify.sanitize(marked.parse(post.body), { USE_PROFILES: { html: true, svg: true, mathMl: true } })
  const marker = element('span')
  marker.id = 'blog-publication'
  marker.hidden = true
  marker.dataset.source = encodeURIComponent(post.name)
  marker.dataset.sha = post.sha
  target.append(marker)
  if (reader) renderReaderHeading(post)
  else {
    const title = document.querySelector('.post-title')
    if (title) title.textContent = post.title
  }
  document.title = `${post.title} | 我的博客`
  const meta = document.querySelector('#post-meta .meta-firstline')
  if (meta) {
    meta.textContent = `发表于 ${post.date} · 更新于 ${new Date(post.updated).toLocaleString('zh-CN')}`
    appendCategories(meta, post)
  }
  const tags = document.querySelector('.tag_share')
  if (tags) tags.hidden = true // Static tag links can refer to metadata from an older build.
  const toc = document.getElementById('card-toc')
  if (toc) toc.hidden = true // Avoid stale heading links after replacing the article.
  const canonical = document.querySelector('link[rel="canonical"]')
  if (reader && canonical) canonical.href = liveUrl(post.name, root)
}


function renderReaderHeading(post) {
  let header = document.getElementById('reader-heading')
  if (!header) {
    header = element('header', 'reader-heading')
    header.id = 'reader-heading'
    const layout = reader.closest('.layout')
    const page = reader.closest('#page')
    page?.classList.add('reader-page')
    page?.querySelector('.page-title')?.remove()
    if (layout) {
      layout.classList.add('reader-layout')
      layout.before(header)
    } else reader.before(header)
  }
  const title = element('h1', 'post-title', post.title)
  const meta = element('div', 'reader-meta')
  if (post.date) {
    const date = element('time', '', `发表于 ${post.date}`)
    date.dateTime = post.date
    meta.append(date)
  }
  appendCategories(meta, post)
  header.replaceChildren(title, meta)
}

function categoryCard(post) {
  const card = element('article', 'recent-post-item')
  const info = element('div', 'recent-post-info no-cover')
  const title = element('h2')
  title.append(link(post, 'article-title'))
  const read = link(post, 'category-read-more')
  read.textContent = '阅读全文 →'
  read.setAttribute('aria-label', `阅读：${post.title}`)
  info.append(title, read)
  card.append(info)
  return card
}

function appendCategories(target, post) {
  for (const path of post.categoryPaths) {
    target.append(document.createTextNode(' · '))
    const a = element('a', 'article-meta__categories', path.join(' / '))
    a.href = categoryUrl(path, root)
    target.append(a)
  }
}

async function start() {
  if (document.getElementById('editor-view')) return
  if (!liveEndpoint) {
    if (reader) reader.textContent = '实时阅读服务尚未启用，请从首页打开文章。'
    return
  }
  const name = reader ? new URL(location.href).searchParams.get('post') : decodeURIComponent(document.getElementById('blog-publication')?.dataset.source || '')
  const home = location.pathname === root.pathname || location.pathname === `${root.pathname}index.html`
  const archive = location.pathname.startsWith(`${root.pathname}archives/`)
  const category = location.pathname.startsWith(`${root.pathname}categories/`)
  const categoryPath = new URL(location.href).searchParams.getAll('category')
  if (category && !categoryPath.length) categoryPath.push(...location.pathname.slice(`${root.pathname}categories/`.length).split('/').filter((part) => part && part !== 'index.html').map(decodeURIComponent))
  const cache = new Map()
  let syncing = false
  let again = false
  let socket
  let reconnect
  let backoff = 1000
  async function sync() {
    if (syncing) { again = true; return }
    syncing = true
    try {
      if (name) {
        const post = await liveRequest(`/posts/${encodeURIComponent(name)}`)
        // Only disable static refresh after a live response has actually arrived.
        window.blogLiveEnabled = true
        renderPost(content(post))
      }
      const list = await liveRequest('/posts')
      const posts = []
      for (const item of list) {
        if (cache.get(item.name)?.sha !== item.sha) cache.set(item.name, content(await liveRequest(`/posts/${encodeURIComponent(item.name)}`)))
        posts.push(cache.get(item.name))
      }
      posts.sort((a, b) => b.date.localeCompare(a.date) || b.name.localeCompare(a.name))
      renderCategories(posts, root, element)
      let categoryFeed
      if (category && categoryPath.length) {
        categoryFeed = document.querySelector('#category .article-sort, #category .category-cards') || document.querySelector('.category-lists')
        const heading = document.querySelector('#category .article-sort-title, #page .page-title')
        if (heading) heading.textContent = categoryPath.join(' / ')
        const container = categoryFeed?.closest('#category, #page')
        container?.classList.add('category-page')
        categoryFeed?.classList.remove('article-sort')
        categoryFeed?.classList.add('category-cards')
        document.title = `${categoryPath.join(' / ')} | 我的博客`
      }
      const recent = document.querySelector('.card-recent-post .aside-list')
      if (recent) recent.replaceChildren(...posts.slice(0, 5).map((post) => {
        const item = element('div', 'aside-list-item no-cover')
        const info = element('div', 'content')
        info.append(link(post, 'title'), element('time', '', post.date))
        item.append(info)
        return item
      }))
      const feed = categoryFeed || (home ? document.querySelector('#recent-posts .recent-post-items') : archive ? document.querySelector('#archive .article-sort') : null)
      if (feed) {
        const selected = categoryFeed ? posts.filter((post) => inCategory(post, categoryPath)) : archive ? posts.filter((post) => {
          const parts = location.pathname.slice(`${root.pathname}archives/`.length).split('/').filter(Boolean)
          return !parts.length || post.date.startsWith(parts.join('-'))
        }) : posts
        feed.replaceChildren(...selected.map((post) => {
          if (categoryFeed) return categoryCard(post)
          const item = element('div', home ? 'recent-post-item' : 'article-sort-item')
          const info = element('div', home ? 'recent-post-info no-cover' : 'article-sort-item-info')
          info.append(link(post, home ? 'article-title' : 'article-sort-item-title'), element('div', 'article-meta-wrap', post.date), element('div', 'content', post.description || post.body.replace(/[#*`>]/g, '').slice(0, 150)))
          appendCategories(info.querySelector('.article-meta-wrap'), post)
          item.append(info)
          return item
        }))
        if (!selected.length) feed.append(element('p', '', '这个分类下暂无文章。'))
        document.getElementById('pagination')?.remove()
      }
    } catch (error) {
      if (reader && !document.getElementById('blog-publication')) reader.textContent = error.status === 404 ? '没有找到这篇文章，请返回首页。' : '暂时无法读取文章，正在重试…'
    } finally {
      syncing = false
      if (again) { again = false; void sync() }
    }
  }
  function connect() {
    if (document.visibilityState === 'hidden' || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
    const url = new URL('/events', liveEndpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(url)
    socket.onopen = () => { backoff = 1000; void sync() }
    socket.onmessage = (event) => { if (event.data !== 'pong') void sync() }
    socket.onclose = () => {
      clearTimeout(reconnect)
      reconnect = setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, 30000)
    }
    socket.onerror = () => socket.close()
  }
  void sync()
  connect()
  setInterval(() => {
    if (document.visibilityState === 'hidden') return
    if (socket?.readyState === WebSocket.OPEN) socket.send('ping')
    else { connect(); void sync() }
  }, 30000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') { connect(); void sync() }
    else socket?.close()
  })
  window.addEventListener('focus', () => { connect(); void sync() })
  window.addEventListener('pagehide', () => { clearTimeout(reconnect); socket?.close() })
}
void start()
