import catalog from '../shared/catalog.cjs'

export function setupSearch({ host, root, articleCard, searchPage = false }) {
  if (!host) return null
  const form = document.createElement('form')
  form.className = 'blog-search'
  form.setAttribute('role', 'search')
  const label = document.createElement('label')
  label.textContent = '搜索文章'
  const input = document.createElement('input')
  input.type = 'search'; input.name = 'q'; input.maxLength = 100
  input.placeholder = '搜索标题、正文或分类'; input.setAttribute('aria-label', '搜索博客')
  input.value = new URL(location.href).searchParams.get('q') || ''
  label.append(input)
  const button = document.createElement('button')
  button.type = 'submit'; button.textContent = '搜索'
  const clear = document.createElement('button')
  clear.type = 'button'; clear.textContent = '清空'; clear.hidden = !input.value
  form.append(label, button, clear)
  const status = document.createElement('p')
  status.className = 'search-summary'; status.setAttribute('role', 'status')
  status.textContent = '正在载入文章…'
  const feed = searchPage ? document.createElement('div') : host
  if (searchPage) { feed.className = 'post-cards search-results'; host.append(form, status, feed); host.closest('#page')?.classList.add('search-page') }
  else host.before(form, status)
  let posts = [], ready = false
  function render() {
    if (!ready) return
    const query = input.value.trim()
    const selected = posts.filter(post => catalog.matchesSearch(post, query)).sort(catalog.comparePosts)
    feed.replaceChildren(...selected.map(articleCard))
    status.textContent = query ? `找到 ${selected.length} 篇相关文章` : `共 ${posts.length} 篇文章`
    if (!selected.length) {
      const empty = document.createElement('p')
      empty.className = 'search-empty'; empty.textContent = query ? '没有找到相关文章，试试其他关键词。' : '还没有发布文章。'
      feed.append(empty)
    }
    clear.hidden = !query
    document.getElementById('pagination')?.remove()
  }
  function updateUrl() {
    const url = new URL(location.href)
    input.value.trim() ? url.searchParams.set('q', input.value.trim()) : url.searchParams.delete('q')
    history.replaceState(history.state, '', url)
  }
  let timer
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { updateUrl(); render() }, 120) })
  form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); updateUrl(); render() })
  clear.addEventListener('click', () => { input.value = ''; updateUrl(); render(); input.focus() })
  window.addEventListener('popstate', () => { input.value = new URL(location.href).searchParams.get('q') || ''; render() })
  return {
    setPosts(value) { posts = value; ready = true; render() },
    error() { if (!ready) status.textContent = '暂时无法载入文章，请稍后刷新。' },
  }
}
