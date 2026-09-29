(() => {
  const scriptUrl = document.currentScript?.src
  const marker = document.getElementById('blog-publication')
  const value = document.getElementById('busuanzi_value_page_pv')
  if (!value || !marker || !scriptUrl) return

  async function refreshIfStale() {
    try {
      const url = new URL('../publish-status.json', scriptUrl)
      url.searchParams.set('check', Date.now())
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit' })
      if (!response.ok) return false
      const manifest = await response.json()
      const post = manifest.posts?.[decodeURIComponent(marker.dataset.source)]
      if (!post || post.sha === marker.dataset.sha) return false
      const latest = new URL(post.url, location.href)
      if (latest.origin !== location.origin) return false
      const current = new URL(location.href)
      if (current.searchParams.get('published') === post.sha) return false
      const key = `blog-latest:${location.pathname}`
      if (sessionStorage.getItem(key) === post.sha) return false
      sessionStorage.setItem(key, post.sha)
      latest.searchParams.set('published', post.sha)
      latest.hash = location.hash
      location.replace(latest.href)
      return true
    } catch { return false }
  }

  function countOnce() {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const key = `blog-views:v1:${location.pathname}`
    const description = '同一浏览器每篇文章每天计一次；重复访问显示本机缓存。清除缓存或换设备会重新计数。'
    value.closest('.post-meta-pv-cv')?.setAttribute('title', description)
    const display = (count) => { value.textContent = Number.isSafeInteger(count) && count >= 0 ? String(count) : '—' }
    let cached
    try {
      cached = JSON.parse(localStorage.getItem(key) || 'null')
    } catch { cached = null }
    if (cached?.day === today) {
      display(cached.count)
      return
    }
    // Reserve before starting the request, so a refresh while it is in flight cannot count again.
    const entry = { day: today, count: cached?.count ?? null }
    try {
      localStorage.setItem(key, JSON.stringify(entry))
    } catch {
      display(null)
      value.title = '浏览器存储不可用，已暂停计数以免刷新重复增加。'
      return
    }
    display(entry.count)
    const callback = `BlogViewCount_${Math.random().toString(36).slice(2)}`
    const script = document.createElement('script')
    let timeout
    function cleanup() {
      clearTimeout(timeout)
      script.remove()
      // Late responses can still call this name after a network timeout.
      window[callback] = () => {}
    }
    window[callback] = (result) => {
      const count = Number(result.page_pv)
      if (Number.isSafeInteger(count) && count >= 0) {
        entry.count = count
        try { localStorage.setItem(key, JSON.stringify(entry)) } catch { /* The response can still be displayed. */ }
        display(count)
      }
      cleanup()
    }
    script.src = `https://busuanzi.ibruce.info/busuanzi?jsonpCallback=${callback}`
    script.referrerPolicy = 'no-referrer-when-downgrade'
    script.onerror = cleanup
    timeout = setTimeout(cleanup, 15000)
    document.head.append(script)
  }

  async function start() {
    if (await refreshIfStale()) return
    const url = new URL(location.href)
    // The revision query only bypasses the HTML cache, never creates a new counter.
    if (url.searchParams.has('published')) {
      url.searchParams.delete('published')
      history.replaceState(history.state, '', url.href)
    }
    if (navigator.locks) await navigator.locks.request(`blog-views:${location.pathname}`, countOnce)
    else countOnce()
  }
  void start()
})()
