const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const error = (message, status = 400) => Object.assign(new Error(message), { status })

function imageType(bytes) {
  const starts = (...values) => values.every((value, i) => bytes[i] === value)
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'png'
  if (starts(255, 216, 255)) return 'jpg'
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to))
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return null
}

export async function uploadImage(request, env, token, github) {
  // Stop reading oversized streams before allocating the entire request.
  const limit = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024
  if (Number(request.headers.get('Content-Length')) > limit) throw error('图片过大，请选择较小的图片。', 413)
  const reader = request.body?.getReader()
  if (!reader) throw error('请选择图片。')
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw error('图片过大，请选择较小的图片。', 413) }
    chunks.push(value)
  }
  let data
  try { data = JSON.parse(await new Blob(chunks).text()) } catch { throw error('图片数据无效。') }
  if (typeof data.content !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.content)) throw error('图片数据无效。')
  let bytes
  try { bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0)) } catch { throw error('图片数据无效。') }
  if (bytes.length > MAX_IMAGE_BYTES) throw error('图片需小于 2 MB。', 413)
  const extension = imageType(bytes)
  if (!extension) throw error('仅支持 PNG、JPG、WebP 和 GIF 图片。')
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('')
  const name = `${digest}.${extension}`
  const path = `source/images/uploads/${name}`
  const api = `/repos/${env.OWNER}/${env.REPO}/contents/${path}`
  let existing
  try { existing = await github(env, token, `${api}?ref=${env.BRANCH}`) } catch (e) { if (e.status !== 404) throw e }
  if (!existing) {
    try {
      await github(env, token, api, { method: 'PUT', body: JSON.stringify({ message: `Upload image: ${name}`, content: data.content, branch: env.BRANCH }) })
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e
      // A duplicate upload in another tab may have just created the same hash path.
      await github(env, token, `${api}?ref=${env.BRANCH}`)
    }
  }
  return Response.json({ url: `https://raw.githubusercontent.com/${env.OWNER}/${env.REPO}/${env.BRANCH}/${path}`, path, size: bytes.length }, { headers: { 'Cache-Control': 'no-store' } })
}
