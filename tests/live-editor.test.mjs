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
async function fixture({ failure = false, holdImage = null } = {}) {
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
    if (url === 'https://live.test/images') {
      if (holdImage) await holdImage
      if (failure) return reply({ message: '图片上传失败' }, 503)
      return reply({ url: 'https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/test.png' })
    }
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

function pasteImage(window) {
  const file = new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], '截图.png', { type: 'image/png' })
  const event = new window.Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } })
  window.document.getElementById('markdown').dispatchEvent(event)
  return file
}

test('image button opens a file picker and an uploaded image is inserted, previewed, and undoable', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    const input = doc.getElementById('markdown')
    const original = input.value
    input.setSelectionRange(original.length, original.length)
    let opened = false
    const picker = doc.getElementById('image-file')
    picker.click = () => { opened = true }
    doc.getElementById('upload-image').click()
    assert.equal(opened, true)
    assert.equal(input.value, original)
    const file = new f.window.File([new Uint8Array([137, 80, 78, 71])], '截图.png', { type: 'image/png' })
    Object.defineProperty(picker, 'files', { value: [file] })
    picker.dispatchEvent(new f.window.Event('change'))
    await until(() => doc.querySelector('#preview img'))
    assert.match(input.value, /!\[截图\]\(<https:\/\/raw.githubusercontent.com/)
    assert.match(doc.querySelector('#preview img').src, /test.png$/)
    assert.equal(f.requests.find((r) => r.url.endsWith('/images')).headers.Authorization, 'Bearer owner-token')
    doc.getElementById('undo').click()
    assert.equal(input.value, original)
  } finally { f.close() }
})

test('pasting an image preserves typing done while the upload is pending', async () => {
  let finish
  const pending = new Promise((resolve) => { finish = resolve })
  const f = await fixture({ holdImage: pending })
  try {
    const doc = f.window.document
    const input = doc.getElementById('markdown')
    pasteImage(f.window)
    await until(() => f.requests.some((r) => r.url.endsWith('/images')))
    input.value += '\n上传期间写的内容'
    input.dispatchEvent(new f.window.Event('input', { bubbles: true }))
    finish()
    await until(() => doc.querySelector('#preview img'))
    assert.match(input.value, /上传期间写的内容\n\n!\[截图\]/)
    assert.ok(input.value.startsWith('---\ntitle: 欢迎\n---'))
  } finally { finish(); f.close() }
})

test('failed pasted-image upload leaves the article intact without an invalid image placeholder', async () => {
  const f = await fixture({ failure: true })
  try {
    const doc = f.window.document
    const original = doc.getElementById('markdown').value
    pasteImage(f.window)
    await until(() => doc.getElementById('message').textContent.includes('图片上传失败'))
    assert.equal(doc.getElementById('markdown').value, original)
    assert.equal(doc.querySelector('#preview img'), null)
    assert.equal(doc.getElementById('upload-image').disabled, false)
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

test('library uses article titles, searches metadata, and opens a local draft without a remote file', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    assert.equal(doc.getElementById('document-title').textContent, '欢迎')
    assert.equal(doc.querySelector('.post-item-title').textContent, '欢迎')
    assert.equal(doc.querySelector('.post-item small').textContent, 'welcome.md')
    f.window.localStorage.setItem('blog-editor:draft:note.md', JSON.stringify({ sha: null, text: '---\ntitle: 我的笔记\ncategories: 学习\n---\n草稿正文' }))
    const input = doc.getElementById('markdown')
    input.value = '---\ntitle: 深度学习引入\ncategories: 深度学习\n---\n正文'
    input.dispatchEvent(new f.window.Event('input'))
    assert.equal(doc.getElementById('document-title').textContent, '深度学习引入')
    assert.equal(doc.getElementById('post-count').textContent, '2')
    assert.equal(doc.querySelector('.post-item.selected .post-draft-badge').textContent, '未提交')
    const search = doc.getElementById('post-search')
    search.value = '我的笔记'
    search.dispatchEvent(new f.window.Event('input'))
    assert.equal(doc.querySelectorAll('.post-item').length, 1)
    doc.querySelector('.post-item').click()
    await until(() => doc.getElementById('document-title').textContent === '我的笔记')
    assert.equal(doc.getElementById('filename').textContent, 'note.md')
    assert.match(input.value, /草稿正文/)
    assert.equal(f.requests.some((r) => r.url.endsWith('/posts/note.md')), false)
    search.value = 'does-not-exist'
    search.dispatchEvent(new f.window.Event('input'))
    assert.match(doc.getElementById('post-list').textContent, /没有匹配/)
    search.value = '学习'
    search.dispatchEvent(new f.window.Event('input'))
    assert.equal(doc.querySelectorAll('.post-item').length, 2)
  } finally { f.close() }
})
