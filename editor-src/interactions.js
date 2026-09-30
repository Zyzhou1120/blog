import { liveRequest } from './live-api.js'
import { readSession } from './session.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}
export function visitorId() {
  try {
    let id = localStorage.getItem('blog-views:visitor')
    if (!/^[a-f0-9-]{36}$/i.test(id || '')) {
      id = crypto.randomUUID()
      localStorage.setItem('blog-views:visitor', id)
    }
    return id
  } catch { return crypto.randomUUID() }
}

export function mountInteractions(post, article) {
  let section = document.getElementById('article-interactions')
  if (section) { section.dataset.name = post.name; return }
  section = el('section', 'article-interactions')
  section.id = 'article-interactions'
  section.dataset.name = post.name
  section.setAttribute('aria-label', '点赞与评论')
  const like = el('button', 'article-like', '♡ 点赞 · 加载中')
  like.type = 'button'
  const likeHint = el('span', 'interaction-hint', '喜欢这篇文章？可以多点几次。')
  const bar = el('div', 'like-bar')
  bar.append(like, likeHint)
  const title = el('h2', '', '评论')
  const status = el('p', 'interaction-status')
  status.setAttribute('role', 'status')
  const form = el('form', 'comment-form')
  const nameLabel = el('label', '', '昵称')
  const nickname = el('input')
  nickname.name = 'nickname'; nickname.maxLength = 30; nickname.required = true
  nickname.placeholder = '怎么称呼你？'
  nameLabel.append(nickname)
  const bodyLabel = el('label', '', '评论内容')
  const body = el('textarea')
  body.name = 'comment'; body.maxLength = 2000; body.required = true; body.rows = 4
  body.placeholder = '分享你的想法…'; bodyLabel.append(body)
  const replyHint = el('div', 'comment-reply-hint')
  replyHint.hidden = true
  const send = el('button', 'comment-submit', '发表评论')
  send.type = 'submit'
  const note = el('span', 'interaction-hint', '提交后直接公开，最多 2000 字。')
  const actions = el('div', 'comment-actions'); actions.append(send, note)
  form.append(nameLabel, replyHint, bodyLabel, actions)
  const list = el('div', 'comment-list')
  const more = el('button', 'comment-more', '加载更多评论'); more.type = 'button'; more.hidden = true
  const refresh = el('button', 'comment-refresh', '刷新评论'); refresh.type = 'button'
  section.append(bar, title, form, status, list, more, refresh)
  article.after(section)
  let parent = null, next = null, likeRequest = null, commentRequest = null, posting = false
  const endpoint = type => `/${type}/${encodeURIComponent(section.dataset.name)}`
  const ownerToken = () => readSession()
  function identity() {
    const owner = Boolean(ownerToken())
    nickname.disabled = owner
    if (owner) nickname.value = '博主'
    else if (nickname.value === '博主') nickname.value = ''
    send.textContent = owner ? '以博主身份发表评论' : '发表评论'
    return owner
  }
  try { nickname.value = localStorage.getItem('blog-comment:nickname') || '' } catch { /* Optional preference. */ }
  identity()
  function cancelReply() { parent = null; replyHint.hidden = true; replyHint.replaceChildren() }
  function render(items, append = false) {
    if (!append) list.replaceChildren()
    if (!items.length && !append) list.append(el('p', 'interaction-hint', '还没有评论，来聊聊你的想法吧。'))
    for (const item of items) {
      const card = el('article', 'comment-item')
      const meta = el('div', 'comment-meta')
      meta.append(el('strong', '', item.nickname))
      if (item.owner) meta.append(el('span', 'comment-owner', '博主'))
      const date = el('time', '', new Date(item.created).toLocaleString('zh-CN'))
      date.dateTime = item.created; meta.append(date)
      if (item.parent) card.append(el('div', 'comment-parent', `回复 ${item.replyTo || '已删除的评论'}`))
      const text = el('p', 'comment-body', item.body)
      const reply = el('button', 'comment-reply', '回复'); reply.type = 'button'
      reply.addEventListener('click', () => {
        parent = item.id
        const cancel = el('button', '', '取消回复'); cancel.type = 'button'; cancel.addEventListener('click', cancelReply)
        replyHint.replaceChildren(document.createTextNode(`回复 ${item.nickname} `), cancel)
        replyHint.hidden = false; body.focus()
      })
      card.prepend(meta); card.append(text, reply); list.append(card)
    }
  }
  async function load(append = false) {
    refresh.disabled = more.disabled = true
    try {
      const data = await liveRequest(endpoint('comments') + (append && next ? `?before=${next}` : ''))
      render(data.items, append); next = data.next; more.hidden = !next
    } catch { status.textContent = '暂时无法读取评论，请点击刷新评论重试。' }
    finally { refresh.disabled = more.disabled = false }
  }
  async function summary() {
    try {
      const data = await liveRequest(endpoint('engagement'))
      like.textContent = `♡ 点赞 · ${data.likes}`
      title.textContent = `评论（${data.comments}）`
    } catch { like.textContent = '♡ 点赞'; status.textContent = '暂时无法读取点赞数。' }
  }
  like.addEventListener('click', async () => {
    if (like.disabled) return
    like.disabled = true
    likeRequest ||= crypto.randomUUID()
    try {
      const result = await liveRequest(endpoint('likes'), { method: 'POST', body: JSON.stringify({ requestId: likeRequest }) })
      likeRequest = null; like.textContent = `♥ 点赞 · ${result.likes}`
      status.textContent = '谢谢你的喜欢！'
    } catch { status.textContent = '点赞暂未确认，再点一次可重试。' }
    finally { like.disabled = false }
  })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (posting) return
    identity()
    if (!body.value.trim() || !nickname.value.trim()) { status.textContent = '请填写昵称和评论内容。'; return }
    posting = true; send.disabled = true
    const data = { nickname: nickname.value.trim(), body: body.value.trim(), parent, visitor: visitorId() }
    const fingerprint = JSON.stringify(data)
    if (commentRequest?.fingerprint !== fingerprint) commentRequest = { fingerprint, id: crypto.randomUUID() }
    try {
      await liveRequest(endpoint('comments'), { method: 'POST', body: JSON.stringify({ ...data, requestId: commentRequest.id }) }, ownerToken())
      commentRequest = null; body.value = ''; cancelReply()
      try { if (!ownerToken()) localStorage.setItem('blog-comment:nickname', data.nickname) } catch { /* Optional preference. */ }
      status.textContent = '评论已公开。'; await Promise.all([load(), summary()])
    } catch (error) { status.textContent = error.message || '提交失败，内容已保留，请重试。' }
    finally { posting = false; send.disabled = false }
  })
  more.addEventListener('click', () => void load(true))
  refresh.addEventListener('click', () => { identity(); void load(); void summary() })
  void load(); void summary()
}
