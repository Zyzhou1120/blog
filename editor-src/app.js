import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { parse as parseYaml } from 'yaml'
import { splitPost, joinPost, filenameForTitle } from '../shared/post.mjs'
import catalog from '../shared/catalog.cjs'
import mathExtension from '../shared/math.cjs'
import { createPublicationTracker } from './publication.js'
import { setupToolbar } from './toolbar.js'
import { renderSourcePreview } from './preview-source.js'
import { liveEndpoint, liveRequest, liveUrl } from './live-api.js'
import { setupImages } from './images.js'
import { setupCommentManager } from './comment-manager.js'
import { readSession, rememberSession, clearSession, shouldRememberSession } from './session.js'
import { setupSidebar } from './sidebar.js'
import { categoryPaths } from './categories.js'
import {
  createIcons, SquarePen, KeyRound, ArrowRight, Menu, Search, PanelLeft, ChevronLeft, FilePlus2,
  Upload, LogOut, RefreshCw, ExternalLink, FileText, Trash2, X,
  Minus, Bold, Italic, Strikethrough, Sigma, Link, Image, Code, SquareCode,
  Table2, Quote, List, ListOrdered, ListChecks, Undo2, Redo2, Columns2, Eye, Maximize, CircleHelp,
} from 'lucide'

const OWNER = 'Zyzhou1120'
const REPO = 'blog'
const BRANCH = 'main'
const POSTS_PATH = 'source/_posts'
const API = `https://api.github.com/repos/${OWNER}/${REPO}`
const LAST_DOCUMENT_KEY = 'blog-editor:last-document'
const icons = { SquarePen, KeyRound, ArrowRight, Menu, Search, PanelLeft, ChevronLeft, FilePlus2, Upload, LogOut, RefreshCw, ExternalLink, FileText, Trash2, X, Minus, Bold, Italic, Strikethrough, Sigma, Link, Image, Code, SquareCode, Table2, Quote, List, ListOrdered, ListChecks, Undo2, Redo2, Columns2, Eye, Maximize, CircleHelp }
const $ = (id) => document.getElementById(id)

let token = ''
let posts = []
const postDetails = new Map()
let filename = ''
let sha = null
let baseText = ''
let saveTimer = null
let activeView = 'edit'
let liveCheck = 0
let documentSource = splitPost('')
let initialFields = {}

marked.use(mathExtension())
marked.setOptions({ breaks: true })
createIcons({ icons })
const controls = setupToolbar({ showMessage })
const sidebarControls = setupSidebar()
setupCommentManager(() => token)
setupImages({
  chooseImageFile: controls.chooseImageFile,
  input: $('markdown'), button: $('upload-image'), getDocument: () => token ? filename : '', showMessage,
  upload: async (content) => {
    if (!liveEndpoint) throw new Error('请先启用实时发布服务。')
    return liveRequest('/images', { method: 'POST', body: JSON.stringify({ content }), signal: AbortSignal.timeout(60000) }, token)
  },
})
const siteRoot = new URL('../', location.href)
const publication = createPublicationTracker({
  manifestUrl: new URL('publish-status.json', siteRoot).href,
  api: API,
  onChange({ state, article, sha: publishedSha }) {
    $('publication-bar').dataset.state = state
    $('publication-state').textContent = {
      unpublished: '尚未提交 · 草稿只保存在此浏览器',
      checking: '正在检查公开网站的版本…',
      publishing: '发布中 · 文章已保存，公开网站尚未更新',
      published: '已发布 · 公开网站已包含这次保存',
      failed: '发布失败 · 文章已保存，请查看发布记录',
      unknown: '暂时无法确认发布状态，正在重试…',
      delayed: '尚未确认上线，请检查发布记录或稍后重试',
    }[state]
    $('view-published').hidden = true
    if (state === 'published' && article?.url) {
      const url = new URL(article.url, siteRoot)
      if (url.origin === siteRoot.origin && url.pathname.startsWith(siteRoot.pathname)) {
        url.searchParams.set('published', publishedSha)
        $('view-published').href = url.href
        $('view-published').hidden = false
      }
    }
    if ($('message').dataset.kind === 'publication') {
      if (state === 'published') showMessage('文章已发布，点击“查看最新文章”查看。', false, 'publication')
      if (state === 'failed') showMessage('文章已保存，但网站发布失败。请点击“发布记录”查看原因。', true, 'publication')
    }
  },
})

