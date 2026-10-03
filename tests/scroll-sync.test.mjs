import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Marked } from 'marked'
import { JSDOM } from 'jsdom'
import mathExtension from '../shared/math.cjs'
import { renderSourcePreview } from '../editor-src/preview-source.js'
import { mapScroll } from '../editor-src/scroll-sync.js'

test('source anchors preserve rendering, references and lines across math, images, lists and code', () => {
  const marked = new Marked(mathExtension(), { breaks: true })
  const source = '\n前文 [链接][ref]\n\n$$\n\\begin{aligned}\nx&=y\\\\\nz&=w\n\\end{aligned}\n$$\n\n![图片](example.png)\n\n> 引用\n>\n> 下一段\n\n- 一\n  - 嵌套\n- 二\n\n```js\nconst x = 1\n```\n\n[ref]: https://example.org\n\n### 应用\n\n| A | B |\n| - | - |\n| 1 | 2 |\n'
  const html = renderSourcePreview(marked, source)
  assert.equal(html.replace(/ data-source-line="\d+"/g, ''), marked.parse(source))
  const dom = new JSDOM(html)
  try {
    const doc = dom.window.document
    assert.equal(Number(doc.querySelector('h3').dataset.sourceLine), source.split('\n').indexOf('### 应用'))
    assert.equal(Number(doc.querySelector('.katex-display').dataset.sourceLine), 3)
    assert.equal(doc.querySelector('a').href, 'https://example.org/')
    assert.ok(doc.querySelector('pre[data-source-line]'))
    assert.ok(doc.querySelector('ul[data-source-line]'))
    assert.ok(doc.querySelector('table[data-source-line]'))
  } finally { dom.window.close() }
})

test('block positions map both ways, interpolate locally, and preserve scroll endpoints', () => {
  const pairs = [[100, 200], [600, 300], [800, 900]]
  assert.equal(mapScroll(600, pairs, 1200, 1600), 300)
  assert.equal(mapScroll(700, pairs, 1200, 1600), 600)
  assert.equal(mapScroll(300, pairs.map(([x,y]) => [y,x]), 1600, 1200), 600)
  assert.equal(mapScroll(0, pairs, 1200, 1600), 0)
  assert.equal(mapScroll(1200, pairs, 1200, 1600), 1600)
  assert.equal(mapScroll(100, pairs, 0, 1600), 0)
  // Content too near the bottom cannot reach the viewport top; it must not
  // prevent either pane from reaching its actual end.
  assert.equal(mapScroll(1000, [[100, 200], [1100, 1800]], 1000, 1500), 1500)
})
