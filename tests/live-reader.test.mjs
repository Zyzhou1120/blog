import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const bundle = await build({ entryPoints: ['editor-src/live-reader.js'], bundle: true, format: 'iife', write: false, plugins: [{ name: 'test-config', setup(b) { b.onLoad({ filter: /realtime\.config\.json$/ }, () => ({ contents: '{"endpoint":"https://live.test"}', loader: 'json' })) } }] })
const script = bundle.outputFiles[0].text
const until = async (condition) => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise((r) => setTimeout(r, 5)) }
  throw new Error('Timed out waiting for live content')
}

function fixture({ generic = false, home = false, categories = false, categoryQuery = '' } = {}) {
  let post = { name: 'welcome.md', sha: 'new-sha', text: '---\ntitle: 新标题\ndate: 2026-09-29\n---\n2222\n3333\n4444', updated: '2026-09-29T15:00:00Z' }
  const html = home ? '<div id="recent-posts"><div class="recent-post-items"></div></div>' : generic ? '<main class="layout"><div id="page"><div class="page-title">阅读文章</div><div id="article-container"><div id="live-reader">正在读取</div></div></div></main>' : '<div id="post"><h1 class="post-title">旧标题</h1><div id="article-container">2222<span id="blog-publication" data-source="welcome.md" data-sha="old-sha"></span></div></div>'
  const categoryHtml = '<div class="card-categories"><ul id="aside-cat-list"><li>随笔</li></ul></div>' + (categories ? '<div id="page"><div class="page-title">分类</div><div class="category-lists">随笔</div></div>' : '')
  const dom = new JSDOM(html + categoryHtml, { url: `https://zyzhou1120.github.io/blog/${categories ? 'categories/' + categoryQuery : home ? '' : generic ? 'read/?post=welcome.md' : '2026/09/29/welcome/'}`, runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  window.TextEncoder = TextEncoder
  window.AbortSignal = AbortSignal
  Object.defineProperty(window.document, 'currentScript', { value: { src: 'https://zyzhou1120.github.io/blog/js/live.js' } })
  let socket
  let revision = 0
  window.WebSocket = class {
    static OPEN = 1
    static CONNECTING = 0
    constructor() { this.readyState = 1; socket = this; queueMicrotask(() => this.onopen?.()) }
    close() { this.readyState = 3 }
    send() {}
  }
  window.fetch = async (url) => ({ ok: true, json: async () => String(url).endsWith('/posts') ? [{ name: post.name, sha: post.sha }] : { ...post } })
  window.eval(script)
  return { window, update(text) { post = { ...post, sha: `revision-${++revision}`, text }; socket.onmessage({ data: JSON.stringify({ type: 'updated', name: post.name, sha: post.sha }) }) }, close: () => window.close() }
}

test('an ordinary old article loads current content and reacts to live publication without navigation', async () => {
  const f = fixture()
  try {
    await until(() => f.window.document.getElementById('article-container').textContent.includes('4444'))
    assert.equal(f.window.document.querySelector('.post-title').textContent, '新标题')
    f.update('---\ntitle: 再更新\n---\n5555\n<img src=x onerror="alert(1)"><script>alert(1)</script>')
    await until(() => f.window.document.getElementById('article-container').textContent.includes('5555'))
    assert.equal(f.window.document.querySelector('.post-title').textContent, '再更新')
    assert.equal(f.window.document.querySelector('#article-container script, #article-container [onerror]'), null)
    assert.equal(f.window.location.pathname, '/blog/2026/09/29/welcome/')
    assert.equal(f.window.blogLiveEnabled, true)
  } finally { f.close() }
})

test('moving an article updates the category index and sidebar without waiting for a static build', async () => {
  const page = fixture({ categories: true })
  try {
    await until(() => page.window.blogLiveEnabled)
    page.update('---\ntitle: 深度学习引入\ncategories:\n  - 深度学习\n---\n正文')
    await until(() => page.window.document.querySelector('#aside-cat-list').textContent.includes('深度学习'))
    assert.equal(page.window.document.querySelector('#aside-cat-list').textContent.includes('随笔'), false)
    assert.match(page.window.document.querySelector('.category-lists').textContent, /深度学习/)
    assert.match(page.window.document.querySelector('.category-lists a').href, /categories\/\?category=/)
  } finally { page.close() }
})

test('a category lists moved articles immediately and removes them when moved away', async () => {
  const page = fixture({ categories: true, categoryQuery: '?category=机器学习&category=深度学习' })
  try {
    await until(() => page.window.document.querySelector('.category-lists').textContent.includes('暂无文章'))
    page.update('---\ntitle: 深度学习引入\ncategories:\n  - 机器学习\n  - 深度学习\n---\n正文')
    await until(() => page.window.document.querySelector('.category-lists .article-title'))
    assert.equal(page.window.document.querySelector('.category-lists .article-title').textContent, '深度学习引入')
    assert.ok(page.window.document.querySelector('.category-cards .blog-post-card'))
    assert.equal(page.window.document.querySelector('.category-cards .article-meta-wrap, .category-cards .content'), null)
    assert.equal(page.window.document.body.textContent.includes('已连接实时更新'), false)
    assert.equal(page.window.document.querySelector('#aside-cat-list ul .card-category-list-name').textContent, '深度学习')
    // A new publication must have a new SHA, as the production backend does.
    page.update('---\ntitle: 深度学习引入\ncategories: 随笔\n---\n正文')
    await until(() => page.window.document.querySelector('.category-lists').textContent.includes('暂无文章'))
    assert.equal(page.window.document.querySelector('.category-lists .article-title'), null)
  } finally { page.close() }
})

test('homepage cards show article openings while the reader retains its category links', async () => {
  const pages = [fixture({ home: true }), fixture({ generic: true })]
  try {
    await until(() => pages[0].window.document.querySelector('.article-title') && pages[1].window.document.querySelector('#blog-publication'))
    for (const page of pages) page.update('---\ntitle: 深度学习引入\ncategories: 深度学习\n---\n正文')
    await until(() => pages[1].window.document.querySelector('.article-meta__categories'))
    assert.equal(pages[1].window.document.querySelector('.article-meta__categories').textContent, '深度学习')
    assert.equal(pages[0].window.document.querySelector('.blog-post-card .article-meta__categories'), null)
    assert.equal(pages[0].window.document.querySelector('.blog-post-card .blog-post-excerpt').textContent, '正文')
    assert.match(pages[0].window.document.querySelector('.blog-post-dates').textContent, /更新于 2026-09-29/)
  } finally { pages.forEach((page) => page.close()) }
})

test('new posts can be read and listed before a static page has been built', async () => {
  const page = fixture({ generic: true })
  const home = fixture({ home: true })
  try {
    await until(() => page.window.document.getElementById('live-reader').textContent.includes('4444'))
    await until(() => home.window.document.querySelector('.article-title'))
    assert.equal(page.window.document.querySelector('#reader-heading h1').textContent, '新标题')
    assert.equal(page.window.document.querySelector('.layout').previousElementSibling.id, 'reader-heading')
    assert.equal(page.window.document.querySelector('#page .page-title'), null)
    assert.equal(page.window.document.querySelector('#live-reader h1'), null)
    assert.equal(page.window.document.body.textContent.includes('已连接实时更新'), false)
    assert.equal(home.window.document.querySelector('.article-title').href, 'https://zyzhou1120.github.io/blog/read/?post=welcome.md')
  } finally { page.close(); home.close() }
})

test('article formulas next to Chinese punctuation and LaTeX parentheses render on the live reader', async () => {
  const page = fixture({ generic: true })
  try {
    await until(() => page.window.document.getElementById('blog-publication'))
    page.update(String.raw`---
title: 公式检查
---
对于给定的 $k,b$，平方误差 $\frac{1}{n}\sum (y_i - (kx_i+b))^2$（即 MSE）。

把第一层的输出 \(\boldsymbol a^{(1)}\) 当作下一层的输入，推广到第 \(\ell\) 层。

$$f(x) = \max(0, x) = \begin{cases} 0 & \text{if } x < 0 \\ x & \text{if } x \ge 0 \end{cases}$$
`)
    await until(() => page.window.document.querySelector('#reader-heading h1')?.textContent === '公式检查')
    const root = page.window.document.getElementById('live-reader')
    assert.equal(root.querySelectorAll('.katex').length, 5)
    assert.equal(root.querySelectorAll('.katex-error').length, 0)
  } finally { page.close() }
})