function trackPublication(commit = null) {
  if (liveEndpoint) {
    void checkLivePublication()
    return
  }
  const key = `blog-editor:publication:${filename}`
  if (commit) sessionStorage.setItem(key, JSON.stringify({ sha, commit }))
  let saved = null
  try { saved = JSON.parse(sessionStorage.getItem(key)) } catch { /* Ignore an obsolete local record. */ }
  publication.watch(filename, sha, commit || (saved?.sha === sha ? saved.commit : null))
}

async function checkLivePublication() {
  const check = ++liveCheck
  const name = filename
  const wanted = sha
  $('publication-bar').dataset.state = 'checking'
  $('publication-state').textContent = wanted ? '正在核对已上线内容…' : '尚未发布 · 草稿只保存在此浏览器'
  $('view-published').hidden = true
  if (!wanted) return false
  try {
    const post = await liveRequest(`/posts/${encodeURIComponent(name)}`, {}, token)
    if (check !== liveCheck || filename !== name || sha !== wanted) return false
    const matches = post.sha === wanted && post.text === baseText
    $('publication-bar').dataset.state = matches ? 'published' : 'publishing'
    $('publication-state').textContent = matches ? (post.private ? '已保护 · 访客需要密码阅读' : '已发布 · 访客可立即读取，已备份到 GitHub') : '线上版本与当前内容不同，请重新载入文章'
    $('view-published').href = liveUrl(name, siteRoot).href
    $('view-published').hidden = !matches
    return matches
  } catch {
    if (check === liveCheck) {
      $('publication-bar').dataset.state = 'unknown'
      $('publication-state').textContent = '暂时无法确认上线，请稍后点击“检查发布”'
    }
    return false
  }
}

