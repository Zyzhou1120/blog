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
  const dom = new JSDOM(html + categoryHtml + '<aside id="aside-content"><div class="sticky_layout"><section id="card-toc">旧目录</section></div></aside>', { url: `https://zyzhou1120.github.io/blog/${categories ? 'categories/' + categoryQuery : home ? '' : generic ? 'read/?post=welcome.md' : '2026/09/29/welcome/'}`, runScripts: 'outside-only', pretendToBeVisual: true })
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
  window.fetch = async (url) => ({ ok: true, json: async () => String(url).includes('/comments/') ? { items: [], next: null } : String(url).includes('/engagement/') ? { likes: 8, comments: 0 } : String(url).includes('/views') ? { count: 25 } : String(url).endsWith('/posts') ? [{ name: post.name, sha: post.sha }] : { ...post } })
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

$$f(x) = \max(0, x) = \begin{cases} 0 & \text{if } x < 0
\\ x & \text{if } x \ge 0 \end{cases}$$

最后答案 $=\sum\limits_{d = 1}^{min(n,m)}\mu(d)
\left\lfloor\dfrac{n}{d}\right\rfloor
\left\lfloor\dfrac{m}{d}\right\rfloor
$
`)
    await until(() => page.window.document.querySelector('#reader-heading h1')?.textContent === '公式检查')
    const root = page.window.document.getElementById('live-reader')
    assert.equal(root.querySelectorAll('.katex').length, 6)
    assert.equal(root.querySelectorAll('.katex-error').length, 0)
  } finally { page.close() }
})

 test('generic article displays its visit count beside the title', async () => {
  const page = fixture({ generic: true })
  try {
    await until(() => page.window.document.getElementById('blog-publication'))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.match(page.window.document.querySelector('#reader-heading').textContent, /浏览量.*25/)
  } finally { page.close() }
})

async function catalogFixture({ offline = false, searchPage = false } = {}) {
  const make = (name, title, priority, date, body) => ({ name, sha: name, updated: date, text: `---\ntitle: ${title}\npriority: ${priority}\ndate: ${date}\ncategories: 深度学习\n---\n${body}` })
  let posts = [make('older.md', '入门', 0, '2026-09-28', '线性函数'), make('newer.md', '进阶', 0, '2026-09-30', '矩阵'), make('important.md', '重点', 9, '2026-09-29', '矩阵与向量')]
  const dom = new JSDOM(searchPage ? '<div id="page"><div id="blog-search-page"></div></div>' : '<div id="recent-posts"><div class="recent-post-items"></div></div>', { url: `https://zyzhou1120.github.io/blog/${searchPage ? 'search/?q=矩阵' : ''}`, runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  window.TextEncoder = TextEncoder; window.AbortSignal = AbortSignal
  Object.defineProperty(window.document, 'currentScript', { value: { src: 'https://zyzhou1120.github.io/blog/js/live.js' } })
  let socket
  window.WebSocket = class { static OPEN = 1; static CONNECTING = 0; constructor() { this.readyState = 1; socket = this } close() {} send() {} }
  window.fetch = async url => {
    url = String(url)
    if (url.includes('blog-catalog.json')) return { ok: true, json: async () => ({ posts }) }
    if (offline) throw new Error('Offline')
    return { ok: true, json: async () => url.endsWith('/posts') ? posts.map(({ name, sha }) => ({ name, sha })) : posts.find(p => url.endsWith(p.name)) }
  }
  window.eval(script)
  await until(() => window.document.querySelectorAll('.article-title').length === (searchPage ? 2 : 3))
  return { window, update() { posts[0] = { ...make('older.md', '入门', 10, '2026-09-28', '线性函数'), sha: 'changed' }; socket.onmessage({ data: '{}' }) }, close() { window.close() } }
}

test('home and search use the same ordering and react to changed importance', async () => {
  const f = await catalogFixture()
  const doc = f.window.document
  const titles = () => [...doc.querySelectorAll('.article-title')].map(n => n.textContent)
  try {
    assert.deepEqual(titles(), ['重点', '入门', '进阶'])
    const input = doc.querySelector('[name=q]')
    input.value = '矩阵'
    doc.querySelector('.blog-search').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    assert.deepEqual(titles(), ['重点', '进阶'])
    assert.match(f.window.location.search, /q=/)
    input.value = '<script>'
    doc.querySelector('.blog-search').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    assert.equal(doc.querySelectorAll('.article-title').length, 0)
    assert.match(doc.querySelector('.search-empty').textContent, /没有找到/)
    doc.querySelector('.blog-search button[type=button]').click()
    f.update()
    await until(() => titles()[0] === '入门')
    assert.equal(doc.querySelector('#post-priority'), null)
  } finally { f.close() }
})

test('search page restores its query and searches the static catalog when live service is offline', async () => {
  const f = await catalogFixture({ offline: true, searchPage: true })
  try {
    assert.equal(f.window.document.querySelector('[name=q]').value, '矩阵')
    assert.deepEqual([...f.window.document.querySelectorAll('.article-title')].map(n => n.textContent), ['重点', '进阶'])
  } finally { f.close() }
})


test('article navigation links resolve unique headings and refresh with live edits', async () => {
  const page = fixture({ generic: true })
  const doc = page.window.document
  try {
    await until(() => doc.getElementById('blog-publication'))
    page.update('---\ntitle: 目录文章\n---\n### 计算步骤\n正文\n#### 细节\n正文\n### 计算步骤\n后文')
    await until(() => doc.querySelectorAll('#reader-toc a').length === 2)
    const links = [...doc.querySelectorAll('#reader-toc a')]
    const ids = links.map(link => decodeURIComponent(link.hash.slice(1)))
    assert.equal(new Set(ids).size, 2)
    assert.equal(doc.querySelector('#live-reader h4').textContent, '细节')
    assert.ok(doc.querySelector('#live-reader h4').id)
    assert.equal(links.some(link => link.textContent === '细节'), false)
    for (const [index, id] of ids.entries()) assert.equal(doc.getElementById(id).textContent, links[index].textContent)
    assert.equal(doc.querySelectorAll('#reader-toc-mobile a').length, 2)
    assert.equal(doc.querySelector('#aside-content').classList.contains('article-navigation'), true)
    page.update('---\ntitle: 目录文章\n---\n### 更新后的章节\n正文')
    await until(() => doc.querySelector('#reader-toc a')?.textContent === '更新后的章节')
    assert.equal(doc.querySelectorAll('#reader-toc').length, 1)
    assert.equal(doc.querySelectorAll('#reader-toc a').length, 1)
    assert.equal(doc.getElementById(ids[0]), null)
    page.update('---\ntitle: 目录文章\n---\n#### 只有小标题\n正文')
    await until(() => doc.querySelector('#live-reader h4')?.textContent === '只有小标题')
    assert.equal(doc.querySelector('#reader-toc, #reader-toc-mobile, #card-toc'), null)
  } finally { page.close() }
})
