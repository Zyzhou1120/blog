import { parse, stringify } from 'yaml'

export function splitPost(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { meta: {}, body: text, header: '', originalMeta: '{}' }
  const meta = parse(match[1], { maxAliasCount: 20 })
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('文章信息格式无效。')
  return { meta, body: text.slice(match[0].length), header: match[0], originalMeta: JSON.stringify(meta) }
}

export function joinPost(post, meta = post.meta, body = post.body) {
  const header = post.header && JSON.stringify(meta) === post.originalMeta
    ? post.header : `---\n${stringify(meta, { lineWidth: 0 })}---\n`
  return header + body
}

export function filenameForTitle(title) {
  const clean = String(title).normalize('NFC').trim().replace(/[\x00-\x1f\x7f/\\:*?"<>|#%]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '')
  // Stay below filesystem byte limits even for Chinese and emoji titles.
  let name = ''
  for (const char of clean) {
    if (new TextEncoder().encode(name + char).length > 180 || (name + char).length > 150) break
    name += char
  }
  if (!name) throw new Error('请填写有效的文章标题。')
  return `${name}.md`
}
