import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { parse } from 'yaml'
import excerpt from '../shared/excerpt.cjs'
import mathExtension from '../shared/math.cjs'
import { liveEndpoint, liveRequest, liveUrl } from './live-api.js'
import { categoryPaths, categoryUrl, inCategory, renderCategories } from './categories.js'
import { showArticleViews } from './views.js'
import { mountInteractions } from './interactions.js'
import catalog from '../shared/catalog.cjs'
import { setupSearch } from './search.js'
import { renderArticleNavigation } from './article-navigation.js'

marked.use(mathExtension())
marked.setOptions({ breaks: true })
const script = document.currentScript?.src
const root = script ? new URL('../', script) : new URL('/blog/', location.href)
const reader = document.getElementById('live-reader')

function content(post) {
  const match = post.text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  let meta = {}
  try { meta = match ? parse(match[1], { maxAliasCount: 20 }) || {} : {} } catch { /* Still display a readable article. */ }
  return { ...post, title: String(meta.title || post.name.replace(/\.md$/, '')), date: String(meta.date || '').slice(0, 10), publishedAt: String(meta.date || ''), priority: catalog.priority(meta.priority), description: String(meta.description || ''), updatedDate: String(meta.updated || post.updated || meta.date || ''), categoryPaths: categoryPaths(meta.categories), private: meta.private === true, body: match ? post.text.slice(match[0].length) : post.text }
}
function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}
function link(post, className) {
  const node = element('a', className, post.title)
  node.href = post.href || liveUrl(post.name, root)
  return node
}
const unlocked = new Map()

function renderLockedPost(post) {
  const target = reader || document.getElementById('article-container')
  if (!target) return
  const form = element('form', 'private-unlock')
  const label = element('label', '', '阅读密码')
  const input = element('input')
  input.type = 'password'
  input.required = true
  input.autocomplete = 'current-password'
  const button = element('button', '', '解锁文章')
  button.type = 'submit'
  const status = element('p', 'private-unlock-status')
  status.setAttribute('role', 'status')
  label.append(input)
  form.append(label, button, status)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    button.disabled = true
    status.textContent = '正在验证…'
    try {
      const result = await liveRequest(`/unlock/${encodeURIComponent(post.name)}`, { method: 'POST', body: JSON.stringify({ password: input.value }) })
      unlocked.set(post.name, { updated: post.updated, text: result.text })
      renderPost(content({ ...post, text: result.text }), true)
    } catch (error) {
      status.textContent = error.message || '暂时无法解锁，请稍后重试。'
      button.disabled = false
    }
  })
  const marker = element('span')
  marker.id = 'blog-publication'
  marker.hidden = true
  marker.dataset.source = encodeURIComponent(post.name)
  marker.dataset.sha = post.sha
  marker.dataset.updated = post.updated
  marker.dataset.unlocked = 'false'
  target.replaceChildren(element('p', 'private-lock-label', '这篇文章需要密码阅读。'), form, marker)
  document.getElementById('article-interactions')?.remove()
  if (reader) renderReaderHeading(post)
  else {
    const title = document.querySelector('.post-title')
    if (title) title.textContent = post.title
  }
  document.title = `${post.title} | 舟遥的博客`
  renderArticleNavigation(target)
}

function renderPost(post, isUnlocked = false) {
  const target = reader || document.getElementById('article-container')
  if (!target) return
  if (post.private && !isUnlocked) return renderLockedPost(post)
  mountInteractions(post, document.getElementById('article-container') || target)
  const anchor = document.getElementById('blog-publication')
  if (!reader) {
    const meta = document.querySelector('#post-meta .meta-secondline') || document.querySelector('#post-meta') || document.querySelector('#post')
    if (meta) {
      meta.querySelector('.post-meta-pv-cv')?.remove()
      showArticleViews(post, meta)
    }
  }
  if (!reader && anchor?.dataset.sha === post.sha && anchor.dataset.updated === post.updated && anchor.dataset.unlocked === String(isUnlocked)) return
  target.innerHTML = DOMPurify.sanitize(marked.parse(post.body), { USE_PROFILES: { html: true, svg: true, mathMl: true } })
  const marker = element('span')
  marker.id = 'blog-publication'
  marker.hidden = true
  marker.dataset.source = encodeURIComponent(post.name)
  marker.dataset.sha = post.sha
  marker.dataset.updated = post.updated
  marker.dataset.unlocked = String(isUnlocked)
  target.append(marker)
  if (reader) renderReaderHeading(post)
  else {
    const title = document.querySelector('.post-title')
    if (title) title.textContent = post.title
  }
  document.title = `${post.title} | 舟遥的博客`
  const meta = document.querySelector('#post-meta .meta-firstline')
  if (meta) {
    meta.textContent = `发表于 ${post.date} · 更新于 ${new Date(post.updated).toLocaleString('zh-CN')}`
    appendCategories(meta, post)
  }
  const tags = document.querySelector('.tag_share')
  if (tags) tags.hidden = true // Static tag links can refer to metadata from an older build.
  renderArticleNavigation(target)
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
  showArticleViews(post, meta)
  header.replaceChildren(title, meta)
}