function encodedPath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function request(path, options = {}) {
  const response = await fetch(path.startsWith('https://') ? path : `${API}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
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

function showMessage(value, error = false, kind = 'general') {
  const message = $('message')
  message.textContent = value
  message.dataset.kind = kind
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

function setSource(text, preserveMetadata = false) {
  const next = splitPost(text)
  if (preserveMetadata && !next.header) {
    $('markdown').value = text
    return
  }
  documentSource = next
  initialFields = {
    title: String(next.meta.title || ''),
    categories: categoryPaths(next.meta.categories).map((path) => path.join(' / ')).join('、'),
    date: String(next.meta.date || '').slice(0, 10),
    priority: String(catalog.priority(next.meta.priority)),
    private: next.meta.private === true,
  }
  for (const [key, value] of Object.entries(initialFields)) {
    if (key === 'private') $('post-private').checked = value
    else $('post-' + key).value = value
  }
  $('post-password').value = ''
  $('private-password-field').hidden = !initialFields.private
  $('markdown').value = next.body
}

function currentSource() {
  const meta = { ...documentSource.meta }
  for (const key of ['title', 'date']) {
    const value = $('post-' + key).value.trim()
    if (value !== initialFields[key]) meta[key] = value
  }
  const priority = $('post-priority').value
  if (priority !== initialFields.priority) meta.priority = Number(priority)
  const categories = $('post-categories').value.trim()
  if (categories !== initialFields.categories) {
    const paths = categories.split(/[、,，]/).map((path) => path.split('/').map((part) => part.trim()).filter(Boolean)).filter((path) => path.length)
    meta.categories = paths.length === 1 ? paths[0] : paths
  }
  if ($('post-private').checked) meta.private = true
  else delete meta.private
  return joinPost(documentSource, meta, $('markdown').value)
}

function unsaved() {
  return filename && currentSource() !== baseText
}

function canLeave() {
  return !unsaved() || window.confirm('当前有未提交的修改。草稿已保存在此浏览器，确定切换吗？')
}

function storeDraft() {
  if (!filename) return
  if (unsaved()) {
    localStorage.setItem(draftKey(filename), JSON.stringify({ text: currentSource(), sha }))
    setStatus('本地草稿已保存')
  } else {
    localStorage.removeItem(draftKey(filename))
    setStatus(sha ? (liveEndpoint ? '已保存' : '已保存到仓库') : '本地草稿')
  }
}

function renderPreview() {
  const markdown = currentSource()
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  let body = markdown
  let title = ''
  if (match) {
    body = markdown.slice(match[0].length)
    try { title = String(parseYaml(match[1])?.title || '') } catch { /* Show the body even with incomplete metadata. */ }
  }
  const titleHtml = title ? `<h1>${DOMPurify.sanitize(title, { ALLOWED_TAGS: [] })}</h1>` : ''
  $('preview').innerHTML = DOMPurify.sanitize(titleHtml + renderSourcePreview(marked, $('markdown').value), { USE_PROFILES: { html: true, mathMl: true, svg: true } })
  $('preview').querySelectorAll('a').forEach((link) => {
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  })
  $('word-count').textContent = `${body.replace(/\s/g, '').length} 字`
  $('dirty-dot').hidden = !unsaved()
  if (filename && !unsaved()) postDetails.set(filename, { sha, meta: describePost(markdown, filename) })
  controls.update()
  renderPosts()
}

function describePost(text, name) {
  const match = text?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  try {
    const meta = match ? parseYaml(match[1], { maxAliasCount: 20 }) || {} : {}
    return { title: String(meta.title || name.replace(/\.md$/i, '')), category: categoryPaths(meta.categories).map((path) => path.join(' / ')).join('、') || '未分类', private: meta.private === true }
  } catch { return postDetails.get(name)?.meta || { title: name.replace(/\.md$/i, ''), category: '未分类' } }
}

function renderPosts() {
  const list = $('post-list')
  const scrollTop = list.scrollTop
  list.replaceChildren()
  const entries = posts.map((post) => ({ ...post }))
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('blog-editor:draft:')) continue
    const name = key.slice('blog-editor:draft:'.length)
    if (!entries.some((post) => post.name === name)) entries.push({ name, sha: null, local: true })
  }
  if (filename && !entries.some((post) => post.name === filename)) entries.unshift({ name: filename, sha })
  const query = $('post-search').value.trim().toLocaleLowerCase()
  const groups = new Map()
  for (const post of entries) {
    const active = post.name === filename
    let draft
    try { draft = JSON.parse(localStorage.getItem(draftKey(post.name)) || 'null') } catch { /* Ignore a damaged local draft. */ }
    const meta = active ? describePost(currentSource(), post.name) : draft ? describePost(draft.text, post.name) : postDetails.get(post.name)?.meta || describePost('', post.name)
    if (active) {
      $('document-title').textContent = meta.title
      $('document-title').title = meta.title
      $('filename').textContent = post.name
      $('filename').title = `source/_posts/${post.name}`
      let nextName = ''
      try { nextName = filenameForTitle($('post-title').value) } catch { /* Title may be incomplete while typing. */ }
      $('filename-hint').textContent = nextName && nextName !== filename ? `发布后文件名：${nextName}` : '文件名随标题自动更新'
    }
    if (query && !`${meta.title} ${meta.category} ${post.name}`.toLocaleLowerCase().includes(query)) continue
    const group = groups.get(meta.category) || []
    group.push({ ...post, ...meta, active, draft: active ? unsaved() || !sha : Boolean(draft) })
    groups.set(meta.category, group)
  }
  $('post-count').textContent = String(entries.length)
  for (const [category, items] of [...groups].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))) {
    const section = document.createElement('section')
    section.className = 'post-group'
    const heading = document.createElement('h2')
    heading.className = 'post-group-title'
    heading.textContent = category
    const count = document.createElement('span')
    count.textContent = String(items.length)
    heading.append(count)
    section.append(heading)
    for (const post of items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `post-item${post.active ? ' selected' : ''}`
      button.setAttribute('aria-current', String(post.active))
      button.title = `${post.title}\n${post.name}`
      const title = document.createElement('span')
      title.className = 'post-item-title'
      title.textContent = post.title
      const detail = document.createElement('span')
      detail.className = 'post-item-detail'
      const name = document.createElement('small')
      name.textContent = post.name
      detail.append(name)
      if (post.draft) {
        const badge = document.createElement('span')
        badge.className = 'post-draft-badge'
        badge.textContent = post.sha ? '未提交' : '草稿'
        detail.append(badge)
      }
      if (post.private) {
        const badge = document.createElement('span')
        badge.className = 'post-draft-badge'
        badge.textContent = '私密'
        detail.append(badge)
      }
      button.append(title, detail)
      button.addEventListener('click', () => openPost(post))
      section.append(button)
    }
    list.append(section)
  }
  if (!groups.size) {
    const empty = document.createElement('p')
    empty.className = 'list-empty'
    empty.textContent = query ? '没有匹配的文章，试试其他关键词' : '还没有文章，点击「新文章」开始写作'
    list.append(empty)
  }
  list.scrollTop = scrollTop
}

async function loadPostDetails() {
  const pending = posts.filter((post) => post.name !== filename && postDetails.get(post.name)?.sha !== post.sha)
  // Limit parallel reads for larger libraries and keep a failed read retryable.
  for (let i = 0; i < pending.length; i += 4) {
    await Promise.allSettled(pending.slice(i, i + 4).map(async (post) => {
      const result = liveEndpoint ? await liveRequest(`/posts/${encodeURIComponent(post.name)}`, {}, token) : await request(`/contents/${encodedPath(`${POSTS_PATH}/${post.name}`)}?ref=${BRANCH}`)
      const text = liveEndpoint ? result.text : decodeBase64(result.content)
      postDetails.set(post.name, { sha: result.sha, meta: describePost(text, post.name) })
    }))
    renderPosts()
  }
}

async function loadPosts() {
  const result = liveEndpoint ? await liveRequest('/posts') : await request(`/contents/${POSTS_PATH}?ref=${BRANCH}`)
  posts = result.filter((item) => (liveEndpoint || item.type === 'file') && item.name.endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'))
  renderPosts()
  if (filename) void loadPostDetails()
}

function setDocument(name, text, currentSha) {
  setSource(text)
  filename = name
  sha = currentSha
  baseText = text
  postDetails.set(name, { sha: currentSha, meta: describePost(text, name) })
  sessionStorage.setItem(LAST_DOCUMENT_KEY, name)
  $('filename').textContent = name
  $('draft-notice').hidden = true
  $('conflict-notice').hidden = true
  $('reload-post').disabled = !currentSha
  $('delete-post').disabled = false
  $('message').hidden = true
  renderPreview()
  renderPosts()
  controls.reset()
  setStatus(currentSha ? (initialFields.private ? '已保存到实时服务' : '已保存到仓库') : '本地草稿')
  if (currentSha && !$('post-title').value.trim()) showMessage('这篇文章缺少标题，请在上方填写后发布。正文已完整保留。', true)
  trackPublication()
  sidebarControls.closeOnMobile()
}

async function openPost(post, force = false) {
  if ((post.name === filename && !force) || !canLeave()) return
  storeDraft()
  setStatus('正在读取...')
  try {
    if (post.local) {
      const draft = JSON.parse(localStorage.getItem(draftKey(post.name)))
      setDocument(post.name, '', null)
      setSource(draft.text, true)
      renderPreview()
      controls.reset()
      setStatus('本地草稿已恢复')
      return
    }
    const result = liveEndpoint ? await liveRequest(`/posts/${encodeURIComponent(post.name)}`, {}, token) : await request(`/contents/${encodedPath(`${POSTS_PATH}/${post.name}`)}?ref=${BRANCH}`)
    setDocument(post.name, liveEndpoint ? result.text : decodeBase64(result.content), result.sha)
    const saved = localStorage.getItem(draftKey(post.name))
    if (saved) {
      const draft = JSON.parse(saved)
      if (draft.text !== baseText) {
        if (draft.sha === sha) {
          setSource(draft.text, true)
          renderPreview()
          controls.reset()
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
  const name = filenameForTitle(title)
  if (posts.some((post) => post.name === name) || localStorage.getItem(draftKey(name))) return showMessage('已有同名文章或草稿，请换一个标题。', true)
  const text = `---\ntitle: ${JSON.stringify(title)}\ndate: ${localDate()}\ntags: []\ncategories: []\n---\n\n`
  setDocument(name, '', null)
  setSource(text)
  renderPreview()
  controls.reset()
  storeDraft()
  $('markdown').focus()
  setView('edit')
}

function setView(view) {
  activeView = view
  document.body.dataset.view = view
  document.body.dataset.layout = 'split'
  $('edit-tab').classList.toggle('active', view === 'edit')
  $('preview-tab').classList.toggle('active', view === 'preview')
}

async function publish() {
  if (!filename) return showMessage('请先选择或新建文章。', true)
  if (!/^(?:[0-9]|10)$/.test($('post-priority').value)) return showMessage('重要级别必须为 0～10 的整数。', true)
  try { filenameForTitle($('post-title').value) } catch (error) { $('post-title').focus(); return showMessage(error.message, true) }
  if ($('post-private').checked && !liveEndpoint) return showMessage('私密文章需要实时服务，当前无法安全发布。', true)
  if (liveEndpoint) return publishLive()
  if (!unsaved()) {
    await publication.check(true)
    return showMessage(publication.state === 'published'
      ? '这份内容已经发布，点击“查看最新文章”打开最新版本。'
      : publication.state === 'failed'
        ? '文章已保存，但网站发布失败。请点击“发布记录”查看原因。'
        : '文章已保存到仓库，正在检查发布结果。请查看上方发布状态。', publication.state === 'failed', 'publication')
  }
  clearTimeout(saveTimer)
  storeDraft()
  const button = $('publish')
  const submittingName = filename
  const submittingSha = sha
  const text = currentSource()
  button.disabled = true
  setStatus('正在提交...')
  try {
    const path = `/contents/${encodedPath(`${POSTS_PATH}/${submittingName}`)}`
    if (submittingSha) {
      const latest = await request(`${path}?ref=${BRANCH}`)
      if (latest.sha !== submittingSha) {
        const error = new Error('远程文章已有新修改')
        error.status = 409
        throw error
      }
    }
    const result = await request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${submittingSha ? 'Update' : 'Add'} post: ${submittingName}`,
        content: encodeBase64(text),
        branch: BRANCH,
        ...(submittingSha ? { sha: submittingSha } : {}),
      }),
    })
    if (filename !== submittingName) {
      await loadPosts()
      return
    }
    sha = result.content.sha
    baseText = text
    storeDraft()
    renderPreview()
    if (!unsaved()) setStatus('已保存到仓库')
    trackPublication(result.commit?.sha)
    showMessage('文章已提交到 GitHub，网站正在自动发布。稍后点击“查看最新文章”查看。', false, 'publication')
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

