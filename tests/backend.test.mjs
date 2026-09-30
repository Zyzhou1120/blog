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
  const images = new Map()
  let failPut = false
  let writes = 0
  let head = 'head-0'
  let aliases = {}
  let raceRef = false
  let counter = 0
  const snapshots = new Map()
  const blobs = new Map()
  const trees = new Map()
  const commits = new Map()
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-29',
    durableObjects: { BLOG: { className: 'Blog', useSQLite: true } },
    bindings: { SITE_ORIGIN: origin, OWNER: 'Zyzhou1120', REPO: 'blog', BRANCH: 'main' },
    outboundService: async (request) => {
      const url = new URL(request.url)
      const reply = (body, status = 200) => Response.json(body, { status })
      if (url.pathname === '/user') return reply({ login: request.headers.get('Authorization') === 'Bearer owner-token' ? 'Zyzhou1120' : 'someone-else' })
      const path = url.pathname.replace('/repos/Zyzhou1120/blog', '')
      if (path === '/git/ref/heads/main') {
        snapshots.set(head, { files: new Map(files), aliases: { ...aliases } })
        return reply({ object: { sha: head } })
      }
      if (path === '/contents/post-aliases.json') {
        const value = snapshots.get(url.searchParams.get('ref'))?.aliases || aliases
        return Object.keys(value).length ? reply({ content: Buffer.from(JSON.stringify(value)).toString('base64') }) : reply({}, 404)
      }
      if (path.startsWith('/git/commits/') && request.method === 'GET') return reply({ tree: { sha: path.split('/').at(-1) } })
      if (path === '/git/blobs') {
        const data = await request.json()
        blobs.set(blob(data.content), data.content)
        return reply({ sha: blob(data.content) })
      }
      if (path === '/git/trees') {
        const data = await request.json()
        const id = `tree-${++counter}`
        trees.set(id, data)
        return reply({ sha: id })
      }
      if (path === '/git/commits') {
        const data = await request.json()
        const id = `commit-${++counter}`
        commits.set(id, data)
        return reply({ sha: id })
      }
      if (path === '/git/refs/heads/main') {
        writes++
        const data = await request.json()
        assert.equal(data.force, false)
        if (failPut) return reply({}, 500)
        const commit = commits.get(data.sha)
        if (raceRef || commit.parents[0] !== head) return reply({}, 409)
        for (const entry of trees.get(commit.tree).tree) {
          if (entry.path === 'post-aliases.json') { aliases = JSON.parse(entry.content); continue }
          const name = entry.path.slice('source/_posts/'.length)
          if (entry.sha === null) files.delete(name)
          else files.set(name, { text: blobs.get(entry.sha), sha: entry.sha })
        }
        head = data.sha
        return reply({ object: { sha: head } })
      }
      if (url.pathname.includes('/source/images/uploads/')) {
        const path = url.pathname
        if (request.method === 'PUT') {
          writes++
          if (failPut) return reply({}, 500)
          const data = await request.json()
          images.set(path, data.content)
          return reply({ content: { sha: 'image-sha' } })
        }
        return images.has(path) ? reply({ sha: 'image-sha' }) : reply({}, 404)
      }
      if (url.pathname.endsWith('/source/_posts')) return reply([...files].map(([name, file]) => ({ type: 'file', name, sha: file.sha })))
      const name = decodeURIComponent(url.pathname.split('/').at(-1))
      const file = (snapshots.get(url.searchParams.get('ref'))?.files || files).get(name)
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
  return { mf, request, files, images, failPut() { failPut = true }, get writes() { return writes }, get aliases() { return aliases }, raceRef() { raceRef = true }, close: () => mf.dispose() }
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

test('image uploads require owner authentication, preserve binary bytes, and deduplicate repeats', async () => {
  const f = await fixture()
  const content = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII='
  try {
    assert.equal((await f.request('/images', { method: 'POST', token: '', body: { content } })).status, 401)
    assert.equal((await f.request('/images', { method: 'POST', token: 'other', body: { content } })).status, 403)
    const result = await f.request('/images', { method: 'POST', body: { content } })
    assert.equal(result.status, 200)
    const image = await result.json()
    assert.match(image.url, /^https:\/\/raw.githubusercontent.com\/Zyzhou1120\/blog\/main\/source\/images\/uploads\/[a-f0-9]{64}\.png$/)
    assert.equal([...f.images.values()][0], content)
    assert.equal((await f.request('/images', { method: 'POST', body: { content } })).status, 200)
    assert.equal(f.writes, 1)
    assert.equal((await f.request('/images', { method: 'POST', body: { content: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') } })).status, 400)
    assert.equal((await f.request('/images', { method: 'POST', body: { content: 'not-base64' } })).status, 400)
    assert.equal((await f.request('/images', { method: 'POST', body: { content: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') } })).status, 413)
  } finally { await f.close() }
})

test('a failed image backup does not return a successful URL', async () => {
  const f = await fixture()
  try {
    f.failPut()
    const result = await f.request('/images', { method: 'POST', body: { content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=' } })
    assert.equal(result.status, 500)
    assert.equal((await result.json()).url, undefined)
    assert.equal(f.images.size, 0)
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

test('title changes move the file atomically, preserve old links and survive sync and retries', async () => {
  const f = await fixture()
  try {
    const original = '---\ntitle: 欢迎\ndate: 2026-09-29\ncategories: [学习]\n---\n正文\n'
    f.files.set('welcome.md', { text: original, sha: blob(original) })
    await f.request('/sync', { method: 'POST' })
    const publish = (name, text, sha) => f.request(`/posts/${encodeURIComponent(name)}`, { method: 'PUT', body: { text, sha, rename: true } })
    const first = await publish('welcome.md', original.replace('title: 欢迎', 'title: 深度学习引入'), blob(original))
    assert.equal(first.status, 200)
    const post = await first.json()
    assert.equal(post.name, '深度学习引入.md')
    assert.equal(f.files.has('welcome.md'), false)
    assert.equal(f.files.get(post.name).text, post.text)
    assert.match(post.text, /permalink: 2026\/09\/29\/welcome\//)
    assert.equal(f.aliases['welcome.md'], post.name)
    assert.equal((await (await f.request('/posts/welcome.md', { token: '' })).json()).sha, post.sha)
    assert.equal((await publish('welcome.md', original.replace('title: 欢迎', 'title: 深度学习引入'), blob(original))).status, 200)
    const second = await (await publish(post.name, post.text.replace('深度学习引入', '学习笔记'), post.sha)).json()
    assert.equal(second.name, '学习笔记.md')
    assert.equal(f.files.size, 1)
    assert.equal(f.aliases['welcome.md'], second.name)
    assert.equal(f.aliases[post.name], second.name)
    await f.request('/sync', { method: 'POST' })
    assert.equal((await (await f.request('/posts/welcome.md', { token: '' })).json()).text, second.text)
    assert.equal((await (await f.request('/posts')).json()).length, 1)
    // Returning to a previous title is safe when that alias belongs to this article.
    const reverted = await publish(second.name, second.text.replace('学习笔记', '深度学习引入'), second.sha)
    assert.equal(reverted.status, 200)
    assert.equal((await (await f.request('/posts/welcome.md')).json()).name, post.name)
  } finally { await f.close() }
})

test('missing titles, same-name collisions and concurrent repository writes cannot lose content', async () => {
  const f = await fixture()
  try {
    f.files.set('已存在.md', { text: '另一篇文章', sha: blob('另一篇文章') })
    await f.request('/sync', { method: 'POST' })
    const before = await (await f.request('/posts/welcome.md')).json()
    const send = (text) => f.request('/posts/welcome.md', { method: 'PUT', body: { text, sha: before.sha, rename: true } })
    assert.equal((await send('替换了整篇正文')).status, 400)
    assert.equal((await send(before.text.replace('title: 欢迎', 'title: 已存在'))).status, 400)
    assert.equal(f.files.get('已存在.md').text, '另一篇文章')
    f.raceRef()
    assert.equal((await send(before.text.replace('title: 欢迎', 'title: 新标题'))).status, 409)
    assert.equal(f.files.get('welcome.md').text, before.text)
    assert.equal(f.files.has('新标题.md'), false)
    assert.equal((await (await f.request('/posts/welcome.md')).json()).sha, before.sha)
  } finally { await f.close() }
})

test('new articles publish directly under their title, and failed renames preserve the old article', async () => {
  const f = await fixture()
  try {
    await f.request('/sync', { method: 'POST' })
    const text = '---\ntitle: 新文章\ndate: 2026-09-30\n---\n新正文'
    const result = await f.request('/posts/draft.md', { method: 'PUT', body: { text, sha: null, rename: true } })
    assert.equal(result.status, 200)
    assert.equal((await result.json()).name, '新文章.md')
    assert.equal(f.files.has('draft.md'), false)
    const before = await (await f.request('/posts/welcome.md')).json()
    f.failPut()
    const failed = await f.request('/posts/welcome.md', { method: 'PUT', body: { text: before.text, sha: before.sha, rename: true } })
    assert.equal(failed.status, 500)
    assert.equal((await (await f.request('/posts/welcome.md')).json()).name, 'welcome.md')
    assert.equal(f.files.has('welcome.md'), true)
    assert.equal(f.files.has('欢迎.md'), false)
  } finally { await f.close() }
})

test('a rename interrupted after its Git commit is recovered without another write', async () => {
  const f = await fixture()
  try {
    await f.request('/sync', { method: 'POST' })
    const before = await (await f.request('/posts/welcome.md')).json()
    const text = before.text.replace('title: 欢迎', 'title: 已改名')
    f.files.delete('welcome.md')
    f.files.set('已改名.md', { text, sha: blob(text) })
    f.aliases['welcome.md'] = '已改名.md'
    const result = await f.request('/posts/welcome.md', { method: 'PUT', body: { text, sha: before.sha, rename: true } })
    assert.equal(result.status, 200)
    assert.equal(f.writes, 0)
    assert.equal((await (await f.request('/posts/welcome.md')).json()).name, '已改名.md')
    assert.equal((await (await f.request('/posts')).json()).length, 1)
  } finally { await f.close() }
})

test('public article views deduplicate concurrent visits and survive article renames', async () => {
  const f = await fixture()
  const visitor = '11111111-1111-4111-8111-111111111111'
  const count = (name, id = visitor) => f.request(`/views/${encodeURIComponent(name)}`, { token: '', method: 'POST', body: { visitor: id } })
  try {
    await f.request('/sync', { method: 'POST' })
    const baseline = (await (await f.request('/views/welcome.md', { token: '' })).json()).count
    assert.ok(baseline >= 10 && baseline <= 25)
    const repeats = await Promise.all(Array.from({ length: 5 }, () => count('welcome.md')))
    for (const result of repeats) assert.equal((await result.json()).count, baseline + 1)
    assert.equal((await (await count('welcome.md', '22222222-2222-4222-8222-222222222222')).json()).count, baseline + 2)
    const before = await (await f.request('/posts/welcome.md')).json()
    const renamed = await (await f.request('/posts/welcome.md', { method: 'PUT', body: { text: '---\ntitle: 新标题\n---\n正文', sha: before.sha, rename: true } })).json()
    assert.equal((await (await count(renamed.name)).json()).count, baseline + 2)
    assert.equal((await (await count('welcome.md')).json()).count, baseline + 2)
    await f.request('/posts/new.md', { method: 'PUT', body: { text: '---\ntitle: 另一篇\n---\n正文', sha: null } })
    const otherBaseline = (await (await f.request('/views/new.md', { token: '' })).json()).count
    assert.equal((await (await count('new.md')).json()).count, otherBaseline + 1)
    assert.equal((await count('missing.md')).status, 404)
    assert.equal((await count('new.md', 'invalid')).status, 400)
    assert.equal((await f.request('/sync', { token: '', method: 'POST' })).status, 401)
    assert.equal((await f.request('/posts/new.md', { token: '', method: 'PUT', body: { text: 'bad', sha: null } })).status, 401)
  } finally { await f.close() }
})


test('seed ranges are persistent; likes allow repeat clicks; public comments, owner replies and moderation survive renames', async () => {
  const f = await fixture()
  const id = () => crypto.randomUUID()
  try {
    await f.request('/sync', { method: 'POST' })
    const seeds = await (await f.request('/initialize-engagement', { method: 'POST' })).json()
    const first = seeds.items[0]
    assert.ok(first.initial_views >= 10 && first.initial_views <= 25)
    assert.ok(first.initial_likes >= 5 && first.initial_likes <= 15 && first.initial_likes < first.initial_views)
    assert.deepEqual(await (await f.request('/initialize-engagement', { method: 'POST' })).json(), seeds)
    const requestId = id()
    const like = requestId => f.request('/likes/welcome.md', { token: '', method: 'POST', body: { requestId } })
    assert.equal((await (await like(requestId)).json()).likes, first.initial_likes + 1)
    assert.equal((await (await like(requestId)).json()).likes, first.initial_likes + 1)
    assert.equal((await (await like(id())).json()).likes, first.initial_likes + 2)
    const visitor = id()
    const comment = { requestId: id(), visitor, nickname: '读者', body: '<script>hello</script>' }
    const created = await f.request('/comments/welcome.md', { token: '', method: 'POST', body: comment, headers: { 'X-Blog-Owner': 'true' } })
    assert.equal(created.status, 201)
    const createdId = (await created.json()).id
    const listing = await (await f.request('/comments/welcome.md', { token: '' })).json()
    assert.equal(listing.items[0].body, comment.body)
    assert.equal(listing.items[0].owner, 0)
    assert.equal((await f.request('/comments/welcome.md', { token: '', method: 'POST', body: { ...comment, requestId: id() } })).status, 429)
    assert.equal((await (await f.request('/comments/welcome.md', { token: '', method: 'POST', body: comment })).json()).id, createdId)
    assert.equal((await f.request('/comments/welcome.md', { token: '', method: 'POST', body: { ...comment, nickname: '博主', requestId: id() } })).status, 400)
    const reply = await f.request('/comments/welcome.md', { method: 'POST', body: { ...comment, requestId: id(), parent: createdId, body: '谢谢' } })
    assert.equal(reply.status, 201)
    assert.equal((await (await f.request('/comments/welcome.md', { token: '' })).json()).items[0].owner, 1)
    assert.equal((await f.request('/manage-comments', { token: '' })).status, 401)
    assert.equal((await f.request('/manage-comments', { token: '', method: 'POST', body: { id: createdId, hidden: true } })).status, 401)
    await f.request('/manage-comments', { method: 'POST', body: { id: createdId, hidden: true } })
    assert.equal((await (await f.request('/comments/welcome.md', { token: '' })).json()).items.length, 1)
    await f.request('/manage-comments', { method: 'POST', body: { id: createdId, hidden: false } })
    const before = await (await f.request('/posts/welcome.md')).json()
    const renamed = await (await f.request('/posts/welcome.md', { method: 'PUT', body: { text: '---\ntitle: 新名字\n---\n正文', sha: before.sha, rename: true } })).json()
    assert.equal((await (await f.request('/comments/' + encodeURIComponent(renamed.name), { token: '' })).json()).items.length, 2)
    assert.equal((await (await f.request('/engagement/' + encodeURIComponent(renamed.name), { token: '' })).json()).likes, first.initial_likes + 2)
    assert.equal((await (await f.request('/manage-comments')).json()).items[0].name, renamed.name)
  } finally { await f.close() }
})
