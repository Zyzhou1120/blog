import { applyMarkdownCommand } from './commands.js'
import { setupLineNumbers } from './line-numbers.js'
import { setupFullscreen } from './fullscreen.js'
import { setupHighlighting } from './highlighting.js'

export function setupToolbar({ showMessage }) {
  const $ = (id) => document.getElementById(id)
  const input = $('markdown')
  const updateLineNumbers = setupLineNumbers(input, $('line-numbers'))
  const updateHighlighting = setupHighlighting(input, $('source-highlight'))
  let history = []
  let position = -1
  let restoring = false
  let syncing = false
  const snapshot = () => ({ text: input.value, start: input.selectionStart, end: input.selectionEnd })

  function update() {
    updateLineNumbers()
    updateHighlighting()
    const before = input.value.slice(0, input.selectionStart).split('\n')
    $('cursor-position').textContent = `第 ${before.length} 行，第 ${before.at(-1).length + 1} 列`
    $('undo').disabled = position <= 0
    $('redo').disabled = position >= history.length - 1
  }

  function reset() {
    history = [snapshot()]
    position = 0
    input.scrollTop = 0
    update()
  }

  function apply(value) {
    input.value = value.text
    input.focus()
    input.setSelectionRange(value.start, value.end)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    update()
  }

  function undo(delta) {
    const next = position + delta
    if (next < 0 || next >= history.length) return
    position = next
    restoring = true
    apply(history[position])
    restoring = false
  }

  function command(name) {
    if (!$('filename').textContent) return showMessage('请先选择或新建文章。')
    history[position] = snapshot()
    const value = applyMarkdownCommand(input.value, input.selectionStart, input.selectionEnd, name, true)
    if (!value) return showMessage('请把光标移到下方正文中，再使用格式按钮。')
    apply(value)
  }

  $('markdown-toolbar').addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault()
  })
  $('markdown-toolbar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]')
    if (button) command(button.dataset.command)
  })
  $('undo').addEventListener('click', () => undo(-1))
  $('redo').addEventListener('click', () => undo(1))
  input.addEventListener('input', () => {
    if (!restoring && history[position]?.text !== input.value) {
      history = history.slice(0, position + 1)
      history.push(snapshot())
      if (history.length > 150) history.shift()
      position = history.length - 1
    }
    update()
  })
  input.addEventListener('select', update)
  input.addEventListener('click', update)
  input.addEventListener('keyup', update)
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const mod = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (mod && ['b', 'i', 'k'].includes(key)) {
      event.preventDefault()
      command({ b: 'bold', i: 'italic', k: 'link' }[key])
    } else if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault()
      undo(key === 'y' || event.shiftKey ? 1 : -1)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      command('indent')
    }
  })

  function scroll(source, destination) {
    $('line-numbers').scrollTop = input.scrollTop
    if (syncing || !$('sync-scroll').checked) return
    const distance = source.scrollHeight - source.clientHeight
    if (distance <= 0) return
    syncing = true
    destination.scrollTop = source.scrollTop / distance * Math.max(0, destination.scrollHeight - destination.clientHeight)
    requestAnimationFrame(() => { syncing = false })
  }
  input.addEventListener('scroll', () => scroll(input, $('preview')))
  $('preview').addEventListener('scroll', () => scroll($('preview'), input))
  for (const button of document.querySelectorAll('button[data-layout]')) {
    button.addEventListener('click', () => {
      document.body.dataset.layout = button.dataset.layout
      document.body.dataset.view = button.dataset.layout === 'preview' ? 'preview' : 'edit'
      for (const item of document.querySelectorAll('button[data-layout]')) item.setAttribute('aria-pressed', String(item === button))
    })
  }
  const fullscreen = setupFullscreen({ showMessage })
  $('scroll-top').addEventListener('click', () => { input.scrollTop = 0; $('preview').scrollTop = 0 })
  $('editor-help').addEventListener('click', () => $('help-dialog').showModal())
  $('close-help').addEventListener('click', () => $('help-dialog').close())
  reset()
  return { reset, update, chooseImageFile: fullscreen.chooseImageFile }
}