async function publishLive() {
  const nextName = filenameForTitle($('post-title').value)
  const privateMode = $('post-private').checked
  const password = $('post-password').value
  const wasPrivate = sha && splitPost(baseText).meta.private === true
  if (privateMode && !wasPrivate && password.length < 12) return showMessage('请设置至少 12 位的阅读密码。', true)
  if (privateMode && password && (password.length < 12 || password.length > 128)) return showMessage('阅读密码需为 12～128 位。', true)
  if (privateMode && sha && !wasPrivate && !window.confirm('这篇文章以前公开发布过，旧正文仍可能从 GitHub 历史记录中找到。继续设置密码？')) return
  if (!privateMode && wasPrivate && !window.confirm('取消密码后，完整正文会写入公开 GitHub 仓库，所有访客都能阅读。确定公开？')) return
  if (!unsaved() && nextName === filename && !password) {
    const confirmed = await checkLivePublication()
    return showMessage(confirmed ? '这份内容已经上线，可以查看最新文章。' : '尚未确认上线，请查看上方状态。', !confirmed)
  }
  clearTimeout(saveTimer)
  storeDraft()
  const name = filename
  const text = currentSource()
  const previousSha = sha
  liveCheck += 1
  $('publish').disabled = true
  $('view-published').hidden = true
  setStatus('正在发布…')
  $('publication-bar').dataset.state = 'publishing'
  $('publication-state').textContent = '正在保存文章并通知访客…'
  try {
    const post = await liveRequest(`/posts/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ text, sha: previousSha, rename: true, private: privateMode, ...(password ? { password } : {}) }) }, token)
    if (filename !== name) { await loadPosts(); return }
    const editedWhileSaving = currentSource() !== text
    filename = post.name
    sessionStorage.setItem(LAST_DOCUMENT_KEY, filename)
    localStorage.removeItem(draftKey(name))
    postDetails.delete(name)
    posts = posts.filter((item) => item.name !== name)
    sha = post.sha
    baseText = post.text
    $('post-password').value = ''
    if (!editedWhileSaving) setSource(post.text)
    else if (splitPost(post.text).meta.permalink) documentSource.meta.permalink = splitPost(post.text).meta.permalink
    storeDraft()
    renderPreview()
    const confirmed = await checkLivePublication()
    showMessage(confirmed ? (privateMode ? '已设置密码，访客输入密码后可阅读。' : '发布成功，阅读页会自动更新。') : '文章已保存，正在等待线上核验，请点击“检查发布”。', !confirmed)
    try { await loadPosts() } catch { /* A list refresh cannot undo a confirmed save. */ }
  } catch (error) {
    setStatus('发布未完成 · 草稿已保留')
    $('publication-bar').dataset.state = 'unknown'
    $('publication-state').textContent = '未确认发布成功，请稍后重试；草稿仍在此浏览器'
    if (isConflict(error)) $('conflict-notice').hidden = false
    showMessage(showError(error), true)
  } finally { $('publish').disabled = false }
}

function clearDocument() {
  publication.stop()
  liveCheck += 1
  filename = ''
  sha = null
  baseText = ''
  setSource('')
  $('post-private').checked = false
  $('post-password').value = ''
  $('private-password-field').hidden = true
  $('document-title').textContent = '选择文章'
  $('filename').textContent = ''
  $('filename-hint').textContent = '文件名随标题自动更新'
  $('reload-post').disabled = true
  $('delete-post').disabled = true
  $('draft-notice').hidden = true
  $('conflict-notice').hidden = true
  $('publication-bar').dataset.state = 'unpublished'
  $('publication-state').textContent = '尚未发布'
  $('view-published').hidden = true
  renderPreview()
  setStatus('选择文章后开始写作')
}

async function deletePost() {
  const name = filename
  const currentSha = sha
  if (!name) return
  clearTimeout(saveTimer)
  storeDraft()
  $('delete-confirm').disabled = true
  $('delete-confirm').textContent = '正在删除…'
  $('delete-post').disabled = true
  $('publish').disabled = true
  try {
    if (currentSha) {
      if (liveEndpoint) {
        await liveRequest(`/posts/${encodeURIComponent(name)}`, { method: 'DELETE', body: JSON.stringify({ sha: currentSha }) }, token)
      } else {
        const path = `/contents/${encodedPath(`${POSTS_PATH}/${name}`)}`
        const latest = await request(`${path}?ref=${BRANCH}`)
        if (latest.sha !== currentSha) throw Object.assign(new Error('远程文章已有新修改'), { status: 409 })
        await request(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Delete post: ${name}`, sha: currentSha, branch: BRANCH }) })
      }
    }
    localStorage.removeItem(draftKey(name))
    sessionStorage.removeItem(LAST_DOCUMENT_KEY)
    sessionStorage.removeItem(`blog-editor:publication:${name}`)
    postDetails.delete(name)
    posts = posts.filter((post) => post.name !== name)
    $('post-search').value = ''
    $('delete-dialog').close()
    clearDocument()
    try {
      await loadPosts()
      if (posts[0]) await openPost(posts[0])
      showMessage(currentSha ? `“${name}”已删除，公开页面正在更新。` : '本地草稿已删除。')
    } catch {
      showMessage(`“${name}”已删除，文章列表暂时无法刷新。`)
    }
  } catch (error) {
    $('delete-dialog').close()
    if (isConflict(error)) $('conflict-notice').hidden = false
    showMessage(showError(error), true)
  } finally {
    $('delete-confirm').disabled = false
    $('delete-confirm').textContent = '确认删除'
    $('delete-post').disabled = !filename
    $('publish').disabled = false
  }
}

