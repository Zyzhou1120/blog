// A repository save is complete before Pages has built and served that save.
export function createPublicationTracker({ manifestUrl, api, onChange }) {
  let target = null
  let timer = null
  let serial = 0
  let startedAt = 0
  let currentState = 'checking'
  let lastRunCheck = 0
  let failed = false

  function stop() {
    target = null
    serial += 1
    clearTimeout(timer)
  }

  async function check(force = false) {
    clearTimeout(timer)
    if (!target) return
    const wanted = target
    const requestId = ++serial
    let state = 'publishing'
    let article = null
    let runFailed = failed
    try {
      const url = new URL(manifestUrl)
      url.searchParams.set('check', `${Date.now()}-${requestId}`)
      const response = await fetch(url.href, { cache: 'no-store', credentials: 'omit' })
      if (!response.ok) throw new Error('Publication status unavailable')
      const manifest = await response.json()
      article = manifest.posts?.[wanted.name]
      if (article?.sha === wanted.sha && article.url) {
        const articleUrl = new URL(article.url, manifestUrl)
        if (articleUrl.origin !== new URL(manifestUrl).origin) throw new Error('Invalid article URL')
        articleUrl.searchParams.set('check', `${Date.now()}-${requestId}`)
        const page = await fetch(articleUrl.href, { cache: 'no-store', credentials: 'omit' })
        if (!page.ok) throw new Error('Article unavailable')
        const document = new DOMParser().parseFromString(await page.text(), 'text/html')
        const marker = document.querySelector('#article-container #blog-publication')
        if (marker?.dataset.sha === wanted.sha && decodeURIComponent(marker.dataset.source) === wanted.name) state = 'published'
      }
    } catch {
      state = 'unknown'
    }
    if (state !== 'published' && wanted.commit && (force || Date.now() - lastRunCheck > 30000)) {
      lastRunCheck = Date.now()
      try {
        // This repository is public. Do not require extra token permissions to read Actions.
        const response = await fetch(`${api}/actions/workflows/pages.yml/runs?head_sha=${encodeURIComponent(wanted.commit)}&per_page=5&check=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        if (response.ok) {
          const result = await response.json()
          const run = result.workflow_runs?.find((item) => item.head_sha === wanted.commit)
          runFailed = run?.status === 'completed' && ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion)
        }
      } catch { /* Keep the saved article and let the publication check retry. */ }
    }
    if (requestId !== serial || target !== wanted) return
    failed = runFailed
    if (state !== 'published' && failed) state = 'failed'
    currentState = state
    onChange({ state, article, sha: wanted.sha })
    if (!['published', 'failed'].includes(state) && Date.now() - startedAt < 10 * 60 * 1000) {
      timer = setTimeout(check, 10000)
    } else if (!['published', 'failed'].includes(state)) {
      onChange({ state: 'delayed', sha: wanted.sha })
    }
  }

  function watch(name, sha, commit = null) {
    stop()
    if (!sha) {
      currentState = 'unpublished'
      onChange({ state: 'unpublished' })
      return
    }
    target = { name, sha, commit }
    startedAt = Date.now()
    lastRunCheck = 0
    failed = false
    currentState = 'checking'
    onChange({ state: 'checking' })
    void check()
  }

  return { watch, check, stop, get state() { return currentState } }
}
