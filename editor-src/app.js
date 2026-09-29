import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { parse as parseYaml } from 'yaml'
import {
  createIcons, SquarePen, KeyRound, ArrowRight, Menu, FilePlus2,
  Upload, LogOut, RefreshCw, ExternalLink, FileText, X,
} from 'lucide'

const OWNER = 'Zyzhou1120'
const REPO = 'blog'
const BRANCH = 'main'
const POSTS_PATH = 'source/_posts'
const API = `https://api.github.com/repos/${OWNER}/${REPO}`
const SESSION_TOKEN_KEY = 'blog-editor:token'
const LAST_DOCUMENT_KEY = 'blog-editor:last-document'
const icons = { SquarePen, KeyRound, ArrowRight, Menu, FilePlus2, Upload, LogOut, RefreshCw, ExternalLink, FileText, X }
const $ = (id) => document.getElementById(id)

let token = ''
let posts = []
let filename = ''
let sha = null
let baseText = ''
let saveTimer = null
let activeView = 'edit'

createIcons({ icons })

function encodedPath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function request(path, options = {}) {
  const response = await fetch(path.startsWith('https://') ? path : `${API}${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(result.message || `GitHub 请求失败 (${response.status})`)
    error.status = response.status
    throw error
  }
  return result
}

function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g, '')), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return btoa(binary)
}

function draftKey(name) {
  return `blog-editor:draft:${name}`
}

function setStatus(value) {
  $('save-state').textContent = value
}

function showMessage(value, error = false) {
  const message = $('message')
  message.textContent = value
  message.classList.toggle('error', error)
  message.hidden = false
}

function showError(error) {
  if (error.status === 401) return '令牌无效或已过期，请重新连接。'
  if (error.status === 403) return '没有足够的仓库权限，或 GitHub 暂时限制了请求。'
  if (isConflict(error)) return '远程文章已有新修改。你的草稿已保存在本地，载入最新版本后再检查内容。'
  return error.message || '操作失败，请稍后重试。'
}

function isConflict(error) {
  return error.status === 409 || (error.status === 422 && /does not match|sha/i.test(error.message))
}

function unsaved() {
  return filename && $('markdown').value !== baseText
}

function canLeave() {
  return !unsaved() || window.confirm('当前有未提交的修改。草稿已保存在此浏览器，确定切换吗？')
}

function storeDraft() {
  if (!filename) return
  if (unsaved()) {
    localStorage.setItem(draftKey(filename), JSON.stringify({ text: $('markdown').value, sha }))
    setStatus('本地草稿已保存')
  } else {
    localStorage.removeItem(draftKey(filename))
    setStatus('已同步')
  }
}

function renderPreview() {
  const markdown = $('markdown').value
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  let body = markdown
  let title = ''
  if (match) {
    body = markdown.slice(match[0].length)
    try { title = String(parseYaml(match[1])?.title || '') } catch { /* Show the body even with incomplete metadata. */ }
  }
  const titleHtml = title ? `<h1>${DOMPurify.sanitize(title, { ALLOWED_TAGS: [] })}</h1>` : ''
  $('preview').innerHTML = DOMPurify.sanitize(titleHtml + marked.parse(body), { USE_PROFILES: { html: true } })
  $('preview').querySelectorAll('a').forEach((link) => {
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  })
  $('word-count').textContent = `${body.replace(/\s/g, '').length} 字`
  $('dirty-dot').hidden = !unsaved()
}

function renderPosts() {
  const list = $('post-list')
  list.replaceChildren()
  if (!posts.length) {
    const empty = document.createElement('p')
    empty.className = 'list-empty'
    empty.textContent = '还没有文章'
    list.append(empty)
    return
  }
  for (const post of posts) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `post-item${post.name === filename ? ' selected' : ''}`
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', String(post.name === filename))
    const title = document.createElement('span')
    title.className = 'post-item-title'
    title.textContent = post.name.replace(/\.md$/i, '')
    const extension = document.createElement('small')
    extension.textContent = 'Markdown'
    button.append(title, extension)
    button.addEventListener('click', () => openPost(post))
    list.append(button)
  }
}

async function loadPosts() {
  const result = await request(`/contents/${POSTS_PATH}?ref=${BRANCH}`)
  posts = result.filter((item) => item.type === 'file' && item.name.endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'))
  renderPosts()
}

function setDocument(name, text, currentSha) {
  filename = name
  sha = currentSha
  baseText = text
  sessionStorage.setItem(LAST_DOCUMENT_KEY, name)
  $('filename').textContent = name
  $('markdown').value = text
  $('draft-notice').hidden = true
  $('conflict-notice').hidden = true
  $('reload-post').disabled = !currentSha
  $('message').hidden = true
  renderPreview()
  renderPosts()
  setStatus('已同步')
  $('sidebar').classList.remove('open')
}

async function openPost(post, force = false) {
  if ((post.name === filename && !force) || !canLeave()) return
  storeDraft()
  setStatus('正在读取...')
  try {
    const result = await request(`/contents/${encodedPath(`${POSTS_PATH}/${post.name}`)}?ref=${BRANCH}`)
    setDocument(post.name, decodeBase64(result.content), result.sha)
    const saved = localStorage.getItem(draftKey(post.name))
    if (saved) {
      const draft = JSON.parse(saved)
      if (draft.text !== baseText) {
        if (draft.sha === sha) {
          $('markdown').value = draft.text
          renderPreview()
          setStatus('本地草稿已恢复')
        } else {
          $('draft-copy').textContent = '远程文章已更新。恢复草稿后提交会覆盖远程内容。'
          $('draft-notice').hidden = false
        }
      }
    }
  } catch (error) {
    showMessage(showError(error), true)
    setStatus('读取失败')
  }
}

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function createPost(title) {
  if (!canLeave()) return
  storeDraft()
  const slug = Array.from(title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')).slice(0, 48).join('')
  const name = `${localDate()}-${slug || 'post'}.md`
  const text = `---\ntitle: ${JSON.stringify(title)}\ndate: ${localDate()}\ntags: []\ncategories: []\n---\n\n`
  setDocument(name, '', null)
  $('markdown').value = text
  renderPreview()
  storeDraft()
  $('markdown').focus()
  setView('edit')
}

function setView(view) {
  activeView = view
  document.body.dataset.view = view
  $('edit-tab').classList.toggle('active', view === 'edit')
  $('preview-tab').classList.toggle('active', view === 'preview')
}

async function publish() {
  if (!filename) return showMessage('请先选择或新建文章。', true)
  if (!unsaved()) return showMessage('没有需要提交的修改。')
  clearTimeout(saveTimer)
  storeDraft()
  const button = $('publish')
  button.disabled = true
  setStatus('正在提交...')
  try {
    const path = `/contents/${encodedPath(`${POSTS_PATH}/${filename}`)}`
    if (sha) {
      const latest = await request(`${path}?ref=${BRANCH}`)
      if (latest.sha !== sha) {
        const error = new Error('远程文章已有新修改')
        error.status = 409
        throw error
      }
    }
    const text = $('markdown').value
    const result = await request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Add'} post: ${filename}`,
        content: encodeBase64(text),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    })
    sha = result.content.sha
    baseText = text
    localStorage.removeItem(draftKey(filename))
    renderPreview()
    setStatus('已提交到 GitHub')
    showMessage('文章已提交到 GitHub。公开站点目前仍需手动部署。')
    try {
      await loadPosts()
    } catch {
      showMessage('文章已提交到 GitHub，但文章列表暂时无法刷新。')
    }
  } catch (error) {
    setStatus('提交失败')
    if (isConflict(error)) $('conflict-notice').hidden = false
    showMessage(showError(error), true)
  } finally {
    button.disabled = false
  }
}

