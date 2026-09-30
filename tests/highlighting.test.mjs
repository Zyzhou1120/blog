import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { highlightMarkdown } from '../editor-src/highlighting.js'

test('source highlighting preserves Markdown, whitespace, math and unsafe HTML as text', () => {
  const source = '# 中文标题\n\n**重点** *说明* [链接](https://example.com)\n- 列表\n\n$x_1$\n$$\ny = x^2\n$$\n\\(a+b\\)\n\\[x\\]\n\n```js\nconst price = "$20"\n```\n<img src=x onerror=alert(1)>\n\t缩进  尾空格  \n'
  const dom = new JSDOM(`<pre>${highlightMarkdown(source)}</pre>`)
  const pre = dom.window.document.querySelector('pre')
  assert.equal(pre.textContent, source)
  assert.equal(pre.querySelector('img'), null)
  for (const token of ['section', 'strong', 'emphasis', 'link', 'bullet', 'code']) {
    assert.ok(pre.querySelector(`.hljs-${token}`), token)
  }
  assert.equal(pre.querySelectorAll('.hljs-formula').length, 4)
  assert.equal(pre.querySelector('.hljs-code .hljs-formula'), null)
  dom.window.close()
})
