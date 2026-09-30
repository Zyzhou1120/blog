const MAX_UPLOAD = 2 * 1024 * 1024
const MAX_FILE = 10 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const asDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('无法读取图片，请重新选择。'))
  reader.readAsDataURL(blob)
})

async function prepare(file) {
  if (!TYPES.includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。')
  if (!file.size || file.size > MAX_FILE) throw new Error('请选择 10 MB 以内的图片。')
  if (file.size <= MAX_UPLOAD) return file
  if (file.type === 'image/gif') throw new Error('GIF 动图需小于 2 MB，请先缩小文件。')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86))
      if (blob && blob.size <= MAX_UPLOAD) return blob
      scale *= 0.7
    }
    throw new Error('图片压缩后仍过大，请先缩小图片。')
  } finally { bitmap.close() }
}

export function setupImages({ input, button, getDocument, upload, showMessage }) {
  const picker = document.createElement('input')
  picker.type = 'file'
  picker.accept = TYPES.join(',')
  picker.hidden = true
  picker.id = 'image-file'
  document.body.append(picker)
  let busy = false
  let selection

  function capture() {
    if (!getDocument()) { showMessage('请先选择或新建文章。', true); return null }
    const frontmatter = input.value.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length || 0
    // Default cursor starts in the metadata after opening a post; insert at the end of the body.
    const start = input.selectionStart < frontmatter ? input.value.length : input.selectionStart
    return { name: getDocument(), text: input.value, start, end: Math.max(start, input.selectionEnd) }
  }

  async function send(file, captured) {
    if (busy || !file || !captured) return
    busy = true
    button.disabled = true
    showMessage('正在上传图片…')
    try {
      const blob = await prepare(file)
      const content = (await asDataUrl(blob)).split(',')[1]
      const result = await upload(content)
      const url = new URL(result.url)
      if (url.protocol !== 'https:') throw new Error('图片链接无效。')
      const label = (file.name || '图片').replace(/\.[^.]+$/, '').replace(/[\[\]\\<>\r\n]/g, '').slice(0, 80) || '图片'
      const markdown = `![${label}](<${url.href}>)`
      if (getDocument() !== captured.name) {
        showMessage(`图片已上传，你已切换文章。可复制此内容插入：${markdown}`)
        return
      }
      // Never replace text typed while a network request was in flight.
      const changed = input.value !== captured.text
      const start = changed ? input.value.length : captured.start
      const end = changed ? start : captured.end
      const value = `${start && input.value[start - 1] !== '\n' ? '\n\n' : ''}${markdown}\n`
      input.focus()
      input.setRangeText(value, start, end, 'end')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      showMessage(`图片已上传${blob !== file ? '并自动压缩' : ''}${changed ? '，已添加到文末' : ''}。点击“提交文章”后，访客就能看到。`)
    } catch (error) {
      showMessage(`图片上传失败：${error.message || '请稍后重试'}`, true)
    } finally {
      busy = false
      button.disabled = false
      picker.value = ''
    }
  }

  button.addEventListener('click', () => {
    if (busy) return
    selection = capture()
    if (selection) picker.click()
  })
  picker.addEventListener('change', () => void send(picker.files?.[0], selection))
  input.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.items || [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (!file) return
    event.preventDefault()
    if (busy) { showMessage('上一张图片还在上传，请稍候。'); return }
    void send(file, capture())
  })
}
