import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
const script = (await build({ stdin: { contents: "import { mountInteractions } from './editor-src/interactions.js'; mountInteractions({name:'test.md'}, document.querySelector('article'))", resolveDir: process.cwd() }, bundle: true, format: 'iife', write: false, plugins: [{ name: 'config', setup(b) { b.onLoad({ filter: /realtime\.config\.json$/ }, () => ({ contents: '{"endpoint":"https://live.test"}', loader: 'json' })) } }] })).outputFiles[0].text
const until = async condition => { for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 5)) } throw new Error('Timed out') }
function fixture() {
  const dom = new JSDOM('<article>正文</article>', { url: 'https://zyzhou1120.github.io/blog/read/?post=test.md', runScripts: 'outside-only' })
  const { window } = dom
  window.AbortSignal = AbortSignal
  let likes = 8, fail = false
  let items = [{ id: 1, nickname: '读者', body: '<img src=x onerror=alert(1)>', owner: 0, created: '2026-09-30T00:00:00Z' }]
  const requests = []
  window.fetch = async (url, options = {}) => {
    requests.push({ url, ...options })
    let data
    if (url.includes('/engagement/')) data = { likes, comments: items.length }
    else if (url.includes('/likes/')) data = { likes: ++likes }
    else if (options.method === 'POST') {
      if (fail) return { ok: false, status: 503, json: async () => ({ message: '暂时不可用' }) }
      const payload = JSON.parse(options.body)
      items.unshift({ ...payload, id: items.length + 1, created: '2026-09-30T00:01:00Z' }); data = { id: items.length }
    } else data = { items, next: null }
    return { ok: true, json: async () => data }
  }
  window.eval(script)
  return { window, requests, fail() { fail = true }, close() { window.close() } }
}
test('repeat clicks add likes, comments are safe text, replies appear immediately and failures preserve drafts', async () => {
  const f = fixture()
  const doc = f.window.document
  try {
    await until(() => doc.querySelector('.comment-item'))
    assert.equal(doc.querySelector('.comment-body img'), null)
    assert.match(doc.querySelector('.comment-body').textContent, /<img/)
    const like = doc.querySelector('.article-like')
    like.click(); await until(() => !like.disabled)
    like.click(); await until(() => !like.disabled)
    assert.match(like.textContent, /10/)
    const calls = f.requests.filter(r => r.url.includes('/likes/'))
    assert.notEqual(JSON.parse(calls[0].body).requestId, JSON.parse(calls[1].body).requestId)
    doc.querySelector('.comment-reply').click()
    doc.querySelector('[name=nickname]').value = '小明'
    doc.querySelector('[name=comment]').value = '谢谢分享'
    doc.querySelector('form').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    await until(() => doc.querySelector('.comment-item .comment-body').textContent === '谢谢分享')
    assert.equal(doc.querySelector('[name=comment]').value, '')
    assert.equal(JSON.parse(f.requests.find(r => r.url.includes('/comments/') && r.method === 'POST').body).parent, 1)
    f.fail()
    doc.querySelector('[name=comment]').value = '不能丢的评论'
    doc.querySelector('form').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    await until(() => !doc.querySelector('.comment-submit').disabled)
    assert.equal(doc.querySelector('[name=comment]').value, '不能丢的评论')
    assert.match(doc.querySelector('.interaction-status').textContent, /暂时不可用/)
  } finally { f.close() }
})