async function connect(nextToken) {
  token = nextToken
  $('auth-button').disabled = true
  $('auth-error').hidden = true
  try {
    const account = await request('https://api.github.com/user')
    if (account.login.toLowerCase() !== OWNER.toLowerCase()) throw new Error(`此编辑页仅允许 ${OWNER} 登录。`)
    const repository = await request('')
    if (repository.permissions?.push === false) throw new Error('此令牌没有仓库写入权限。请授予 Contents 读写权限。')
    await loadPosts()
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    $('account-name').textContent = `@${account.login}`
    $('token').value = ''
    $('auth-view').hidden = true
    $('editor-view').hidden = false
    const lastDocument = sessionStorage.getItem(LAST_DOCUMENT_KEY)
    const lastPost = posts.find((post) => post.name === lastDocument)
    if (lastPost) {
      await openPost(lastPost)
    } else if (lastDocument && localStorage.getItem(draftKey(lastDocument))) {
      const draft = JSON.parse(localStorage.getItem(draftKey(lastDocument)))
      setDocument(lastDocument, '', null)
      $('markdown').value = draft.text
      renderPreview()
      setStatus('本地草稿已恢复')
    } else if (posts[0]) {
      await openPost(posts[0])
    }
  } catch (error) {
    token = ''
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    $('auth-error').textContent = showError(error)
    $('auth-error').hidden = false
  } finally {
    $('auth-button').disabled = false
  }
}

$('auth-form').addEventListener('submit', (event) => {
  event.preventDefault()
  connect($('token').value.trim())
})

$('markdown').addEventListener('input', () => {
  renderPreview()
  setStatus('正在保存草稿...')
  clearTimeout(saveTimer)
  saveTimer = setTimeout(storeDraft, 350)
})

$('new-post').addEventListener('click', () => $('new-dialog').showModal())
$('new-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const title = $('new-title').value.trim()
  if (!title) return
  $('new-dialog').close()
  $('new-title').value = ''
  createPost(title)
})
$('close-dialog').addEventListener('click', () => $('new-dialog').close())
$('cancel-new').addEventListener('click', () => $('new-dialog').close())
$('publish').addEventListener('click', publish)
$('reload-post').addEventListener('click', () => {
  if (filename && sha) openPost({ name: filename }, true)
})
$('reload-conflict').addEventListener('click', () => openPost({ name: filename }, true))
$('refresh-posts').addEventListener('click', async () => {
  try { await loadPosts() } catch (error) { showMessage(showError(error), true) }
})
$('restore-draft').addEventListener('click', () => {
  const draft = JSON.parse(localStorage.getItem(draftKey(filename)))
  if (draft) $('markdown').value = draft.text
  $('draft-notice').hidden = true
  renderPreview()
  setStatus('本地草稿已恢复')
})
$('dismiss-draft').addEventListener('click', () => {
  localStorage.removeItem(draftKey(filename))
  $('draft-notice').hidden = true
})
$('edit-tab').addEventListener('click', () => setView('edit'))
$('preview-tab').addEventListener('click', () => setView('preview'))
$('sidebar-toggle').addEventListener('click', () => $('sidebar').classList.toggle('open'))
$('logout').addEventListener('click', () => {
  storeDraft()
  token = ''
  sessionStorage.removeItem(SESSION_TOKEN_KEY)
  filename = ''
  sha = null
  baseText = ''
  $('editor-view').hidden = true
  $('auth-view').hidden = false
  $('token').focus()
})

const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY)
if (savedToken) connect(savedToken)

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !$('editor-view').hidden) {
    event.preventDefault()
    clearTimeout(saveTimer)
    storeDraft()
  }
})
