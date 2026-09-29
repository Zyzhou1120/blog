import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const html = readFileSync('source/editor/index.html', 'utf8').replace(/^---\nlayout: false\n---\n/, '')
const script = readFileSync('source/editor/editor.js', 'utf8')
const original = '---\ntitle: 欢迎\ndate: 2026-09-29\n---\n\n旧正文\n'
const changed = '---\ntitle: 欢迎\ndate: 2026-09-29\n---\n\n其他页面的新正文\n'

function reply(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

function createEditor({ savedToken = '', lastDocument = '', savedDraft = '', draftSha = 'old-sha', freshReads = false, raceOnPut = false } = {}) {
  let remote = { sha: 'old-sha', text: original }
  let cached = { ...remote }
  let putCount = 0
  const dom = new JSDOM(html, {
    url: 'https://zyzhou1120.github.io/blog/editor/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  window.TextDecoder = TextDecoder
  window.TextEncoder = TextEncoder
  window.confirm = () => true
  if (savedToken) window.sessionStorage.setItem('blog-editor:token', savedToken)
  if (lastDocument) window.sessionStorage.setItem('blog-editor:last-document', lastDocument)
  if (savedDraft) window.localStorage.setItem(`blog-editor:draft:${lastDocument}`, JSON.stringify({ text: savedDraft, sha: draftSha }))
  window.fetch = async (url, options = {}) => {
    if (url === 'https://api.github.com/user') return reply(200, { login: 'Zyzhou1120' })
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
        return reply(200, { content: { sha: remote.sha } })
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
    await until(() => input.value === changed)
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
    assert.equal(editor.window.document.getElementById('markdown').value, draft)
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
