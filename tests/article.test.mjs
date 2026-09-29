import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'

const script = readFileSync('source/js/article.js', 'utf8')

async function visit({ storage = new Map(), path = '/blog/2026/09/29/welcome/', now = '2026-09-29T12:00:00Z', storageBlocked = false, publishedSha = 'published-sha', previousReload = '' } = {}) {
  let navigations = 0
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => { if (/navigation/.test(error.message)) navigations += 1; else throw error })
  const dom = new JSDOM('<span id="blog-publication" data-source="welcome.md" data-sha="published-sha"></span><span class="post-meta-pv-cv"><span id="busuanzi_value_page_pv"></span></span>', { url: `https://zyzhou1120.github.io${path}`, runScripts: 'outside-only', virtualConsole })
  const { window } = dom
  let requests = 0
  const requestPages = []
  window.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])) } }
  Object.defineProperty(window, 'localStorage', { value: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => { if (storageBlocked) throw new Error('blocked'); storage.set(key, value) },
  } })
  Object.defineProperty(window.document, 'currentScript', { value: { src: 'https://zyzhou1120.github.io/blog/js/article.js' } })
  if (previousReload) window.sessionStorage.setItem('blog-latest:/blog/2026/09/29/welcome/', previousReload)
  window.fetch = async () => ({ ok: true, json: async () => ({ posts: { 'welcome.md': { sha: publishedSha, url: '/blog/2026/09/29/welcome/' } } }) })
  const append = window.document.head.append.bind(window.document.head)
  window.document.head.append = (element) => {
    append(element)
    requests += 1
    requestPages.push(window.location.href)
    const callback = new URL(element.src).searchParams.get('jsonpCallback')
    window[callback]({ page_pv: 25 })
  }
  window.eval(script)
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { window, requests, requestPages, storage, navigations, close: () => window.close() }
}

test('refreshing and opening a versioned link counts an article only once per browser and day', async () => {
  const first = await visit()
  const second = await visit({ storage: first.storage })
  const third = await visit({ storage: first.storage, path: '/blog/2026/09/29/welcome/?published=new-sha' })
  try {
    assert.equal(first.requests, 1)
    assert.equal(second.requests, 0)
    assert.equal(third.requests, 0)
    assert.equal(third.window.document.getElementById('busuanzi_value_page_pv').textContent, '25')
    assert.equal(third.window.location.search, '')
  } finally { first.close(); second.close(); third.close() }
})

test('a different article or a new Shanghai calendar day can count again', async () => {
  const first = await visit()
  const other = await visit({ storage: first.storage, path: '/blog/2026/09/29/other/' })
  const tomorrow = await visit({ storage: first.storage, now: '2026-09-29T16:01:00Z' })
  try {
    assert.equal(other.requests, 1)
    assert.equal(tomorrow.requests, 1)
  } finally { first.close(); other.close(); tomorrow.close() }
})

test('a cache-busting query is removed before counting, and blocked storage never inflates counts', async () => {
  const versioned = await visit({ path: '/blog/2026/09/29/welcome/?published=new-sha' })
  const blocked = await visit({ storageBlocked: true })
  try {
    assert.deepEqual(versioned.requestPages, ['https://zyzhou1120.github.io/blog/2026/09/29/welcome/'])
    assert.equal(blocked.requests, 0)
    assert.equal(blocked.window.document.getElementById('busuanzi_value_page_pv').textContent, '—')
  } finally { versioned.close(); blocked.close() }
})

test('a stale article reloads the new version before counting and cannot enter a reload loop', async () => {
  const stale = await visit({ publishedSha: 'new-sha' })
  const retry = await visit({ publishedSha: 'new-sha', previousReload: 'new-sha' })
  const versioned = await visit({ publishedSha: 'new-sha', path: '/blog/2026/09/29/welcome/?published=new-sha' })
  try {
    assert.equal(stale.navigations, 1)
    assert.equal(stale.requests, 0)
    assert.equal(stale.window.sessionStorage.getItem('blog-latest:/blog/2026/09/29/welcome/'), 'new-sha')
    assert.equal(retry.navigations, 0)
    assert.equal(versioned.navigations, 0)
  } finally { stale.close(); retry.close(); versioned.close() }
})