function articleCard(post) {
  const card = element('article', 'blog-post-card')
  const info = element('div', 'blog-post-info')
  const title = element('h2', 'blog-post-title')
  title.append(link(post, 'article-title'))
  const dates = element('div', 'blog-post-dates')
  const addDate = (label, value, icon) => {
    if (!value) return
    const group = element('span', 'blog-post-date')
    const glyph = element('i', icon)
    glyph.setAttribute('aria-hidden', 'true')
    const time = element('time', '', value)
    time.dateTime = value
    group.append(glyph, document.createTextNode(label + ' '), time)
    if (dates.childNodes.length) dates.append(element('span', 'blog-date-separator', '|'))
    dates.append(group)
  }
  addDate('发表于', post.date, 'far fa-calendar-alt')
  let updated = post.updatedDate || post.updated || post.date
  if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    const date = new Date(updated)
    updated = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  }
  addDate('更新于', updated, 'fas fa-history')
  const summary = element('p', 'blog-post-excerpt', post.private ? '需要密码阅读' : post.excerpt ?? excerpt(post.body))
  if (post.private) title.prepend(element('i', 'fas fa-lock'))
  info.append(title, dates, summary)
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
  const builtArticle = document.querySelector('#post #article-container')
  if (builtArticle) renderArticleNavigation(builtArticle)
  // Normalize the built homepage immediately, even if the live service is unavailable.
  const homeFeed = document.querySelector('#recent-posts .recent-post-items')
  if (homeFeed) {
    const cards = [...homeFeed.querySelectorAll('.article-title')].map((a) => {
      const info = a.closest('.recent-post-info')
      const dates = info?.querySelectorAll('time') || []
      return articleCard({ title: a.textContent, href: a.href, date: dates[0]?.textContent, updatedDate: dates[1]?.textContent, excerpt: info?.querySelector('.content')?.textContent || '' })
    })
    homeFeed.classList.add('post-cards')
    homeFeed.replaceChildren(...cards)
  }
  const searchHost = document.getElementById('blog-search-page')
  const searchControls = setupSearch({ host: searchHost || homeFeed, root, articleCard, searchPage: Boolean(searchHost) })
  let receivedLiveCatalog = false
  if (searchControls) {
    void fetch(new URL('blog-catalog.json', root), { cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('Catalog unavailable'); return response.json() })
      .then(data => { if (!receivedLiveCatalog && Array.isArray(data.posts)) searchControls.setPosts(data.posts.map(content)) })
      .catch(() => searchControls.error())
  }
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
        try {
          const post = await liveRequest(`/posts/${encodeURIComponent(name)}`)
          // Only disable static refresh after a live response has actually arrived.
          window.blogLiveEnabled = true
          const cached = unlocked.get(post.name)
          if (cached && cached.updated !== post.updated) unlocked.delete(post.name)
          const active = unlocked.get(post.name)
          renderPost(content(active ? { ...post, text: active.text } : post), Boolean(active))
        } catch (error) {
          if (error.status !== 404) throw error
          window.blogLiveEnabled = true
          const article = reader || document.getElementById('article-container')
          if (article) article.textContent = '这篇文章已删除，请返回首页。'
          document.getElementById('reader-heading')?.remove()
          const title = document.querySelector('.post-title')
          if (title) title.textContent = '文章已删除'
          document.title = '文章已删除 | 舟遥的博客'
        }
      }
      const list = await liveRequest('/posts')
      const posts = []
      for (const item of list) {
        if (cache.get(item.name)?.sha !== item.sha || cache.get(item.name)?.updated !== item.updated) cache.set(item.name, content(await liveRequest(`/posts/${encodeURIComponent(item.name)}`)))
        posts.push(cache.get(item.name))
      }
      posts.sort(catalog.comparePosts)
      receivedLiveCatalog = true
      searchControls?.setPosts(posts)
      renderCategories(posts, root, element)
      let categoryFeed
      if (category && categoryPath.length) {
        categoryFeed = document.querySelector('#category .article-sort, #category .category-cards') || document.querySelector('.category-lists')
        const heading = document.querySelector('#category .article-sort-title, #page .page-title')
        if (heading) heading.textContent = categoryPath.join(' / ')
        const container = categoryFeed?.closest('#category, #page')
        container?.classList.add('category-page')
        categoryFeed?.classList.remove('article-sort')
        categoryFeed?.classList.add('category-cards', 'post-cards')
        document.title = `${categoryPath.join(' / ')} | 舟遥的博客`
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
      if (feed && !(home && searchControls)) {
        const selected = categoryFeed ? posts.filter((post) => inCategory(post, categoryPath)) : archive ? posts.filter((post) => {
          const parts = location.pathname.slice(`${root.pathname}archives/`.length).split('/').filter(Boolean)
          return !parts.length || post.date.startsWith(parts.join('-'))
        }) : posts
        feed.replaceChildren(...selected.map((post) => {
          if (categoryFeed || home) return articleCard(post)
          const item = element('div', 'article-sort-item')
          const info = element('div', 'article-sort-item-info')
          info.append(link(post, 'article-sort-item-title'), element('div', 'article-meta-wrap', post.date), element('div', 'content', post.private ? '需要密码阅读' : post.description || post.body.replace(/[#*`>]/g, '').slice(0, 150)))
          appendCategories(info.querySelector('.article-meta-wrap'), post)
          item.append(info)
          return item
        }))
        if (!selected.length) feed.append(element('p', '', '这个分类下暂无文章。'))
        document.getElementById('pagination')?.remove()
      }
    } catch (error) {
      if (reader && !document.getElementById('blog-publication')) reader.textContent = '暂时无法读取文章，正在重试…'
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
