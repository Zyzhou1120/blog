import { liveRequest, liveEndpoint, liveUrl } from './live-api.js'
import { visitorId } from './interactions.js'

export function setupCommentManager(getToken) {
  const dialog = document.getElementById('comments-dialog')
  const list = document.getElementById('managed-comments')
  const status = document.getElementById('comments-status')
  const more = document.getElementById('more-managed-comments')
  let next = null
  const node = (tag, text, className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n }
  async function load(append = false) {
    more.disabled = true
    try {
      const data = await liveRequest('/manage-comments' + (append && next ? `?before=${next}` : ''), {}, getToken())
      if (!append) list.replaceChildren()
      if (!data.items.length && !append) list.append(node('p', '还没有评论。'))
      for (const item of data.items) {
        const card = node('article', '', 'managed-comment')
        const title = node('a', item.name || '文章已删除')
        if (item.name) { title.href = liveUrl(item.name, new URL('../', location.href)); title.target = '_blank'; title.rel = 'noopener noreferrer' }
        card.append(title, node('p', `${item.nickname}${item.owner ? ' · 博主' : ''} · ${new Date(item.created).toLocaleString('zh-CN')}${item.hidden ? ' · 已删除' : ''}`), node('p', item.body, 'managed-comment-body'))
        const remove = node('button', item.hidden ? '恢复评论' : '删除评论', 'quiet-button')
        remove.type = 'button'
        remove.addEventListener('click', async () => {
          remove.disabled = true
          try {
            await liveRequest('/manage-comments', { method: 'POST', body: JSON.stringify({ id: item.id, hidden: !item.hidden }) }, getToken())
            status.textContent = item.hidden ? '评论已恢复。' : '评论已删除，访客不再可见；可在这里恢复。'
            await load()
          } catch (error) { status.textContent = error.message }
          finally { remove.disabled = false }
        })
        card.append(remove)
        if (!item.hidden && item.name) {
          const form = node('form', '', 'managed-reply')
          const input = node('textarea', ''); input.placeholder = '以博主身份回复…'; input.maxLength = 2000; input.required = true; input.setAttribute('aria-label', `回复 ${item.nickname}`)
          const send = node('button', '回复', 'primary-button'); send.type = 'submit'
          let requestId = null, lastBody = ''
          form.append(input, send)
          form.addEventListener('submit', async event => {
            event.preventDefault()
            if (send.disabled || !input.value.trim()) return
            send.disabled = true
            if (lastBody !== input.value) { requestId = crypto.randomUUID(); lastBody = input.value }
            try {
              await liveRequest(`/comments/${encodeURIComponent(item.name)}`, { method: 'POST', body: JSON.stringify({ nickname: '博主', body: input.value.trim(), visitor: visitorId(), parent: item.id, requestId }) }, getToken())
              status.textContent = '回复已公开。'; await load()
            } catch (error) { status.textContent = error.message }
            finally { send.disabled = false }
          })
          card.append(form)
        }
        list.append(card)
      }
      next = data.next; more.hidden = !next
    } catch (error) { status.textContent = error.message }
    finally { more.disabled = false }
  }
  document.getElementById('manage-comments').addEventListener('click', () => {
    dialog.showModal()
    status.textContent = liveEndpoint ? '' : '实时服务尚未启用。'
    if (liveEndpoint) void load()
  })
  document.getElementById('close-comments').addEventListener('click', () => dialog.close())
  document.getElementById('refresh-comments').addEventListener('click', () => void load())
  more.addEventListener('click', () => void load(true))
}
