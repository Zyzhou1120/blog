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

test('multiline double-dollar cases render with delimiters attached to formula lines', () => {
  const formula = String.raw`$$\mu(N)=\begin{cases}0&{\exists i,c_i > 1}
\\1&\forall i, c_i=1,m\equiv0\pmod{2}
\\-1&\forall i, c_i=1,m\equiv1\pmod{2}\end{cases}$$`
  for (const input of [formula, '公式如下：\n' + formula, formula.split('\n').map(line => '> ' + line).join('\n')]) {
    const doc = render(input)
    assert.equal(doc.querySelectorAll('.katex-display').length, 1)
    assert.equal(doc.querySelectorAll('.katex-error').length, 0)
    assert.match(doc.querySelector('annotation').textContent, /\\begin\{cases\}/)
  }
  const code = render('```tex\n' + formula + '\n```')
  assert.equal(code.querySelectorAll('.katex').length, 0)
  assert.equal(code.querySelector('code').textContent.trim(), formula)
})