function showConnection(failed = false) {
  $('auth-view').hidden = true
  $('editor-view').hidden = true
  $('connection-view').hidden = false
  $('connection-title').textContent = failed ? '暂时无法连接' : '正在恢复编辑界面…'
  $('connection-detail').textContent = failed ? '登录状态已保留。网络恢复后点击重新连接即可。' : '正在读取文章和本地草稿，无需重新登录'
  $('retry-connection').hidden = !failed
  $('reset-connection').hidden = !failed
}

function showLogin() {
  $('connection-view').hidden = true
  $('editor-view').hidden = true
  $('auth-view').hidden = false
}

async function connect(nextToken, restoring = false) {
  token = nextToken
  let verified = false
  if (restoring) showConnection()
  $('auth-button').disabled = true
  $('auth-error').hidden = true
  try {
    const account = await request('https://api.github.com/user')
    if (account.login.toLowerCase() !== OWNER.toLowerCase()) throw Object.assign(new Error(`此编辑页仅允许 ${OWNER} 登录。`), { invalidSession: true })
    const repository = await request('')
    if (repository.permissions?.push === false) throw Object.assign(new Error('此令牌没有仓库写入权限。请授予 Contents 读写权限。'), { invalidSession: true })
    verified = true
    rememberSession(token, $('remember-session').checked)
    if (liveEndpoint) await liveRequest('/sync', { method: 'POST' }, token)
    await loadPosts()
    $('account-name').textContent = `@${account.login}`
    $('token').value = ''
    $('connection-view').hidden = true
    $('auth-view').hidden = true
    $('editor-view').hidden = false
    let lastDocument = sessionStorage.getItem(LAST_DOCUMENT_KEY)
    let lastPost = posts.find((post) => post.name === lastDocument)
    if (lastDocument && !lastPost && liveEndpoint) {
      try {
        const resolved = await liveRequest(`/posts/${encodeURIComponent(lastDocument)}`)
        lastPost = posts.find((post) => post.name === resolved.name)
        if (lastPost) {
          const draft = localStorage.getItem(draftKey(lastDocument))
          if (draft && !localStorage.getItem(draftKey(lastPost.name))) {
            localStorage.setItem(draftKey(lastPost.name), draft)
            localStorage.removeItem(draftKey(lastDocument))
          }
          lastDocument = lastPost.name
        }
      } catch { /* A local-only draft has no remote article yet. */ }
    }
    if (lastPost) {
      await openPost(lastPost)
    } else if (lastDocument && localStorage.getItem(draftKey(lastDocument))) {
      const draft = JSON.parse(localStorage.getItem(draftKey(lastDocument)))
      setDocument(lastDocument, '', null)
      setSource(draft.text, true)
      renderPreview()
      controls.reset()
      setStatus('本地草稿已恢复')
    } else if (posts[0]) {
      await openPost(posts[0])
    }
    void loadPostDetails()
  } catch (error) {
    if (error.status === 401 || error.invalidSession) {
      token = ''
      clearSession()
      showLogin()
      $('auth-error').textContent = showError(error)
      $('auth-error').hidden = false
    } else if (restoring || verified) {
      showConnection(true)
    } else {
      $('auth-error').textContent = showError(error)
      $('auth-error').hidden = false
    }
  } finally {
    $('auth-button').disabled = false
  }
}

