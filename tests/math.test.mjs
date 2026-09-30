import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Marked } from 'marked'
import { JSDOM } from 'jsdom'
import mathExtension from '../shared/math.cjs'

const render = (text) => new JSDOM(new Marked(mathExtension()).parse(text)).window.document

test('all four math delimiters work alongside Chinese text and multiline matrices', () => {
  const doc = render(String.raw`中文$x_1$中文，$x_2$（说明）。\(\ell\)层。

$$x^2$$

\[
\begin{bmatrix}a & b\\c & d\end{bmatrix}
\]
`)
  assert.equal(doc.querySelectorAll('.katex').length, 5)
  assert.equal(doc.querySelectorAll('.katex-display').length, 2)
  assert.equal(doc.querySelectorAll('.katex-error').length, 0)
})

test('code examples and escaped dollar signs stay literal', () => {
  const doc = render('`\\(x\\)` 和 `$y$`\n\n```tex\n\\[z\\]\n$x$\n```\n\n价格 \\$5，另一项 \\$10。')
  assert.equal(doc.querySelectorAll('.katex').length, 0)
  assert.match(doc.querySelector('pre').textContent, /\\\[z\\\]/)
  assert.match(doc.body.textContent, /价格 \$5，另一项 \$10/)
})
