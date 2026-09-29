export function applyMarkdownCommand(text, start, end, command) {
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length || 0
  if (start < frontmatter) return null
  const selected = text.slice(start, end)
  function replace(from, to, value, selectionStart = 0, selectionEnd = value.length) {
    return { text: text.slice(0, from) + value + text.slice(to), start: from + selectionStart, end: from + selectionEnd }
  }
  const wraps = { bold: ['**', '**', '加粗文字'], italic: ['*', '*', '斜体文字'], strike: ['~~', '~~', '删除线文字'], inlineCode: ['`', '`', '代码'] }
  if (wraps[command]) {
    const [before, after, placeholder] = wraps[command]
    if (text.slice(start - before.length, start) === before && text.slice(end, end + after.length) === after) {
      return replace(start - before.length, end + after.length, selected)
    }
    const content = selected || placeholder
    return replace(start, end, before + content + after, before.length, before.length + content.length)
  }
  const blocks = {
    rule: '\n\n---\n\n',
    code: `\n\n\`\`\`text\n${selected || '在这里写代码'}\n\`\`\`\n\n`,
    table: '\n\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n\n',
    math: `\n\n$$\n${selected || 'E = mc^2'}\n$$\n\n`,
  }
  if (blocks[command]) return replace(start, end, blocks[command])
  if (command === 'link' || command === 'image') {
    const label = selected || (command === 'image' ? '图片说明' : '链接文字')
    const prefix = `${command === 'image' ? '!' : ''}[${label}](<`
    return replace(start, end, `${prefix}https://>)`, prefix.length, prefix.length + 8)
  }
  const from = text.lastIndexOf('\n', Math.max(start - 1, 0)) + 1
  const lineEnd = text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end)
  const to = lineEnd === -1 ? text.length : lineEnd
  const lines = text.slice(from, to).split('\n')
  if (command === 'headingUp' || command === 'headingDown') {
    const value = lines.map((line) => {
      const match = line.match(/^(#{1,6})\s+/)
      const level = match ? match[1].length : 0
      const next = command === 'headingUp' ? Math.max(1, level - 1 || 1) : Math.min(6, level + 1 || 1)
      return '#'.repeat(next) + ' ' + line.replace(/^#{1,6}\s+/, '')
    }).join('\n')
    return replace(from, to, value)
  }
  const prefixes = { quote: '> ', bullet: '- ', ordered: '1. ', task: '- [ ] ' }
  if (prefixes[command]) {
    return replace(from, to, lines.map((line, index) => `${command === 'ordered' ? `${index + 1}. ` : prefixes[command]}${line}`).join('\n'))
  }
  if (command === 'indent') return replace(start, end, '  ', 2, 2)
  return null
}
