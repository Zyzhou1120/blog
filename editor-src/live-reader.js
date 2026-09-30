import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { parse } from 'yaml'
import mathExtension from '../shared/math.cjs'
import { liveEndpoint, liveRequest, liveUrl } from './live-api.js'

marked.use(mathExtension())
marked.setOptions({ breaks: true })
const script = document.currentScript?.src
const root = script ? new URL('../', script) : new URL('/blog/', location.href)
const reader = document.getElementById('live-reader')

function content(post) {
  const match = post.text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  let meta = {}
  try { meta = match ? parse(match[1], { maxAliasCount: 20 }) || {} : {} } catch { /* Still display a readable article. */ }
  return { ...post, title: String(meta.title || post.name.replace(/\.md$/, '')), date: String(meta.date || '').slice(0, 10), description: String(meta.description || ''), categories: [meta.categories || []].flat().map(String), body: match ? post.text.slice(match[0].length) : post.text }
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
  const title = document.querySelector('.post-title') || document.querySelector('#page .page-title')
  if (title) title.textContent = post.title
  else if (reader) target.prepend(element('h1', '', post.title))
  document.title = `${post.title} | 我的博客`
  const meta = document.querySelector('#post-meta .meta-firstline')
  if (meta) meta.textContent = `发表于 ${post.date} · 更新于 ${new Date(post.updated).toLocaleString('zh-CN')} ${post.categories.length ? ' · ' + post.categories.join('、') : ''}`
  const tags = document.querySelector('.tag_share')
  if (tags) tags.hidden = true // Static tag links can refer to metadata from an older build.
  const toc = document.getElementById('card-toc')
  if (toc) toc.hidden = true // Avoid stale heading links after replacing the article.
  const canonical = document.querySelector('link[rel="canonical"]')
  if (reader && canonical) canonical.href = liveUrl(post.name, root)
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
  const cache = new Map()
  let syncing = false
  let again = false
  let connected = false
  let socket
  let reconnect
  let backoff = 1000
  const status = element('div', '', '正在连接实时更新…')
  status.style.cssText = 'font-size:12px;color:#70838d;text-align:right;padding:6px 12px'
  status.setAttribute('role', 'status')
  ;(reader || document.getElementById('post') || document.getElementById('recent-posts'))?.append(status)

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
      const recent = document.querySelector('.card-recent-post .aside-list')
      if (recent) recent.replaceChildren(...posts.slice(0, 5).map((post) => {
        const item = element('div', 'aside-list-item no-cover')
        const info = element('div', 'content')
        info.append(link(post, 'title'), element('time', '', post.date))
        item.append(info)
        return item
      }))
      const feed = home ? document.querySelector('#recent-posts .recent-post-items') : archive ? document.querySelector('#archive .article-sort') : null
      if (feed) {
        const selected = archive ? posts.filter((post) => {
          const parts = location.pathname.slice(`${root.pathname}archives/`.length).split('/').filter(Boolean)
          return !parts.length || post.date.startsWith(parts.join('-'))
        }) : posts
        feed.replaceChildren(...selected.map((post) => {
          const item = element('div', home ? 'recent-post-item' : 'article-sort-item')
          const info = element('div', home ? 'recent-post-info no-cover' : 'article-sort-item-info')
          info.append(link(post, home ? 'article-title' : 'article-sort-item-title'), element('div', 'article-meta-wrap', post.date), element('div', 'content', post.description || post.body.replace(/[#*`>]/g, '').slice(0, 150)))
          item.append(info)
          return item
        }))
        document.getElementById('pagination')?.remove()
      }
      if (!status.isConnected) (reader || document.getElementById('post'))?.append(status)
      status.textContent = connected ? '已连接实时更新' : '已读取最新内容；正在连接实时更新…'
    } catch (error) {
      if (reader && !document.getElementById('blog-publication')) reader.textContent = error.status === 404 ? '没有找到这篇文章，请返回首页。' : '暂时无法读取文章，正在重试…'
      status.textContent = '实时连接暂时中断，保留当前内容，稍后自动重试'
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
    socket.onopen = () => { connected = true; backoff = 1000; void sync() }
    socket.onmessage = (event) => { if (event.data !== 'pong') void sync() }
    socket.onclose = () => {
      connected = false
      status.textContent = '实时连接中断，正在重连…'
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
