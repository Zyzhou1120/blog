export function setupFullscreen({ showMessage }) {
  const button = document.getElementById('focus-mode')
  const root = document.documentElement
  let pending = false

  function display(enabled) {
    document.body.classList.toggle('focus-mode', enabled)
    button.setAttribute('aria-pressed', String(enabled))
    button.setAttribute('aria-label', enabled ? '退出全屏' : '全屏编辑')
    button.title = enabled ? '退出全屏（Esc）' : '全屏编辑'
    // Recalculate wrapped line numbers after the available width changes.
    window.dispatchEvent(new Event('resize'))
  }

  async function exit() {
    if (document.fullscreenElement === root) {
      try { await document.exitFullscreen() } catch {
        showMessage('暂时无法退出全屏，请按 Esc。', true)
        return
      }
    }
    display(false)
  }

  button.addEventListener('click', async () => {
    if (pending) return
    pending = true
    try {
      if (document.body.classList.contains('focus-mode')) return await exit()
      display(true)
      try {
        if (!root.requestFullscreen) throw new Error('Fullscreen unavailable')
        await root.requestFullscreen()
      } catch {
        showMessage('当前浏览器不支持屏幕全屏，已展开至整个页面；按 Esc 可退出。')
      }
    } finally { pending = false }
  })
  document.addEventListener('fullscreenchange', () => display(document.fullscreenElement === root))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) void exit()
  })
}