$('auth-form').addEventListener('submit', (event) => {
  event.preventDefault()
  connect($('token').value.trim())
})

function contentChanged() {
  renderPreview()
  setStatus('正在保存草稿...')
  clearTimeout(saveTimer)
  saveTimer = setTimeout(storeDraft, 350)
}
$('markdown').addEventListener('input', contentChanged)
for (const key of ['title', 'categories', 'date', 'priority']) $('post-' + key).addEventListener('input', contentChanged)
$('post-private').addEventListener('change', () => { $('private-password-field').hidden = !$('post-private').checked; contentChanged() })

$('post-search').addEventListener('input', renderPosts)

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
$('delete-post').addEventListener('click', () => {
  if (!filename) return
  $('delete-title').textContent = describePost(currentSource(), filename).title
  $('delete-detail').textContent = sha
    ? '文章将从网站和仓库删除，相关浏览量、点赞与评论也会清除。未提交的修改会丢失。'
    : '这篇文章只保存在此浏览器，删除后无法恢复。'
  $('delete-dialog').showModal()
})
$('delete-form').addEventListener('submit', (event) => { event.preventDefault(); void deletePost() })
$('cancel-delete').addEventListener('click', () => $('delete-dialog').close())
$('close-delete').addEventListener('click', () => $('delete-dialog').close())
$('check-publication').addEventListener('click', () => liveEndpoint ? checkLivePublication() : publication.check(true))
$('reload-post').addEventListener('click', () => {
  if (filename && sha) openPost({ name: filename }, true)
})
$('reload-conflict').addEventListener('click', () => openPost({ name: filename }, true))
$('refresh-posts').addEventListener('click', async () => {
  try {
    if (liveEndpoint) await liveRequest('/sync', { method: 'POST' }, token)
    await loadPosts()
  } catch (error) { showMessage(showError(error), true) }
})
$('restore-draft').addEventListener('click', () => {
  const draft = JSON.parse(localStorage.getItem(draftKey(filename)))
  if (draft) setSource(draft.text, true)
  $('draft-notice').hidden = true
  renderPreview()
  controls.reset()
  setStatus('本地草稿已恢复')
})
$('dismiss-draft').addEventListener('click', () => {
  localStorage.removeItem(draftKey(filename))
  $('draft-notice').hidden = true
})
$('edit-tab').addEventListener('click', () => setView('edit'))
$('preview-tab').addEventListener('click', () => setView('preview'))
$('logout').addEventListener('click', () => {
  storeDraft()
  token = ''
  publication.stop()
  liveCheck += 1
  clearSession()
  filename = ''
  sha = null
  baseText = ''
  showLogin()
  $('token').focus()
})

const savedToken = readSession()
$('remember-session').checked = shouldRememberSession()
if (liveEndpoint) {
  const notice = document.createElement('p')
  notice.className = 'auth-note'
  notice.textContent = '实时发布已启用。令牌仅用于 GitHub 和你自己的发布服务，不会写入文章数据库。'
  $('auth-form').append(notice)
}
if (savedToken) connect(savedToken, true)
else showLogin()
$('retry-connection').addEventListener('click', () => connect(token, true))
$('reset-connection').addEventListener('click', () => {
  clearSession()
  token = ''
  showLogin()
  $('token').focus()
})

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !$('editor-view').hidden) {
    event.preventDefault()
    clearTimeout(saveTimer)
    storeDraft()
  }
})
