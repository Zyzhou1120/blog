import { splitPost, joinPost } from '../shared/post.mjs'

const encoder = new TextEncoder()
const iterations = 210_000
const maxFailures = 5
const lockMs = 10 * 60 * 1000

function hex(bytes) { return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
function bytes(value) { return Uint8Array.from(value.match(/.{2}/g).map((part) => parseInt(part, 16))) }

async function verifier(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytes(salt), iterations, hash: 'SHA-256' }, key, 256)))
}

export function initializePrivate(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS private_posts (name TEXT PRIMARY KEY, text TEXT NOT NULL, salt TEXT NOT NULL, verifier TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS private_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_ms INTEGER NOT NULL)')
}

export function isPrivate(text) {
  try { return splitPost(text).meta.private === true } catch { return false }
}

export function publicStub(text) {
  const meta = splitPost(text).meta
  const allowed = Object.fromEntries(['title', 'date', 'categories', 'priority', 'permalink'].filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]]))
  return joinPost({ header: '', meta: allowed, body: '' }, { ...allowed, private: true }, '\n')
}

export async function privateCredentials(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw Object.assign(new Error('私密文章密码需为 12～128 个字符。'), { status: 400 })
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, verifier: await verifier(password, salt) }
}

export async function unlockPrivate(blog, name, password, ip) {
  const post = blog.sql.exec('SELECT text, salt, verifier FROM private_posts WHERE name = ?', name).toArray()[0]
  if (!post) return Response.json({ message: '私密文章暂时不可读取。' }, { status: 503 })
  const now = Date.now()
  blog.sql.exec('DELETE FROM private_attempts WHERE until_ms < ?', now)
  const address = ip || 'unknown'
  const identity = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${name}:${address}`))))
  const attempt = blog.sql.exec('SELECT failures, until_ms FROM private_attempts WHERE key = ?', identity).toArray()[0]
  if (attempt?.failures >= maxFailures && attempt.until_ms > now) return Response.json({ message: '尝试次数过多，请十分钟后再试。' }, { status: 429 })
  if (typeof password !== 'string' || password.length > 128) return Response.json({ message: '密码不正确。' }, { status: 401 })
  const candidate = await verifier(password, post.salt)
  let difference = 0
  const expected = bytes(post.verifier)
  const actual = bytes(candidate)
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index]
  if (difference) {
    const failures = attempt?.until_ms > now ? attempt.failures + 1 : 1
    blog.sql.exec('INSERT INTO private_attempts VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures, until_ms=excluded.until_ms', identity, failures, now + lockMs)
    return Response.json({ message: '密码不正确。' }, { status: 401 })
  }
  blog.sql.exec('DELETE FROM private_attempts WHERE key = ?', identity)
  return Response.json({ name, text: post.text }, { headers: { 'Cache-Control': 'no-store' } })
}
