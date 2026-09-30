import { articleIdentity } from './engagement.js'
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

export function initializeViews(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS view_keys (name TEXT PRIMARY KEY, id TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS view_totals (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)')
  sql.exec('CREATE TABLE IF NOT EXISTS view_days (id TEXT NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (id, day, visitor))')
}

export async function articleViews(blog, request, name) {
  const canonical = blog.resolve(name)
  if (!blog.post(canonical)) return json({ message: '文章不存在。' }, 404)
  let visitor
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (request.method === 'POST') {
    if (Number(request.headers.get('Content-Length')) > 256) return json({ message: '请求太大。' }, 413)
    const payload = await request.text()
    if (payload.length > 256) return json({ message: '请求太大。' }, 413)
    let data
    try { data = JSON.parse(payload) } catch { return json({ message: '请求无效。' }, 400) }
    if (!/^[a-f0-9-]{36}$/i.test(data.visitor || '')) return json({ message: '访客标识无效。' }, 400)
    // Retain only a daily hash of the browser's random ID, never an IP address.
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${data.visitor}`))
    visitor = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
  }
  return blog.ctx.storage.transactionSync(() => {
    const sql = blog.sql
    const id = articleIdentity(blog, canonical)
    if (visitor) {
      sql.exec('DELETE FROM view_days WHERE day < ?', day)
      sql.exec('INSERT OR IGNORE INTO view_days VALUES (?, ?, ?)', id, day, visitor)
      if (sql.exec('SELECT changes() AS added').toArray()[0].added) sql.exec('UPDATE view_totals SET count=count+1 WHERE id = ?', id)
    }
    return json({ count: sql.exec('SELECT count FROM view_totals WHERE id = ?', id).toArray()[0].count })
  })
}
