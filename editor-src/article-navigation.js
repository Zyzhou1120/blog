let cleanup = () => {}
let restoredAnchor = false

export function renderArticleNavigation(article) {
  cleanup()
  const aside = document.getElementById('aside-content')
  document.getElementById('reader-toc')?.remove()
  document.getElementById('reader-toc-mobile')?.remove()
  document.getElementById('card-toc')?.remove()
  aside?.classList.remove('article-navigation')
  article.classList.add('reader-prose')
  const allHeadings = [...article.querySelectorAll('h1, h2, h3, h4, h5, h6')]

  // Preserve built heading anchors; give live headings stable, unique anchors.
  const used = new Set([...document.querySelectorAll('[id]')].map(node => node.id))
  for (const heading of allHeadings) {
    if (heading.id) continue
    const base = 'section-' + (heading.textContent.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '') || 'heading')
    let id = base, index = 2
    while (used.has(id)) id = `${base}-${index++}`
    heading.id = id
    used.add(id)
  }
  const headings = allHeadings.filter(heading => heading.tagName !== 'H4')
  if (!headings.length) return
  const minLevel = Math.min(...headings.map(node => Number(node.tagName[1])))
  function navigation() {
    const nav = document.createElement('nav')
    nav.setAttribute('aria-label', '文章目录')
    const list = document.createElement('ol')
    headings.forEach(heading => {
      const li = document.createElement('li')
      li.style.setProperty('--toc-level', Number(heading.tagName[1]) - minLevel)
      const link = document.createElement('a')
      link.href = '#' + encodeURIComponent(heading.id)
      link.textContent = heading.textContent
      li.append(link)
      list.append(li)
    })
    nav.append(list)
    return nav
  }
  const card = document.createElement('section')
  card.id = 'reader-toc'
  card.className = 'card-widget reader-toc'
  const title = document.createElement('div')
  title.className = 'item-headline'
  title.textContent = '文章目录'
  card.append(title, navigation())
  if (aside) {
    aside.classList.add('article-navigation')
    ;(aside.querySelector('.sticky_layout') || aside).prepend(card)
  }
  const mobile = document.createElement('details')
  mobile.id = 'reader-toc-mobile'
  mobile.className = 'reader-toc'
  if (!aside) mobile.classList.add('toc-without-sidebar')
  const summary = document.createElement('summary')
  summary.textContent = '文章目录'
  mobile.append(summary, navigation())
  article.before(mobile)

  const links = [...card.querySelectorAll('a'), ...mobile.querySelectorAll('a')]
  let frame
  function updateActive() {
    frame = null
    let current = headings[0]
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= 110) current = heading
      else break
    }
    for (const link of links) {
      if (link.hash === '#' + encodeURIComponent(current.id)) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    }
  }
  const onScroll = () => { if (frame == null) frame = requestAnimationFrame(updateActive) }
  window.addEventListener('scroll', onScroll, { passive: true })
  updateActive()
  if (!restoredAnchor && location.hash) {
    let id
    try { id = decodeURIComponent(location.hash.slice(1)) } catch { /* Ignore a malformed link. */ }
    const heading = allHeadings.find(node => node.id === id)
    if (heading) {
      restoredAnchor = true
      heading.scrollIntoView?.({ block: 'start' })
    }
  }
  cleanup = () => { window.removeEventListener('scroll', onScroll); if (frame != null) cancelAnimationFrame(frame) }
}
