import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'

const html = readFileSync('source/editor/index.html', 'utf8').replace(/^---\nlayout: false\n---\n/, '')
// Exercise the static publishing fallback regardless of the production endpoint.
const staticBundle = await build({ entryPoints: ['editor-src/app.js'], bundle: true, format: 'iife', write: false, plugins: [{ name: 'static-test-config', setup(b) { b.onLoad({ filter: /realtime\.config\.json$/ }, () => ({ contents: '{"endpoint":""}', loader: 'json' })) } }] })
const script = staticBundle.outputFiles[0].text
const original = '---\ntitle: 欢迎\ndate: 2026-09-29\n---\n\n旧正文\n'
const changed = '---\ntitle: 欢迎\ndate: 2026-09-29\n---\n\n其他页面的新正文\n'

function reply(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

function createEditor({ savedToken = '', rememberedToken = '', authFailure = 0, lastDocument = '', savedDraft = '', draftSha = 'old-sha', freshReads = false, raceOnPut = false, staleHtml = false } = {}) {
  let remote = { sha: 'old-sha', text: original }
  let cached = { ...remote }
  let putCount = 0
  let publishedSha = 'old-sha'
  let buildFailed = false
  const dom = new JSDOM(html, {
    url: 'https://zyzhou1120.github.io/blog/editor/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  window.TextDecoder = TextDecoder
  window.TextEncoder = TextEncoder
  window.confirm = () => true
  if (rememberedToken) window.localStorage.setItem('blog-editor:token', rememberedToken)
  if (savedToken) window.sessionStorage.setItem('blog-editor:token', savedToken)
  if (lastDocument) window.sessionStorage.setItem('blog-editor:last-document', lastDocument)
  if (savedDraft) window.localStorage.setItem(`blog-editor:draft:${lastDocument}`, JSON.stringify({ text: savedDraft, sha: draftSha }))
  window.fetch = async (url, options = {}) => {
    url = String(url)
    if (url.includes('publish-status.json')) return reply(200, { posts: { 'welcome.md': { sha: publishedSha, url: '/blog/2026/09/29/welcome/' } } })
    if (url.includes('/blog/2026/09/29/welcome/')) return { ok: true, text: async () => `<article id="article-container">正文<span id="blog-publication" data-source="welcome.md" data-sha="${staleHtml ? 'old-sha' : publishedSha}"></span></article>` }
    if (url.includes('/actions/workflows/pages.yml/runs')) return reply(200, { workflow_runs: buildFailed ? [{ head_sha: 'commit-sha', status: 'completed', conclusion: 'failure' }] : [] })
    if (url === 'https://api.github.com/user') return authFailure ? reply(authFailure, { message: 'Connection failed' }) : reply(200, { login: 'Zyzhou1120' })
    if (url === 'https://api.github.com/repos/Zyzhou1120/blog') return reply(200, { permissions: { push: true } })
    if (url.endsWith('/contents/source/_posts?ref=main')) {
      return reply(200, [{ type: 'file', name: 'welcome.md' }])
    }
    if (url.includes('/contents/source/_posts/welcome.md')) {
      if (options.method === 'PUT') {
        putCount += 1
        const data = JSON.parse(options.body)
        if (raceOnPut) remote = { sha: 'race-sha', text: changed }
        if (data.sha !== remote.sha) return reply(409, { message: `source/_posts/welcome.md does not match ${data.sha}` })
        remote = { sha: 'saved-sha', text: Buffer.from(data.content, 'base64').toString('utf8') }
        return reply(200, { content: { sha: remote.sha }, commit: { sha: 'commit-sha' } })
      }
      const file = options.cache === 'no-store' || freshReads ? remote : cached
      return reply(200, { sha: file.sha, content: Buffer.from(file.text).toString('base64') })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  window.eval(script)
  return {
    window,
    changeRemote() { remote = { sha: 'new-sha', text: changed } },
    publishRemote() { publishedSha = remote.sha },
    failBuild() { buildFailed = true },
    get putCount() { return putCount },
    close() { dom.window.close() },
  }
}

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for editor state')
}

async function logIn(window) {
  window.document.getElementById('token').value = 'test-token'
  window.document.getElementById('auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await until(() => window.document.getElementById('filename').textContent === 'welcome.md')
}

test('a changed remote article does not trigger a stale-SHA PUT', async () => {
  const editor = createEditor()
  try {
    await logIn(editor.window)
    const input = editor.window.document.getElementById('markdown')
    input.value += '\n我的修改\n'
    input.dispatchEvent(new editor.window.Event('input', { bubbles: true }))
    editor.changeRemote()
    editor.window.document.getElementById('publish').click()
    await until(() => !editor.window.document.getElementById('publish').disabled)
    assert.equal(editor.putCount, 0)
    assert.match(editor.window.document.getElementById('message').textContent, /远程文章已有新修改/)
    assert.doesNotMatch(editor.window.document.getElementById('message').textContent, /does not match/)
    assert.equal(editor.window.document.getElementById('conflict-notice').hidden, false)
    editor.window.document.getElementById('reload-conflict').click()
    await until(() => input.value === '\n其他页面的新正文\n')
    assert.equal(editor.window.document.getElementById('draft-notice').hidden, false)
    assert.match(editor.window.document.getElementById('draft-copy').textContent, /覆盖远程内容/)
    assert.match(editor.window.localStorage.getItem('blog-editor:draft:welcome.md'), /我的修改/)
  } finally {
    editor.close()
  }
})

test('refresh restores the editor session without another token entry', async () => {
  const editor = createEditor({ savedToken: 'test-token', lastDocument: 'welcome.md', savedDraft: `${original}\n未提交的草稿\n` })
  try {
    await until(() => !editor.window.document.getElementById('editor-view').hidden)
    assert.equal(editor.window.document.getElementById('filename').textContent, 'welcome.md')
    await until(() => editor.window.document.getElementById('markdown').value.includes('未提交的草稿'))
    editor.window.document.getElementById('logout').click()
    assert.equal(editor.window.sessionStorage.getItem('blog-editor:token'), null)
    assert.equal(editor.window.document.getElementById('auth-view').hidden, false)
  } finally {
    editor.close()
  }
})

test('refresh restores a new post that is not yet in the repository', async () => {
  const name = '2026-09-29-new-post.md'
  const draft = '---\ntitle: 新文章\ndate: 2026-09-29\n---\n\n正在写的正文\n'
  const editor = createEditor({ savedToken: 'test-token', lastDocument: name, savedDraft: draft, draftSha: null })
  try {
    await until(() => editor.window.document.getElementById('filename').textContent === name)
    assert.equal(editor.window.document.getElementById('markdown').value, '\n正在写的正文\n')
    assert.equal(editor.window.document.getElementById('post-title').value, '新文章')
    assert.equal(editor.window.document.getElementById('reload-post').disabled, true)
  } finally {
    editor.close()
  }
})

test('two saves in one tab use the SHA returned by the first save', async () => {
  const editor = createEditor({ freshReads: true })
  try {
    await logIn(editor.window)
    const input = editor.window.document.getElementById('markdown')
    input.value += '\n第一次修改\n'
    input.dispatchEvent(new editor.window.Event('input', { bubbles: true }))
    editor.window.document.getElementById('publish').click()
    await until(() => editor.putCount === 1 && !editor.window.document.getElementById('publish').disabled)
    input.value += '\n第二次修改\n'
    input.dispatchEvent(new editor.window.Event('input', { bubbles: true }))
    editor.window.document.getElementById('publish').click()
    await until(() => editor.putCount === 2 && !editor.window.document.getElementById('publish').disabled)
    assert.match(editor.window.document.getElementById('message').textContent, /已提交到 GitHub/)
  } finally {
    editor.close()
  }
})

test('a server conflict shows a useful message instead of the raw SHA error', async () => {
  const editor = createEditor({ freshReads: true, raceOnPut: true })
  try {
    await logIn(editor.window)
    const input = editor.window.document.getElementById('markdown')
    input.value += '\n我的修改\n'
    input.dispatchEvent(new editor.window.Event('input', { bubbles: true }))
    editor.window.document.getElementById('publish').click()
    await until(() => editor.putCount === 1 && !editor.window.document.getElementById('publish').disabled)
    assert.match(editor.window.document.getElementById('message').textContent, /远程文章已有新修改/)
    assert.doesNotMatch(editor.window.document.getElementById('message').textContent, /does not match/)
  } finally {
    editor.close()
  }
})

test('saving source stays pending until the published article matches, even on a second submit', async () => {
  const editor = createEditor({ freshReads: true })
  try {
    await logIn(editor.window)
    const doc = editor.window.document
    const input = doc.getElementById('markdown')
    input.value += '\n等待上线的正文\n'
    input.dispatchEvent(new editor.window.Event('input', { bubbles: true }))
    doc.getElementById('publish').click()
    await until(() => editor.putCount === 1 && !doc.getElementById('publish').disabled)
    assert.match(doc.getElementById('publication-state')?.textContent || '', /发布中/)
    assert.equal(doc.getElementById('view-published').hidden, true)
    doc.getElementById('publish').click()
    await until(() => !doc.getElementById('publish').disabled)
    assert.equal(editor.putCount, 1)
    assert.match(doc.getElementById('message').textContent, /发布/)
    editor.publishRemote()
    doc.getElementById('check-publication').click()
    await until(() => doc.getElementById('publication-state').textContent.includes('已发布'))
    assert.equal(doc.getElementById('view-published').hidden, false)
    assert.match(doc.getElementById('view-published').href, /welcome\/\?published=saved-sha$/)
    assert.doesNotMatch(doc.getElementById('message').textContent, /正在|发布中/)
  } finally { editor.close() }
})

test('a failed build is visible without discarding the saved article', async () => {
  const editor = createEditor({ freshReads: true })
  try {
    await logIn(editor.window)
    const doc = editor.window.document
    doc.getElementById('markdown').value += '\n新增内容\n'
    doc.getElementById('publish').click()
    await until(() => editor.putCount === 1 && !doc.getElementById('publish').disabled)
    editor.failBuild()
    doc.getElementById('check-publication').click()
    await until(() => doc.getElementById('publication-state')?.textContent.includes('发布失败'))
    assert.match(doc.getElementById('markdown').value, /新增内容/)
    assert.equal(doc.getElementById('view-published').hidden, true)
  } finally { editor.close() }
})

test('a new manifest with stale public HTML must not report published', async () => {
  const editor = createEditor({ staleHtml: true })
  try {
    await logIn(editor.window)
    const doc = editor.window.document
    doc.getElementById('markdown').value += '\n4444\n'
    doc.getElementById('publish').click()
    await until(() => editor.putCount === 1 && !doc.getElementById('publish').disabled)
    editor.publishRemote()
    doc.getElementById('check-publication').click()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.doesNotMatch(doc.getElementById('publication-state').textContent, /已发布/)
  } finally { editor.close() }
})

test('toolbar formats selected body text, preserves metadata, and supports undo and redo', async () => {
  const editor = createEditor()
  try {
    await logIn(editor.window)
    const doc = editor.window.document
    const input = doc.getElementById('markdown')
    const start = input.value.indexOf('旧正文')
    input.setSelectionRange(start, start + 3)
    doc.querySelector('[data-command="bold"]').click()
    assert.ok(input.value.includes('**旧正文**'))
    assert.equal(doc.querySelector('#preview strong').textContent, '旧正文')
    assert.equal(doc.getElementById('post-title').value, '欢迎')
    assert.equal(doc.getElementById('post-date').value, '2026-09-29')
    doc.getElementById('undo').click()
    assert.equal(input.value, '\n旧正文\n')
    doc.getElementById('redo').click()
    assert.ok(input.value.includes('**旧正文**'))
    const previewButton = doc.querySelector('button[data-layout="preview"]')
    previewButton.click()
    assert.equal(doc.body.dataset.layout, 'preview')
    assert.equal(previewButton.getAttribute('aria-pressed'), 'true')
  } finally { editor.close() }
})

test('preview keeps ordinary line breaks and renders inserted formulas and tables', async () => {
  const editor = createEditor()
  try {
    await logIn(editor.window)
    const doc = editor.window.document
    const input = doc.getElementById('markdown')
    input.value += '第一行\n第二行'
    input.dispatchEvent(new editor.window.Event('input', { bubbles: true }))
    assert.ok(doc.querySelector('#preview br'))
    input.setSelectionRange(input.value.length, input.value.length)
    doc.querySelector('[data-command="math"]').click()
    assert.ok(doc.querySelector('#preview .katex'))
    input.setSelectionRange(input.value.length, input.value.length)
    doc.querySelector('[data-command="table"]').click()
    assert.equal(doc.querySelectorAll('#preview th').length, 2)
  } finally { editor.close() }
})

test('preview renders formulas next to Chinese punctuation and LaTeX parentheses', async () => {
  const editor = createEditor()
  try {
    await logIn(editor.window)
    const doc = editor.window.document
    const input = doc.getElementById('markdown')
    input.value = String.raw`---
title: 公式
---
平方误差 $x^2$（即 MSE），推广到第 \(\ell\) 层。

$$\mu(N)=\begin{cases}0&\exists i,c_i>1
\\1&\forall i,c_i=1,m\equiv0\pmod{2}
\\-1&\forall i,c_i=1,m\equiv1\pmod{2}\end{cases}$$

即 $\sum\limits_{x=1}^{n}
\sum\limits_{y=1}^{m}
\sum\limits_{d|gcd(x,y)}\mu(d)$。`
    input.dispatchEvent(new editor.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelectorAll('#preview .katex').length, 4)
    assert.equal(doc.querySelectorAll('#preview .katex-error').length, 0)
  } finally { editor.close() }
})

test('refresh never shows the login form while restoring a remembered session', async () => {
  const editor = createEditor({ rememberedToken: 'test-token', lastDocument: 'welcome.md' })
  try {
    const doc = editor.window.document
    assert.equal(doc.getElementById('auth-view').hidden, true)
    await until(() => doc.getElementById('filename').textContent === 'welcome.md')
    assert.equal(doc.getElementById('editor-view').hidden, false)
    assert.equal(doc.getElementById('auth-view').hidden, true)
    doc.getElementById('logout').click()
    assert.equal(editor.window.localStorage.getItem('blog-editor:token'), null)
    assert.equal(editor.window.sessionStorage.getItem('blog-editor:token'), null)
  } finally { editor.close() }
})

test('temporary connection failures retain the session and offer a retry instead of login', async () => {
  const editor = createEditor({ savedToken: 'test-token', authFailure: 503 })
  try {
    const doc = editor.window.document
    await until(() => !doc.getElementById('auth-button').disabled)
    assert.equal(editor.window.sessionStorage.getItem('blog-editor:token'), 'test-token')
    assert.equal(doc.getElementById('auth-view').hidden, true)
    assert.equal(doc.getElementById('retry-connection').hidden, false)
  } finally { editor.close() }
})

test('an expired remembered token returns to login and is removed from both stores', async () => {
  const editor = createEditor({ savedToken: 'expired-token', rememberedToken: 'expired-token', authFailure: 401 })
  try {
    const doc = editor.window.document
    await until(() => !doc.getElementById('auth-button').disabled)
    assert.equal(doc.getElementById('auth-view').hidden, false)
    assert.equal(doc.getElementById('connection-view').hidden, true)
    assert.equal(editor.window.localStorage.getItem('blog-editor:token'), null)
    assert.equal(editor.window.sessionStorage.getItem('blog-editor:token'), null)
    assert.match(doc.getElementById('auth-error').textContent, /过期/)
  } finally { editor.close() }
})

test('login persists by default while opting out keeps credentials in this tab only', async () => {
  for (const remember of [true, false]) {
    const editor = createEditor()
    try {
      editor.window.document.getElementById('remember-session').checked = remember
      await logIn(editor.window)
      assert.equal(editor.window.localStorage.getItem('blog-editor:token'), remember ? 'test-token' : null)
      assert.equal(editor.window.sessionStorage.getItem('blog-editor:token'), 'test-token')
      assert.equal(editor.window.localStorage.getItem('blog-editor:remember-session'), String(remember))
    } finally { editor.close() }
  }
})

test('source colors follow edits, undo, scrolling and Chinese composition without changing content', async () => {
  const editor = createEditor()
  try {
    await logIn(editor.window)
    const { document, Event } = editor.window
    const input = document.getElementById('markdown')
    const layer = document.getElementById('source-highlight')
    const initial = input.value
    assert.equal(layer.textContent, initial + '\u200b')
    const source = '# 标题\n\n**重点** $x^2$\n'
    input.value = source
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.equal(layer.textContent, source + '\u200b')
    assert.ok(layer.querySelector('.hljs-section'))
    assert.ok(layer.querySelector('.hljs-formula'))
    input.scrollTop = 80
    input.dispatchEvent(new Event('scroll'))
    assert.equal(layer.scrollTop, 80)
    input.dispatchEvent(new Event('compositionstart'))
    assert.ok(input.parentElement.classList.contains('is-composing'))
    input.dispatchEvent(new Event('compositionend'))
    assert.equal(input.parentElement.classList.contains('is-composing'), false)
    document.getElementById('undo').click()
    assert.equal(input.value, initial)
    assert.equal(layer.textContent, initial + '\u200b')
    document.getElementById('redo').click()
    assert.equal(layer.textContent, source + '\u200b')
  } finally {
    editor.close()
  }
})
