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

function fixture({ generic = false, home = false } = {}) {
  let post = { name: 'welcome.md', sha: 'new-sha', text: '---\ntitle: 新标题\ndate: 2026-09-29\n---\n2222\n3333\n4444', updated: '2026-09-29T15:00:00Z' }
  const html = home ? '<div id="recent-posts"><div class="recent-post-items"></div></div>' : generic ? '<div id="live-reader">正在读取</div>' : '<div id="post"><h1 class="post-title">旧标题</h1><div id="article-container">2222<span id="blog-publication" data-source="welcome.md" data-sha="old-sha"></span></div></div>'
  const dom = new JSDOM(html, { url: `https://zyzhou1120.github.io/blog/${home ? '' : generic ? 'read/?post=welcome.md' : '2026/09/29/welcome/'}`, runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  window.TextEncoder = TextEncoder
  window.AbortSignal = AbortSignal
  Object.defineProperty(window.document, 'currentScript', { value: { src: 'https://zyzhou1120.github.io/blog/js/live.js' } })
  let socket
  window.WebSocket = class {
    static OPEN = 1
    static CONNECTING = 0
    constructor() { this.readyState = 1; socket = this; queueMicrotask(() => this.onopen?.()) }
    close() { this.readyState = 3 }
    send() {}
  }
  window.fetch = async (url) => ({ ok: true, json: async () => String(url).endsWith('/posts') ? [{ name: post.name, sha: post.sha }] : { ...post } })
  window.eval(script)
  return { window, update(text) { post = { ...post, sha: 'third-sha', text }; socket.onmessage({ data: JSON.stringify({ type: 'updated', name: post.name, sha: post.sha }) }) }, close: () => window.close() }
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

test('new posts can be read and listed before a static page has been built', async () => {
  const page = fixture({ generic: true })
  const home = fixture({ home: true })
  try {
    await until(() => page.window.document.getElementById('live-reader').textContent.includes('4444'))
    await until(() => home.window.document.querySelector('.article-title'))
    assert.equal(page.window.document.querySelector('#live-reader h1').textContent, '新标题')
    assert.equal(home.window.document.querySelector('.article-title').href, 'https://zyzhou1120.github.io/blog/read/?post=welcome.md')
  } finally { page.close(); home.close() }
})
