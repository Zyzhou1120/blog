import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
const script = (await build({ stdin: { contents: "import { setupFullscreen } from './editor-src/fullscreen.js'; setupFullscreen({showMessage: message => document.getElementById('message').textContent = message})", resolveDir: process.cwd() }, bundle: true, format: 'iife', write: false })).outputFiles[0].text
function fixture(native = true) {
  const dom = new JSDOM('<button id="focus-mode" aria-pressed="false"></button><div id="message"></div><textarea>未提交的正文</textarea>', { runScripts: 'outside-only' })
  const { window } = dom
  const doc = window.document
  let requests = 0
  if (native) {
    doc.documentElement.requestFullscreen = async () => { requests++; doc.fullscreenElement = doc.documentElement; doc.dispatchEvent(new window.Event('fullscreenchange')) }
    doc.exitFullscreen = async () => { doc.fullscreenElement = null; doc.dispatchEvent(new window.Event('fullscreenchange')) }
  }
  window.eval(script)
  return { window, doc, button: doc.getElementById('focus-mode'), requests: () => requests, close: () => window.close() }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
test('fullscreen requests the browser screen and restores the layout on browser exit', async () => {
  const f = fixture()
  try {
    f.button.click(); await tick()
    assert.equal(f.requests(), 1)
    assert.equal(f.doc.fullscreenElement, f.doc.documentElement)
    assert.equal(f.doc.body.classList.contains('focus-mode'), true)
    assert.equal(f.button.getAttribute('aria-label'), '退出全屏')
    await f.doc.exitFullscreen()
    assert.equal(f.doc.body.classList.contains('focus-mode'), false)
    assert.equal(f.button.getAttribute('aria-pressed'), 'false')
    f.button.click(); await tick()
    f.button.click(); await tick()
    assert.equal(f.doc.fullscreenElement, null)
    assert.equal(f.doc.querySelector('textarea').value, '未提交的正文')
  } finally { f.close() }
})
test('unsupported and rejected fullscreen requests still fill the page and Escape restores it', async () => {
  for (const rejected of [false, true]) {
    const f = fixture(false)
    try {
      if (rejected) f.doc.documentElement.requestFullscreen = async () => { throw new Error('Not allowed') }
      f.button.click(); await tick()
      assert.equal(f.doc.body.classList.contains('focus-mode'), true)
      assert.match(f.doc.getElementById('message').textContent, /整个页面/)
      f.doc.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape' })); await tick()
      assert.equal(f.doc.body.classList.contains('focus-mode'), false)
      assert.equal(f.button.getAttribute('aria-label'), '全屏编辑')
    } finally { f.close() }
  }
})
