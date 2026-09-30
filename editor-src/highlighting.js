import hljs from 'highlight.js/lib/core'
import markdown from 'highlight.js/lib/languages/markdown'

hljs.registerLanguage('editor-markdown', (api) => {
  const language = markdown(api)
  const math = {
    scope: 'formula',
    variants: [
      { begin: /(?<!\\)\$\$/, end: /(?<!\\)\$\$/ },
      { begin: /(?<!\\)\$(?![\s$])/, end: /(?<!\\)\$|$/ },
      { begin: /\\\(/, end: /\\\)/ },
      { begin: /\\\[/, end: /\\\]/ },
    ],
  }
  // Add formulas inside headings/emphasis too, without interpreting code as math.
  const seen = new Set()
  function extend(mode) {
    if (seen.has(mode)) return
    seen.add(mode)
    if (['code', 'link', 'string', 'symbol'].includes(mode.className) || mode.subLanguage) return
    for (const child of [...(mode.contains || []), ...(mode.variants || [])]) extend(child)
    if (mode.contains) mode.contains.unshift(math)
  }
  extend(language)
  return language
})

export function highlightMarkdown(text) {
  return hljs.highlight(text, { language: 'editor-markdown' }).value
}

export function setupHighlighting(input, layer) {
  const wrapper = input.parentElement
  let previous
  function syncScroll() {
    layer.scrollTop = input.scrollTop
    layer.scrollLeft = input.scrollLeft
  }
  function update() {
    const style = getComputedStyle(input)
    // Use the textarea's inner width so native scrollbars cannot shift wrapping.
    Object.assign(layer.style, {
      width: `${input.clientWidth}px`, height: `${input.clientHeight}px`,
      font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
      padding: style.padding, tabSize: style.tabSize,
    })
    if (previous !== input.value) {
      previous = input.value
      layer.innerHTML = highlightMarkdown(previous)
      // A final empty line needs a glyph to retain its line box.
      layer.append(document.createTextNode('\u200b'))
    }
    wrapper.classList.add('syntax-highlighted')
    syncScroll()
  }
  input.addEventListener('scroll', syncScroll)
  input.addEventListener('compositionstart', () => wrapper.classList.add('is-composing'))
  input.addEventListener('compositionend', () => {
    wrapper.classList.remove('is-composing')
    update()
  })
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(input)
  window.addEventListener('resize', update)
  document.fonts?.ready.then(update)
  return update
}
