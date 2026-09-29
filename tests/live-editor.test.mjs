import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const html = readFileSync('source/editor/index.html', 'utf8').replace(/^---\nlayout: false\n---\n/, '')
const bundle = await build({ entryPoints: ['editor-src/app.js'], bundle: true, format: 'iife', write: false, plugins: [{ name: 'test-config', setup(b) { b.onLoad({ filter: /realtime\.config\.json$/ }, () => ({ contents: '{"endpoint":"https://live.test"}', loader: 'json' })) } }] })
const until = async (condition) => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise((r) => setTimeout(r, 5)) }
  throw new Error('Timed out waiting for live editor')
}
async function fixture({ failure = false } = {}) {
  let post = { name: 'welcome.md', sha: 'old-sha', text: '---\ntitle: 欢迎\n---\n2222\n3333' }
  const dom = new JSDOM(html, { url: 'https://zyzhou1120.github.io/blog/editor/', runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  window.TextEncoder = TextEncoder
  window.TextDecoder = TextDecoder
  window.AbortSignal = AbortSignal
  window.confirm = () => true
  window.sessionStorage.setItem('blog-editor:token', 'owner-token')
  const requests = []
  window.fetch = async (url, options = {}) => {
    requests.push({ url, ...options })
    const reply = (data, status = 200) => ({ ok: status === 200, status, json: async () => data })
    if (url === 'https://api.github.com/user') return reply({ login: 'Zyzhou1120' })
    if (url === 'https://api.github.com/repos/Zyzhou1120/blog') return reply({ permissions: { push: true } })
    if (url === 'https://live.test/sync') return reply({ ok: true })
    if (url === 'https://live.test/posts') return reply([{ name: post.name, sha: post.sha }])
    if (url === 'https://live.test/posts/welcome.md') {
      if (options.method === 'PUT') {
        if (failure) return reply({ message: '网络请求失败' }, 503)
        post = { ...post, text: JSON.parse(options.body).text, sha: 'new-sha' }
      }
      return reply(post)
    }
    throw new Error(`Unexpected URL ${url}`)
  }
  window.eval(bundle.outputFiles[0].text)
  await until(() => window.document.getElementById('markdown').value.includes('3333'))
  return { window, requests, close: () => window.close() }
}

test('live editor confirms publicly readable content without waiting for a Pages build', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    doc.getElementById('markdown').value += '\n4444'
    doc.getElementById('publish').click()
    await until(() => !doc.getElementById('publish').disabled)
    assert.match(doc.getElementById('publication-state').textContent, /已发布/)
    assert.match(doc.getElementById('message').textContent, /发布成功/)
    assert.equal(doc.getElementById('view-published').href, 'https://zyzhou1120.github.io/blog/read/?post=welcome.md')
    assert.equal(f.requests.filter((r) => r.method === 'PUT').length, 1)
    assert.equal(f.requests.some((r) => r.url.includes('publish-status.json') || r.url.includes('/actions/')), false)
    assert.equal(f.requests.find((r) => r.method === 'PUT').headers.Authorization, 'Bearer owner-token')
    assert.equal(f.window.localStorage.getItem('blog-editor:draft:welcome.md'), null)
  } finally { f.close() }
})

test('a failed live save never reports published and preserves the editable draft', async () => {
  const f = await fixture({ failure: true })
  try {
    const doc = f.window.document
    doc.getElementById('markdown').value += '\n4444'
    doc.getElementById('publish').click()
    await until(() => !doc.getElementById('publish').disabled)
    assert.match(doc.getElementById('save-state').textContent, /发布未完成/)
    assert.doesNotMatch(doc.getElementById('publication-state').textContent, /^已发布/)
    assert.match(f.window.localStorage.getItem('blog-editor:draft:welcome.md'), /4444/)
  } finally { f.close() }
})
