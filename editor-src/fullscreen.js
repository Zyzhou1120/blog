export function setupFullscreen({ showMessage }) {
  const button = document.getElementById('focus-mode')
  const root = document.documentElement
  let pending = false
  let choosingFile = false
  let preserveLayout = false
  let restoreScreen = false

  function display(enabled) {
    document.body.classList.toggle('focus-mode', enabled)
    button.setAttribute('aria-pressed', String(enabled))
    button.setAttribute('aria-label', enabled ? restoreScreen ? '恢复屏幕全屏' : '退出全屏' : '全屏编辑')
    button.title = enabled ? restoreScreen ? '恢复屏幕全屏（Esc 退出编辑全屏）' : '退出全屏（Esc）' : '全屏编辑'
    // Recalculate wrapped line numbers after the available width changes.
    window.dispatchEvent(new Event('resize'))
  }

  async function exit() {
    preserveLayout = false
    restoreScreen = false
    if (document.fullscreenElement === root) {
      try { await document.exitFullscreen() } catch {
        showMessage('暂时无法退出全屏，请按 Esc。', true)
        return
      }
    }
    display(false)
  }

  async function resumeScreen() {
    if (!preserveLayout) return
    if (document.fullscreenElement === root) {
      preserveLayout = false
      restoreScreen = false
      return
    }
    try {
      await root.requestFullscreen()
      restoreScreen = false
      preserveLayout = false
    } catch {
      // Some browsers require a fresh click after their native file dialog.
      restoreScreen = true
    }
    display(true)
  }

  function chooseImageFile(picker) {
    const wasFullscreen = document.body.classList.contains('focus-mode')
    const wasNative = document.fullscreenElement === root
    choosingFile = wasFullscreen
    preserveLayout = wasFullscreen
    const finish = () => {
      picker.removeEventListener('change', finish)
      picker.removeEventListener('cancel', finish)
      choosingFile = false
      if (wasNative && preserveLayout) void resumeScreen()
      else if (!wasNative) preserveLayout = false
    }
    picker.addEventListener('change', finish)
    picker.addEventListener('cancel', finish)
    try { picker.click() } catch (error) { finish(); throw error }
  }

  button.addEventListener('click', async () => {
    if (pending) return
    pending = true
    try {
      if (restoreScreen) return await resumeScreen()
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
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === root
    if (active) { restoreScreen = false; if (!choosingFile) preserveLayout = false }
    display(active || choosingFile || preserveLayout)
  })
  document.addEventListener('keydown', (event) => {
    if (choosingFile) return
    if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) void exit()
  })
  return { chooseImageFile }
}
