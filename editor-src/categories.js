// Hexo treats a flat list as one hierarchy and nested lists as separate paths.
export function categoryPaths(value) {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  const paths = values.some(Array.isArray) ? values.map((v) => Array.isArray(v) ? v : [v]) : [values]
  return paths.map((path) => path.filter((v) => v != null && String(v).trim()).map(String)).filter((path) => path.length)
}

export function categoryUrl(path, root) {
  const url = new URL('categories/', root)
  path.forEach((name) => url.searchParams.append('category', name))
  return url.href
}

export function inCategory(post, path) {
  return post.categoryPaths.some((candidate) => path.every((name, i) => candidate[i] === name))
}

export function renderCategories(posts, root, element) {
  const tree = new Map()
  const all = new Set()
  for (const post of posts) for (const path of post.categoryPaths) {
    let level = tree
    path.forEach((name, i) => {
      if (!level.has(name)) level.set(name, { path: path.slice(0, i + 1), posts: new Set(), children: new Map() })
      const node = level.get(name)
      node.posts.add(post.name)
      all.add(JSON.stringify(node.path))
      level = node.children
    })
  }
  function list(nodes, sidebar) {
    const prefix = sidebar ? 'card-category-list' : 'category-list'
    const ul = element('ul', prefix)
    for (const [name, node] of nodes) {
      const li = element('li', `${prefix}-item`)
      const a = element('a', `${prefix}-link`)
      a.href = categoryUrl(node.path, root)
      a.append(element('span', `${prefix}-name`, name))
      const count = element('span', `${prefix}-count`, String(node.posts.size))
      if (sidebar) a.append(count)
      li.append(a)
      if (!sidebar) li.append(count)
      if (node.children.size) li.append(list(node.children, sidebar))
      ul.append(li)
    }
    return ul
  }
  const sidebar = document.getElementById('aside-cat-list')
  if (sidebar) sidebar.replaceChildren(...list(tree, true).childNodes)
  for (const a of document.querySelectorAll('.site-data a')) {
    if (new URL(a.href).pathname === new URL('categories/', root).pathname) {
      const count = a.querySelector('.length-num')
      if (count) count.textContent = String(all.size)
    }
  }
  const index = document.querySelector('.category-lists')
  if (index) index.replaceChildren(list(tree, false))
}
