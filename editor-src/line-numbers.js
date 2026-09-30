// Measure soft-wrapped source lines with the textarea's actual font and width.
export function setupLineNumbers(input, gutter) {
  const mirror = document.createElement('div')
  mirror.setAttribute('aria-hidden', 'true')
  mirror.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;padding:0;border:0;'
  document.body.append(mirror)
  let previous = ''
  function update() {
    const style = getComputedStyle(input)
    const width = Math.max(0, input.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0))
    const key = `${width}:${style.font}:${input.value}`
    if (key !== previous) {
      previous = key
      Object.assign(mirror.style, { width: `${width}px`, font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, tabSize: style.tabSize, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'normal' })
      const lines = input.value.split('\n').map((text) => {
        const line = document.createElement('div')
        line.textContent = text || '\u200b'
        return line
      })
      mirror.replaceChildren(...lines)
      const fallback = parseFloat(style.lineHeight) || 25.2
      gutter.replaceChildren(...lines.map((line, index) => {
        const number = document.createElement('span')
        number.textContent = String(index + 1)
        number.style.cssText = `display:block;height:${line.getBoundingClientRect().height || fallback}px`
        return number
      }))
    }
    gutter.scrollTop = input.scrollTop
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(input)
  window.addEventListener('resize', update)
  document.fonts?.ready.then(update)
  return update
}
