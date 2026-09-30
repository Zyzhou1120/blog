import { DurableObject } from 'cloudflare:workers'
import { splitPost } from '../shared/post.mjs'
import { publishWithTitle, readAliases } from './rename.js'
import { uploadImage } from './images.js'

const MAX_BYTES = 512 * 1024
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const fail = (message, status) => Object.assign(new Error(message), { status })
const validName = (name) => typeof name === 'string' && name.length <= 160 && !/[\x00-\x1f/\\]/.test(name) && !name.startsWith('.') && name.endsWith('.md')
const decode = (content) => new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\s/g, '')), (c) => c.charCodeAt(0)))
const encode = (text) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

async function github(env, token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'zyzhou-blog-live', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000),
  })
  const result = await response.json()
  if (!response.ok) throw fail(response.status === 409 || response.status === 422 ? '文章已有新修改，请载入最新版后重试。' : 'GitHub 请求失败，请检查登录和仓库权限。', response.status)
  return result
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    if (origin && origin !== env.SITE_ORIGIN) return json({ message: 'Origin not allowed' }, 403)
    const cors = { 'Access-Control-Allow-Origin': env.SITE_ORIGIN, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    try {
      if (!['GET', 'PUT', 'POST'].includes(request.method)) throw fail('Method not allowed', 405)
      const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1]
      if (request.method !== 'GET') {
        if (!token) throw fail('请先登录。', 401)
        const account = await github(env, token, '/user')
        if (account.login?.toLowerCase() !== env.OWNER.toLowerCase()) throw fail('仅博主可以发布文章。', 403)
      }
      const response = request.method === 'POST' && new URL(request.url).pathname === '/images'
        ? await uploadImage(request, env, token, github)
        : await env.BLOG.getByName('blog').fetch(request)
      if (response.status === 101) return response
      return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors } })
    } catch (error) {
      return new Response(JSON.stringify({ message: error.status ? error.message : '实时服务暂时不可用，请稍后重试。' }), { status: error.status || 503, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
  },
}

export class Blog extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS posts (name TEXT PRIMARY KEY, sha TEXT NOT NULL, text TEXT NOT NULL, updated TEXT NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS aliases (name TEXT PRIMARY KEY, target TEXT NOT NULL)')
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  post(name) { return this.sql.exec('SELECT * FROM posts WHERE name = ?', name).toArray()[0] }
  resolve(name) { return this.sql.exec('SELECT target FROM aliases WHERE name = ?', name).toArray()[0]?.target || name }
  importAliases(aliases) {
    this.sql.exec('DELETE FROM aliases')
    for (const [name, target] of Object.entries(aliases)) {
      if (validName(name) && validName(target) && name !== target) this.sql.exec('INSERT INTO aliases VALUES (?, ?)', name, target)
    }
  }
  repo(path = '') { return `/repos/${this.env.OWNER}/${this.env.REPO}/contents/source/_posts${path}` }
  save(name, sha, text) {
    const updated = new Date().toISOString()
    this.sql.exec('INSERT INTO posts VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET sha=excluded.sha, text=excluded.text, updated=excluded.updated', name, sha, text, updated)
    // The SQLite write commits before the runtime delivers outgoing messages (output gate).
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify({ type: 'updated', name, sha })) } catch { socket.close(1011, 'Reconnect') }
    }
    return { name, sha, text, updated }
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/events' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ message: 'WebSocket required' }, 426)
      if (this.ctx.getWebSockets().length >= 500) return json({ message: 'Too many connections' }, 503)
      const [client, server] = Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname === '/health') return json({ ok: true })
    if (url.pathname === '/posts' && request.method === 'GET') return json(this.sql.exec('SELECT name, sha, updated FROM posts ORDER BY name DESC').toArray())
    const name = url.pathname.startsWith('/posts/') ? decodeURIComponent(url.pathname.slice(7)) : null
    if (name && !validName(name)) return json({ message: '文件名无效。' }, 400)
    if (name && request.method === 'GET') return this.post(this.resolve(name)) ? json(this.post(this.resolve(name))) : json({ message: '文章不存在。' }, 404)
    const token = request.headers.get('Authorization')?.slice(7)
    if (url.pathname === '/sync' && request.method === 'POST') {
      // Only the verified owner reaches mutations. Serialize import and writes across tabs.
      return this.ctx.blockConcurrencyWhile(async () => {
        const files = await github(this.env, token, `${this.repo()}?ref=${this.env.BRANCH}`)
        const aliases = await readAliases(this.env, token, github)
        const names = new Set()
        for (const file of files) {
          if (file.type !== 'file' || !validName(file.name)) continue
          names.add(file.name)
          if (this.post(file.name)?.sha === file.sha) continue
          const raw = await github(this.env, token, `${this.repo(`/${encodeURIComponent(file.name)}`)}?ref=${this.env.BRANCH}`)
          if (raw.encoding !== 'base64' || raw.size > MAX_BYTES) continue
          this.save(file.name, raw.sha, decode(raw.content))
        }
        for (const old of this.sql.exec('SELECT name FROM posts').toArray()) {
          if (!names.has(old.name)) this.sql.exec('DELETE FROM posts WHERE name = ?', old.name)
        }
        this.importAliases(aliases)
        return json({ ok: true })
      })
    }
    if (name && request.method === 'PUT') {
      if (Number(request.headers.get('Content-Length')) > MAX_BYTES * 2) return json({ message: '文章太大。' }, 413)
      const payload = await request.text()
      if (new TextEncoder().encode(payload).length > MAX_BYTES * 2) return json({ message: '文章太大。' }, 413)
      let data
      try { data = JSON.parse(payload) } catch { return json({ message: '请求无效。' }, 400) }
      if (typeof data.text !== 'string' || new TextEncoder().encode(data.text).length > MAX_BYTES || !(data.sha === null || typeof data.sha === 'string')) return json({ message: '文章格式无效或超过 512 KB。' }, 400)
      return this.ctx.blockConcurrencyWhile(async () => {
        const current = this.post(name)
        if ((current?.sha || null) !== data.sha && !(data.rename === true && this.resolve(name) !== name)) return json({ message: '文章已有新修改，请载入最新版后重试。' }, 409)
        let parsed
        try { parsed = splitPost(data.text) } catch { return json({ message: '文章信息格式无效，请检查标题和分类。' }, 400) }
        if (typeof parsed.meta.title !== 'string' || !parsed.meta.title.trim()) return json({ message: '文章缺少标题。请刷新编辑页，在上方填写标题后再发布，正文草稿已保留。' }, 400)
        if (data.rename === true) {
          const result = await publishWithTitle(this.env, token, github, name, data)
          const saved = this.ctx.storage.transactionSync(() => {
            this.importAliases(result.aliases)
            if (name !== result.name) this.sql.exec('DELETE FROM posts WHERE name = ?', name)
            return this.save(result.name, result.sha, result.text)
          })
          return json(saved)
        }
        if (this.resolve(name) !== name) return json({ message: '文章已改名，请刷新文章列表后重新载入。' }, 409)
        const path = this.repo(`/${encodeURIComponent(name)}`)
        let remote = null
        try { remote = await github(this.env, token, `${path}?ref=${this.env.BRANCH}`) } catch (error) { if (error.status !== 404) throw error }
        // Recover a GitHub save whose previous database acknowledgement was interrupted.
        if (remote?.encoding === 'base64' && decode(remote.content) === data.text) return json(this.save(name, remote.sha, data.text))
        if ((remote?.sha || null) !== data.sha) return json({ message: 'GitHub 上已有新修改，请刷新文章列表后重新载入。' }, 409)
        const result = await github(this.env, token, path, { method: 'PUT', body: JSON.stringify({ message: `${remote ? 'Update' : 'Add'} post: ${name}`, content: encode(data.text), branch: this.env.BRANCH, ...(remote ? { sha: remote.sha } : {}) }) })
        return json(this.save(name, result.content.sha, data.text))
      })
    }
    return json({ message: 'Not found' }, 404)
  }

  webSocketMessage(socket, message) { if (message !== 'ping') socket.close(1008, 'Read only') }
  webSocketClose(socket, code, reason) { socket.close(code, reason) }
  webSocketError(socket) { socket.close(1011, 'Reconnect') }
}
