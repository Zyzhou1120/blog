function priority(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10 ? value : 0
}
function publicationTime(value) {
  if (!value) return Number.MAX_SAFE_INTEGER
  let text = String(value).trim()
  // Dates without a zone are blog-local time (Asia/Shanghai).
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00+08:00'
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) text = text.replace(' ', 'T') + '+08:00'
  const time = Date.parse(text)
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER
}
function comparePosts(a, b) {
  return priority(b.priority) - priority(a.priority)
    || publicationTime(a.publishedAt || a.date) - publicationTime(b.publishedAt || b.date)
    || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
}
function matchesSearch(post, query) {
  const terms = String(query).normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const text = [post.title, post.body, ...(post.categoryPaths || []).flat()].join(' ').normalize('NFKC').toLocaleLowerCase()
  return terms.every(term => text.includes(term))
}
module.exports = { priority, comparePosts, matchesSearch, publicationTime }
