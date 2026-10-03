// Interpolate only between matching blocks, rather than percentages of the whole
// document. Both coordinates are content offsets, including each pane's padding.
export function mapScroll(position, pairs, sourceMax, targetMax) {
  if (sourceMax <= 0 || targetMax <= 0 || position <= 0) return 0
  if (position >= sourceMax) return targetMax
  const points = [[0, 0]]
  for (const pair of pairs) {
    const previous = points.at(-1)
    if (pair[0] > previous[0] && pair[1] >= previous[1] && pair[0] < sourceMax && pair[1] < targetMax) points.push(pair)
  }
  points.push([sourceMax, targetMax])
  const end = points.findIndex((point) => point[0] >= position)
  const [a, b] = [points[end - 1], points[end]]
  return a[1] + (position - a[0]) / (b[0] - a[0]) * (b[1] - a[1])
}

export function setupScrollSync(input, preview, gutter, checkbox) {
  let driver = input
  let frame = 0
  const expected = new WeakMap()

  function pairs() {
    const style = getComputedStyle(input)
    let y = parseFloat(style.paddingTop) || 0
    const lines = [...gutter.children].map((line) => {
      const offset = y
      y += parseFloat(line.style.height) || parseFloat(style.lineHeight) || 26
      return offset
    })
    const top = preview.getBoundingClientRect().top + preview.clientTop
    return [...preview.querySelectorAll('[data-source-line]')].flatMap((node) => {
      const source = lines[Number(node.dataset.sourceLine)]
      return source === undefined ? [] : [[source, node.getBoundingClientRect().top - top + preview.scrollTop]]
    })
  }

  function sync(source) {
    if (!checkbox.checked || !input.clientHeight || !preview.clientHeight) return
    const target = source === input ? preview : input
    const anchors = pairs().map((pair) => source === input ? pair : [pair[1], pair[0]])
    const position = mapScroll(source.scrollTop, anchors, source.scrollHeight - source.clientHeight, target.scrollHeight - target.clientHeight)
    if (Math.abs(target.scrollTop - position) < 1) return
    target.scrollTop = position
    // Suppress just the event caused by our write; the next user scroll in either
    // pane still works, even when the browser dispatches it in a later frame.
    expected.set(target, target.scrollTop)
  }

  function refresh() {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => { frame = 0; sync(driver) })
  }
  for (const pane of [input, preview]) pane.addEventListener('scroll', () => {
    const position = expected.get(pane)
    expected.delete(pane)
    if (position !== undefined && Math.abs(pane.scrollTop - position) < 1) return
    driver = pane
    sync(pane)
  })
  // A new preview follows the source, while a resize preserves the pane the
  // editor last scrolled. Re-measure actual layout so images and fonts count.
  const contentChanged = () => { driver = input; refresh() }
  new MutationObserver(contentChanged).observe(preview, { childList: true })
  preview.addEventListener('load', refresh, true)
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(refresh)
    observer.observe(input)
    observer.observe(preview)
  }
  window.addEventListener('resize', refresh)
  document.fonts?.ready.then(refresh)
  checkbox.addEventListener('change', contentChanged)
  return refresh
}
