import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { createHash } from 'node:crypto'

const bundle = await build({ entryPoints: ['backend/worker.js'], bundle: true, format: 'esm', write: false, external: ['cloudflare:workers'], target: 'es2022' })
const origin = 'https://zyzhou1120.github.io'
const blob = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex')

async function fixture() {
  const text = '---\ntitle: 欢迎\n---\n2222\n3333\n'
  const files = new Map([['welcome.md', { text, sha: blob(text) }]])
  let failPut = false
  let writes = 0
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-29',
    durableObjects: { BLOG: { className: 'Blog', useSQLite: true } },
    bindings: { SITE_ORIGIN: origin, OWNER: 'Zyzhou1120', REPO: 'blog', BRANCH: 'main' },
    outboundService: async (request) => {
      const url = new URL(request.url)
      const reply = (body, status = 200) => Response.json(body, { status })
      if (url.pathname === '/user') return reply({ login: request.headers.get('Authorization') === 'Bearer owner-token' ? 'Zyzhou1120' : 'someone-else' })
      if (url.pathname.endsWith('/source/_posts')) return reply([...files].map(([name, file]) => ({ type: 'file', name, sha: file.sha })))
      const name = decodeURIComponent(url.pathname.split('/').at(-1))
      const file = files.get(name)
      if (request.method === 'PUT') {
        writes++
        if (failPut) return reply({ message: 'Upstream failure' }, 500)
        const data = await request.json()
        if ((data.sha || null) !== (file?.sha || null)) return reply({ message: 'Conflict' }, 409)
        const text = Buffer.from(data.content, 'base64').toString('utf8')
        files.set(name, { text, sha: blob(text) })
        return reply({ content: { sha: blob(text) } })
      }
      return file ? reply({ sha: file.sha, encoding: 'base64', size: Buffer.byteLength(file.text), content: Buffer.from(file.text).toString('base64') }) : reply({}, 404)
    },
  }))
  await mf.ready
  const request = (path, { token = 'owner-token', method = 'GET', body, headers } = {}) => mf.dispatchFetch(`https://live.test${path}`, { method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { mf, request, files, failPut() { failPut = true }, get writes() { return writes }, close: () => mf.dispose() }
}

test('owner publishes to GitHub and SQLite; an already-open visitor receives the new version', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request('/sync', { method: 'POST' })).status, 200)
    const before = await (await f.request('/posts/welcome.md', { token: '' })).json()
    const response = await f.request('/events', { token: '', headers: { Upgrade: 'websocket' } })
    assert.equal(response.status, 101)
    response.webSocket.accept()
    const event = new Promise((resolve) => response.webSocket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true }))
    const text = `${before.text}4444\n`
    const saved = await f.request('/posts/welcome.md', { method: 'PUT', body: { text, sha: before.sha } })
    assert.equal(saved.status, 200)
    const post = await saved.json()
    assert.equal(post.sha, blob(text))
    assert.equal((await event).sha, post.sha)
    assert.equal((await (await f.request('/posts/welcome.md', { token: '' })).json()).text, text)
    assert.equal(f.files.get('welcome.md').text, text)
    const conflict = await f.request('/posts/welcome.md', { method: 'PUT', body: { text: 'stale tab', sha: before.sha } })
    assert.equal(conflict.status, 409)
    assert.equal(f.files.get('welcome.md').text, text)
    response.webSocket.close()
  } finally { await f.close() }
})

test('visitors, wrong accounts, and cross-origin requests cannot publish', async () => {
  const f = await fixture()
  try {
    const body = { text: 'attack', sha: null }
    assert.equal((await f.request('/posts/test.md', { method: 'PUT', body, token: '' })).status, 401)
    assert.equal((await f.request('/posts/test.md', { method: 'PUT', body, token: 'stranger' })).status, 403)
    assert.equal((await f.request('/sync', { method: 'POST', headers: { Origin: 'https://evil.test' } })).status, 403)
    assert.equal((await f.request('/posts/..%2Fconfig.md', { method: 'PUT', body })).status, 400)
    assert.equal(f.writes, 0)
  } finally { await f.close() }
})

test('failed backup does not change the public database; interrupted acknowledgement can be retried', async () => {
  const f = await fixture()
  try {
    await f.request('/sync', { method: 'POST' })
    const before = await (await f.request('/posts/welcome.md')).json()
    const text = `${before.text}4444\n`
    // GitHub committed but the worker stopped before committing to SQLite.
    f.files.set('welcome.md', { text, sha: blob(text) })
    const recovered = await f.request('/posts/welcome.md', { method: 'PUT', body: { text, sha: before.sha } })
    assert.equal(recovered.status, 200)
    assert.equal(f.writes, 0)
    f.failPut()
    const failed = await f.request('/posts/welcome.md', { method: 'PUT', body: { text: `${text}5555\n`, sha: blob(text) } })
    assert.equal(failed.status, 500)
    assert.equal((await (await f.request('/posts/welcome.md')).json()).text, text)
  } finally { await f.close() }
})
