import assert from 'node:assert/strict'
import { test } from 'node:test'
import catalog from '../shared/catalog.cjs'

test('importance desc, full publication time asc, and missing importance is zero', () => {
  const posts = [
    { name: 'late.md', date: '2026-09-30 23:30:00' },
    { name: 'high-new.md', priority: 10, date: '2026-09-30T12:00:00+08:00' },
    { name: 'low.md', priority: 1, date: '2025-01-01' },
    { name: 'high-old.md', priority: 10, date: '2026-09-30T03:00:00Z' },
    { name: 'early.md', priority: 0, date: '2026-09-30 08:00:00' },
  ]
  assert.deepEqual(posts.sort(catalog.comparePosts).map(p => p.name), ['high-old.md', 'high-new.md', 'low.md', 'early.md', 'late.md'])
  for (const invalid of [undefined, null, -1, 11, 1.5, '10']) assert.equal(catalog.priority(invalid), 0)
})

test('search includes full article body and categories and treats input as plain text', () => {
  const post = { title: 'Self Attention', body: '开头\n' + '内容'.repeat(1000) + '\n缩放点积', categoryPaths: [['机器学习', '深度学习']] }
  assert.ok(catalog.matchesSearch(post, 'self ATTENTION'))
  assert.ok(catalog.matchesSearch(post, '深度学习 缩放点积'))
  assert.ok(catalog.matchesSearch(post, ''))
  assert.equal(catalog.matchesSearch(post, '<script>'), false)
  assert.equal(catalog.matchesSearch(post, '不存在'), false)
})
