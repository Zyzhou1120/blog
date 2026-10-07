import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { splitPost, filenameForTitle } from '../shared/post.mjs'

const html = readFileSync('source/editor/index.html', 'utf8').replace(/^---\nlayout: false\n---\n/, '')
const bundle = await build({ entryPoints: ['editor-src/app.js'], bundle: true, format: 'iife', write: false, plugins: [{ name: 'test-config', setup(b) { b.onLoad({ filter: /realtime\.config\.json$/ }, () => ({ contents: '{"endpoint":"https://live.test"}', loader: 'json' })) } }] })
const until = async (condition) => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise((r) => setTimeout(r, 5)) }
  throw new Error('Timed out waiting for live editor')
}
async function fixture({ failure = false, holdImage = null, holdSave = null, renamed = false, savedDraft = null } = {}) {
  let post = { name: 'welcome.md', sha: 'old-sha', text: '---\ntitle: 欢迎\n---\n2222\n3333' }
  if (renamed) post.name = '欢迎.md'
  const dom = new JSDOM(html, { url: 'https://zyzhou1120.github.io/blog/editor/', runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  window.TextEncoder = TextEncoder
  window.TextDecoder = TextDecoder
  window.AbortSignal = AbortSignal
  window.confirm = () => true
  window.sessionStorage.setItem('blog-editor:token', 'owner-token')
  if (renamed) window.sessionStorage.setItem('blog-editor:last-document', 'welcome.md')
  if (savedDraft) window.localStorage.setItem('blog-editor:draft:welcome.md', JSON.stringify({ text: savedDraft, sha: 'old-sha' }))
  const comments = [{ id: 1, name: 'welcome.md', nickname: '读者', body: '文章很有帮助', hidden: 0, owner: 0, created: '2026-09-30T00:00:00Z' }]
  const requests = []
  window.fetch = async (url, options = {}) => {
    requests.push({ url, ...options })
    const reply = (data, status = 200) => ({ ok: status === 200, status, json: async () => data })
    if (url === 'https://api.github.com/user') return reply({ login: 'Zyzhou1120' })
    if (url === 'https://api.github.com/repos/Zyzhou1120/blog') return reply({ permissions: { push: true } })
    if (url === 'https://live.test/manage-comments') {
      if (options.method === 'POST') { const data = JSON.parse(options.body); comments.find(c => c.id === data.id).hidden = data.hidden ? 1 : 0; return reply({ ok: true }) }
      return reply({ items: comments.map(c => ({ ...c })), next: null })
    }
    if (String(url).startsWith('https://live.test/comments/')) {
      const data = JSON.parse(options.body)
      comments.push({ ...data, id: 2, name: 'welcome.md', owner: 1, hidden: 0, created: '2026-09-30T00:01:00Z' })
      return reply({ id: 2 })
    }
    if (url === 'https://live.test/sync') return reply({ ok: true })
    if (url === 'https://live.test/posts') return reply(post ? [{ name: post.name, sha: post.sha }] : [])
    if (url === 'https://live.test/images') {
      if (holdImage) await holdImage
      if (failure) return reply({ message: '图片上传失败' }, 503)
      return reply({ url: 'https://raw.githubusercontent.com/Zyzhou1120/blog/main/source/images/uploads/test.png' })
    }
    if (String(url).startsWith('https://live.test/posts/')) {
      if (options.method === 'DELETE') {
        if (failure) return reply({ message: '删除失败' }, 503)
        if (JSON.parse(options.body).sha !== post?.sha) return reply({ message: '文章已有新修改' }, 409)
        post = null
        return reply({ ok: true })
      }
      if (options.method === 'PUT') {
        if (failure) return reply({ message: '网络请求失败' }, 503)
        const data = JSON.parse(options.body)
        if (holdSave) await holdSave
        post = { ...post, name: data.rename ? filenameForTitle(splitPost(data.text).meta.title) : post.name, text: data.text, sha: 'new-sha' }
      }
      return post ? reply(post) : reply({ message: '文章不存在' }, 404)
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
    assert.equal(doc.getElementById('view-published').href, 'https://zyzhou1120.github.io/blog/read/?post=%E6%AC%A2%E8%BF%8E.md')
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
    assert.equal(doc.getElementById('post-title').value, '欢迎')
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

test('delete confirmation removes a published post without leaving a local draft', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    doc.getElementById('markdown').value += '\n未提交内容'
    doc.getElementById('markdown').dispatchEvent(new f.window.Event('input'))
    doc.getElementById('delete-dialog').showModal = () => {}
    doc.getElementById('delete-dialog').close = () => {}
    doc.getElementById('delete-post').click()
    assert.equal(doc.getElementById('delete-title').textContent, '欢迎')
    assert.match(doc.getElementById('delete-detail').textContent, /未提交的修改会丢失/)
    doc.getElementById('cancel-delete').click()
    assert.equal(f.requests.some((r) => r.method === 'DELETE'), false)
    doc.getElementById('delete-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    await until(() => f.requests.some((r) => r.method === 'DELETE') && doc.getElementById('filename').textContent === '')
    const sent = f.requests.find((r) => r.method === 'DELETE')
    assert.equal(sent.headers.Authorization, 'Bearer owner-token')
    assert.deepEqual(JSON.parse(sent.body), { sha: 'old-sha' })
    assert.equal(doc.getElementById('post-count').textContent, '0')
    assert.equal(f.window.localStorage.getItem('blog-editor:draft:welcome.md'), null)
    assert.equal(f.window.sessionStorage.getItem('blog-editor:last-document'), null)
    assert.equal(doc.getElementById('delete-post').disabled, true)
  } finally { f.close() }
})

test('failed delete preserves the selected article and its draft', async () => {
  const f = await fixture({ failure: true })
  try {
    const doc = f.window.document
    doc.getElementById('delete-dialog').showModal = () => {}
    doc.getElementById('delete-dialog').close = () => {}
    doc.getElementById('markdown').value += '\n我的草稿'
    doc.getElementById('markdown').dispatchEvent(new f.window.Event('input'))
    doc.getElementById('delete-post').click()
    doc.getElementById('delete-form').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    await until(() => doc.getElementById('message').textContent.includes('删除失败'))
    assert.equal(doc.getElementById('filename').textContent, 'welcome.md')
    assert.match(f.window.localStorage.getItem('blog-editor:draft:welcome.md'), /我的草稿/)
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
    doc.getElementById('post-title').value = '深度学习引入'
    doc.getElementById('post-categories').value = '深度学习'
    input.value = '正文'
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

test('replacing the body cannot erase the article title or turn it into a filename', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    const input = doc.getElementById('markdown')
    input.value = '只修改正文，不包含文章信息。'
    input.dispatchEvent(new f.window.Event('input'))
    assert.equal(doc.getElementById('document-title').textContent, '欢迎')
    assert.equal(doc.querySelector('.post-item-title').textContent, '欢迎')
  } finally { f.close() }
})

test('publishing adopts the canonical filename and persists metadata separately from the body', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    doc.getElementById('post-categories').value = '学习 / 深度学习'
    doc.getElementById('markdown').value = '新正文，不带文章信息'
    doc.getElementById('markdown').dispatchEvent(new f.window.Event('input'))
    doc.getElementById('publish').click()
    await until(() => !doc.getElementById('publish').disabled)
    const sent = JSON.parse(f.requests.find((r) => r.method === 'PUT').body)
    assert.equal(sent.rename, true)
    assert.match(sent.text, /title: 欢迎/)
    assert.match(sent.text, /categories:\n  - 学习\n  - 深度学习/)
    assert.equal(doc.getElementById('filename').textContent, '欢迎.md')
    assert.equal(f.window.sessionStorage.getItem('blog-editor:last-document'), '欢迎.md')
    assert.equal(doc.getElementById('markdown').value, '新正文，不带文章信息')
    assert.equal(doc.querySelectorAll('.post-item').length, 1)
    doc.getElementById('publish').click()
    await until(() => !doc.getElementById('publish').disabled)
    assert.equal(f.requests.filter((r) => r.method === 'PUT').length, 1)
    doc.getElementById('post-title').value = ''
    doc.getElementById('publish').click()
    assert.equal(f.requests.filter((r) => r.method === 'PUT').length, 1)
    assert.match(doc.getElementById('message').textContent, /标题/)
  } finally { f.close() }
})

test('an old browser session follows a renamed post and keeps metadata when restoring a body-only draft', async () => {
  const f = await fixture({ renamed: true, savedDraft: '3333\n浏览器里尚未发布的正文' })
  try {
    const doc = f.window.document
    assert.equal(doc.getElementById('filename').textContent, '欢迎.md')
    assert.equal(doc.getElementById('post-title').value, '欢迎')
    assert.match(doc.getElementById('markdown').value, /尚未发布的正文/)
    assert.equal(f.window.localStorage.getItem('blog-editor:draft:welcome.md'), null)
    assert.match(f.window.localStorage.getItem('blog-editor:draft:欢迎.md'), /尚未发布的正文/)
  } finally { f.close() }
})

test('typing another title and body during a rename stays in the local draft', async () => {
  let finish
  const holdSave = new Promise((resolve) => { finish = resolve })
  const f = await fixture({ holdSave })
  try {
    const doc = f.window.document
    doc.getElementById('publish').click()
    await until(() => f.requests.some((r) => r.method === 'PUT'))
    doc.getElementById('post-title').value = '另一个标题'
    doc.getElementById('markdown').value += '\n保存期间写的内容'
    doc.getElementById('markdown').dispatchEvent(new f.window.Event('input'))
    finish()
    await until(() => !doc.getElementById('publish').disabled)
    assert.equal(doc.getElementById('post-title').value, '另一个标题')
    assert.equal(doc.getElementById('filename').textContent, '欢迎.md')
    assert.match(f.window.localStorage.getItem('blog-editor:draft:欢迎.md'), /另一个标题[\s\S]*保存期间写的内容/)
    assert.equal(doc.getElementById('dirty-dot').hidden, false)
  } finally { finish(); f.close() }
})

test('opening the image chooser keeps the editing layout fullscreen and restores the screen on return', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    const event = name => doc.dispatchEvent(new f.window.Event(name))
    doc.documentElement.requestFullscreen = async () => { doc.fullscreenElement = doc.documentElement; event('fullscreenchange') }
    doc.exitFullscreen = async () => { doc.fullscreenElement = null; event('fullscreenchange') }
    doc.getElementById('focus-mode').click()
    await until(() => doc.fullscreenElement)
    const picker = doc.getElementById('image-file')
    picker.click = () => { doc.fullscreenElement = null; event('fullscreenchange') }
    doc.getElementById('upload-image').click()
    assert.equal(doc.body.classList.contains('focus-mode'), true, 'file chooser must not collapse the editor')
    picker.dispatchEvent(new f.window.Event('cancel'))
    await until(() => doc.fullscreenElement)
    assert.equal(doc.body.classList.contains('focus-mode'), true)
  } finally { f.close() }
})

test('a browser that refuses automatic fullscreen recovery keeps the layout and offers a fresh click', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    let blocked = false
    doc.documentElement.requestFullscreen = async () => {
      if (blocked) throw new Error('User gesture required')
      doc.fullscreenElement = doc.documentElement
      doc.dispatchEvent(new f.window.Event('fullscreenchange'))
    }
    const button = doc.getElementById('focus-mode')
    button.click()
    await until(() => doc.fullscreenElement)
    const picker = doc.getElementById('image-file')
    picker.click = () => {
      blocked = true
      doc.fullscreenElement = null
      doc.dispatchEvent(new f.window.Event('fullscreenchange'))
    }
    doc.getElementById('upload-image').click()
    const file = new f.window.File([new Uint8Array([137, 80, 78, 71])], '截图.png', { type: 'image/png' })
    Object.defineProperty(picker, 'files', { value: [file] })
    picker.dispatchEvent(new f.window.Event('change'))
    await until(() => doc.querySelector('#preview img'))
    assert.equal(doc.body.classList.contains('focus-mode'), true)
    assert.equal(button.getAttribute('aria-label'), '恢复屏幕全屏')
    blocked = false
    button.click()
    await until(() => doc.fullscreenElement)
    assert.equal(button.getAttribute('aria-label'), '退出全屏')
  } finally { f.close() }
})

