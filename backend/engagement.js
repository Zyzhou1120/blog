const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)
const randomInt = (min, max) => min + crypto.getRandomValues(new Uint32Array(1))[0] % (max - min + 1)

export function initializeEngagement(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS engagement (id TEXT PRIMARY KEY, initial_views INTEGER NOT NULL, initial_likes INTEGER NOT NULL, likes INTEGER NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS like_requests (article TEXT NOT NULL, request TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(article, request))')
  sql.exec('CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article TEXT NOT NULL, request TEXT NOT NULL, nickname TEXT NOT NULL, body TEXT NOT NULL, parent INTEGER, owner INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, UNIQUE(article, request))')
  sql.exec('CREATE INDEX IF NOT EXISTS comments_article ON comments(article, id)')
  sql.exec('CREATE TABLE IF NOT EXISTS comment_limits (key TEXT PRIMARY KEY, last INTEGER NOT NULL)')
}

// This ID survives file renames and is shared by views, likes and comments.
export function articleIdentity(blog, name) {
  const sql = blog.sql
  const canonical = blog.resolve(name)
  const names = [canonical, ...sql.exec('SELECT name FROM aliases WHERE target = ?', canonical).toArray().map(row => row.name)]
  const id = names.map(alias => sql.exec('SELECT id FROM view_keys WHERE name = ?', alias).toArray()[0]?.id).find(Boolean) || crypto.randomUUID()
  for (const alias of names) sql.exec('INSERT INTO view_keys VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET id=excluded.id', alias, id)
  sql.exec('INSERT OR IGNORE INTO view_totals VALUES (?, 0)', id)
  if (!sql.exec('SELECT id FROM engagement WHERE id = ?', id).toArray().length) {
    const views = randomInt(10, 25)
    const likes = randomInt(5, Math.min(15, views - 1))
    sql.exec('INSERT INTO engagement VALUES (?, ?, ?, ?)', id, views, likes, likes)
    // Preserve genuine visits accumulated before this one-time initial baseline.
    sql.exec('UPDATE view_totals SET count=count+? WHERE id = ?', views, id)
  }
  return id
}

async function payload(request) {
  if (Number(request.headers.get('Content-Length')) > 16000) return null
  const text = await request.text()
  if (text.length > 16000) return null
  try { return JSON.parse(text) } catch { return null }
}

export async function engagementRoute(blog, request, name, type, owner = false) {
  const canonical = blog.resolve(name)
  if (!blog.post(canonical)) return json({ message: '文章不存在。' }, 404)
  const id = blog.ctx.storage.transactionSync(() => articleIdentity(blog, name))
  const sql = blog.sql
  if (request.method === 'GET') {
    if (type === 'engagement') return json({ ...sql.exec('SELECT likes FROM engagement WHERE id = ?', id).toArray()[0], comments: sql.exec('SELECT COUNT(*) AS total FROM comments WHERE article = ? AND hidden = 0', id).toArray()[0].total })
    if (type === 'comments') {
      const cursor = Number(new URL(request.url).searchParams.get('before') || Number.MAX_SAFE_INTEGER)
      if (!Number.isSafeInteger(cursor) || cursor < 1) return json({ message: '分页无效。' }, 400)
      const items = sql.exec('SELECT c.id, c.nickname, c.body, c.parent, c.owner, c.created, CASE WHEN p.hidden = 0 THEN p.nickname ELSE NULL END AS replyTo FROM comments c LEFT JOIN comments p ON p.id=c.parent WHERE c.article = ? AND c.hidden = 0 AND c.id < ? ORDER BY c.id DESC LIMIT 51', id, cursor).toArray()
      const hasMore = items.length > 50
      if (hasMore) items.pop()
      return json({ items, next: hasMore ? items.at(-1).id : null })
    }
    return json({ message: 'Not found' }, 404)
  }
  const data = await payload(request)
  if (!uuid(data?.requestId)) return json({ message: '请求无效，请刷新重试。' }, 400)
  if (type === 'likes') {
    return blog.ctx.storage.transactionSync(() => {
      sql.exec('DELETE FROM like_requests WHERE created < ?', Date.now() - 86400000)
      sql.exec('INSERT OR IGNORE INTO like_requests VALUES (?, ?, ?)', id, data.requestId, Date.now())
      if (sql.exec('SELECT changes() AS added').toArray()[0].added) sql.exec('UPDATE engagement SET likes=likes+1 WHERE id = ?', id)
      return json(sql.exec('SELECT likes FROM engagement WHERE id = ?', id).toArray()[0])
    })
  }
  if (type !== 'comments') return json({ message: 'Not found' }, 404)
  const nickname = owner ? '博主' : typeof data.nickname === 'string' ? data.nickname.trim() : ''
  const body = typeof data.body === 'string' ? data.body.trim() : ''
  if (!nickname || nickname.length > 30 || !body || body.length > 2000 || !uuid(data.visitor)) return json({ message: '请填写昵称（最多 30 字）和评论（最多 2000 字）。' }, 400)
  if (!owner && /博主|管理员|站长/.test(nickname)) return json({ message: '请使用其他昵称，博主身份仅限本人登录使用。' }, 400)
  const parent = data.parent ?? null
  if (parent !== null && (!Number.isSafeInteger(parent) || !sql.exec('SELECT id FROM comments WHERE id = ? AND article = ? AND hidden = 0', parent, id).toArray().length)) return json({ message: '回复的评论已不存在，请刷新。' }, 400)
  const day = new Date().toISOString().slice(0, 10)
  const identity = request.headers.get('CF-Connecting-IP') || data.visitor
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${identity}`))
  const key = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  return blog.ctx.storage.transactionSync(() => {
    const existing = sql.exec('SELECT id FROM comments WHERE article = ? AND request = ?', id, data.requestId).toArray()[0]
    if (existing) return json({ id: existing.id })
    const now = Date.now()
    sql.exec('DELETE FROM comment_limits WHERE last < ?', now - 86400000)
    if (!owner && now - (sql.exec('SELECT last FROM comment_limits WHERE key = ?', key).toArray()[0]?.last || 0) < 10000) return json({ message: '评论发送太快，请稍等 10 秒再试。' }, 429)
    sql.exec('INSERT INTO comments(article, request, nickname, body, parent, owner, created) VALUES (?, ?, ?, ?, ?, ?, ?)', id, data.requestId, nickname, body, parent, owner ? 1 : 0, new Date().toISOString())
    const commentId = sql.exec('SELECT last_insert_rowid() AS id').toArray()[0].id
    sql.exec('INSERT INTO comment_limits VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET last=excluded.last', key, now)
    return json({ id: commentId }, 201)
  })
}

export async function manageComments(blog, request) {
  if (request.method === 'GET') {
    const before = Number(new URL(request.url).searchParams.get('before') || Number.MAX_SAFE_INTEGER)
    if (!Number.isSafeInteger(before) || before < 1) return json({ message: '分页无效。' }, 400)
    const items = blog.sql.exec('SELECT c.*, (SELECT k.name FROM view_keys k JOIN posts p ON p.name=k.name WHERE k.id=c.article LIMIT 1) AS name FROM comments c WHERE c.id < ? ORDER BY c.id DESC LIMIT 51', before).toArray()
    const hasMore = items.length > 50
    if (hasMore) items.pop()
    return json({ items: items.map(({ request, article, ...item }) => item), next: hasMore ? items.at(-1).id : null })
  }
  const data = await payload(request)
  if (!Number.isSafeInteger(data?.id) || typeof data.hidden !== 'boolean') return json({ message: '请求无效。' }, 400)
  blog.sql.exec('UPDATE comments SET hidden = ? WHERE id = ?', data.hidden ? 1 : 0, data.id)
  return json({ ok: true })
}
