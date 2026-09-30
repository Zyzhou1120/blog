export function setupSidebar() {
  const sidebar = document.getElementById('sidebar')
  const toggle = document.getElementById('sidebar-toggle')
  const collapse = document.getElementById('sidebar-collapse')
  const key = 'blog-editor:sidebar-collapsed'
  let collapsed = false
  try { collapsed = localStorage.getItem(key) === 'true' } catch { /* The toggle still works when storage is unavailable. */ }
  const isMobile = () => window.innerWidth <= 850
  function update() {
    document.body.classList.toggle('sidebar-collapsed', collapsed)
    const expanded = isMobile() ? sidebar.classList.contains('open') : !collapsed
    sidebar.inert = !expanded
    toggle.setAttribute('aria-expanded', String(expanded))
    toggle.setAttribute('aria-label', expanded ? '收起文章库' : '展开文章库')
    toggle.title = expanded ? '收起文章库' : '展开文章库'
  }
  function setCollapsed(value) {
    collapsed = value
    try { localStorage.setItem(key, String(value)) } catch { /* Keep the preference in memory. */ }
  }
  toggle.addEventListener('click', () => {
    if (isMobile()) sidebar.classList.toggle('open')
    else setCollapsed(!collapsed)
    update()
  })
  collapse.addEventListener('click', () => {
    if (isMobile()) sidebar.classList.remove('open')
    else setCollapsed(true)
    update()
    toggle.focus()
  })
  window.addEventListener('resize', update)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isMobile()) { sidebar.classList.remove('open'); update() }
  })
  update()
  return { closeOnMobile() { sidebar.classList.remove('open'); update() } }
}