test('choosing a file without a native fullscreen exit does not trap a later Escape', async () => {
  const f = await fixture()
  try {
    const doc = f.window.document
    doc.documentElement.requestFullscreen = async () => { doc.fullscreenElement = doc.documentElement; doc.dispatchEvent(new f.window.Event('fullscreenchange')) }
    doc.getElementById('focus-mode').click()
    await until(() => doc.fullscreenElement)
    const picker = doc.getElementById('image-file')
    picker.click = () => {}
    doc.getElementById('upload-image').click()
    picker.dispatchEvent(new f.window.Event('cancel'))
    doc.fullscreenElement = null
    doc.dispatchEvent(new f.window.Event('fullscreenchange'))
    assert.equal(doc.body.classList.contains('focus-mode'), false)
  } finally { f.close() }
})


test('editor comment management can delete, restore and publish a verified owner reply', async () => {
  const f = await fixture()
  const doc = f.window.document
  try {
    doc.getElementById('comments-dialog').showModal = () => {}
    doc.getElementById('manage-comments').click()
    await until(() => doc.querySelector('.managed-comment'))
    doc.querySelector('.managed-comment > button').click()
    await until(() => doc.querySelector('.managed-comment > button').textContent === '恢复评论')
    assert.match(doc.querySelector('.managed-comment').textContent, /已删除/)
    doc.querySelector('.managed-comment > button').click()
    await until(() => doc.querySelector('.managed-reply'))
    doc.querySelector('.managed-reply textarea').value = '谢谢你的反馈'
    doc.querySelector('.managed-reply').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    await until(() => doc.querySelectorAll('.managed-comment').length === 2)
    assert.match(doc.getElementById('managed-comments').textContent, /谢谢你的反馈/)
    const request = f.requests.find(r => r.url.includes('/comments/') && r.method === 'POST')
    assert.equal(request.headers.Authorization, 'Bearer owner-token')
    assert.equal(JSON.parse(request.body).parent, 1)
  } finally { f.close() }
})

test('owner importance defaults to zero, autosaves as metadata and publishes without changing the body', async () => {
  const f = await fixture()
  const doc = f.window.document
  try {
    const select = doc.getElementById('post-priority')
    assert.equal(select.value, '0')
    assert.equal(select.querySelectorAll('option').length, 11)
    const body = doc.getElementById('markdown').value
    select.value = '8'
    select.dispatchEvent(new f.window.Event('input', { bubbles: true }))
    doc.getElementById('publish').click()
    await until(() => !doc.getElementById('publish').disabled)
    const saved = f.requests.find(r => r.method === 'PUT')
    const post = splitPost(JSON.parse(saved.body).text)
    assert.equal(post.meta.priority, 8)
    assert.equal(post.body, body)
    assert.equal(doc.getElementById('post-priority').value, '8')
  } finally { f.close() }
})
