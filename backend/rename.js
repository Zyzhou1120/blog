import { splitPost, joinPost, filenameForTitle } from '../shared/post.mjs'

const fail = (message, status = 409) => Object.assign(new Error(message), { status })
const decode = (file) => new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)))
export const aliasPath = 'post-aliases.json'

export async function readAliases(env, token, github, ref = env.BRANCH) {
  try {
    const file = await github(env, token, `/repos/${env.OWNER}/${env.REPO}/contents/${aliasPath}?ref=${encodeURIComponent(ref)}`)
    const aliases = JSON.parse(decode(file))
    if (!aliases || Array.isArray(aliases) || typeof aliases !== 'object') throw new Error('Invalid aliases')
    return aliases
  } catch (error) { if (error.status === 404) return {}; throw error }
}

// One Git commit moves the file and records old links. Ref updates reject concurrent writes.
export async function publishWithTitle(env, token, github, name, data) {
  const root = `/repos/${env.OWNER}/${env.REPO}`
  const call = (path, body, method = 'POST') => github(env, token, root + path, body ? { method, body: JSON.stringify(body) } : {})
  const head = (await call(`/git/ref/heads/${env.BRANCH}`)).object.sha
  const aliases = await readAliases(env, token, github, head)
  const next = splitPost(data.text)
  const target = filenameForTitle(next.meta.title)
  const read = async (file) => {
    try { return await call(`/contents/source/_posts/${encodeURIComponent(file)}?ref=${head}`) }
    catch (error) { if (error.status === 404) return null; throw error }
  }
  const remote = await read(name)
  const destination = name === target ? remote : await read(target)
  // Preserve the original static URL through all subsequent title changes.
  const original = remote ? splitPost(decode(remote)) : null
  if (original?.meta.permalink) next.meta.permalink = original.meta.permalink
  else if (remote && name !== target && !next.meta.permalink) {
    const date = String(original.meta.date || next.meta.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (date) next.meta.permalink = `${date[1]}/${date[2]}/${date[3]}/${name.slice(0, -3)}/`
  }
  // A retry can arrive after the Git commit succeeded but before the database was updated.
  if (!remote && aliases[name] === target && destination) {
    const saved = splitPost(decode(destination))
    if (saved.meta.permalink) next.meta.permalink = saved.meta.permalink
    const text = joinPost(next)
    if (decode(destination) === text) return { name: target, sha: destination.sha, text, aliases }
    throw fail('文章已改名或更新，请刷新文章列表后重新载入。')
  }
  const text = joinPost(next)
  if (!remote && data.sha === null && destination && !aliases[name] && decode(destination) === text) return { name: target, sha: destination.sha, text, aliases }
  if (aliases[target] && aliases[target] !== name) throw fail('这个标题已用作其他文章的历史链接，请换一个标题。', 400)
  if (name === target && remote && decode(remote) === text) return { name: target, sha: remote.sha, text, aliases }
  if ((remote?.sha || null) !== data.sha) throw fail('GitHub 上已有新修改，请刷新文章列表后重新载入。')
  if (name !== target && (destination || (aliases[target] && aliases[target] !== name))) throw fail('已有同名文章或历史链接，请换一个标题后发布。', 400)
  if (remote && name !== target) {
    for (const old of Object.keys(aliases)) if (aliases[old] === name) aliases[old] = target
    delete aliases[target]
    aliases[name] = target
  }
  const commit = await call(`/git/commits/${head}`)
  const blob = await call('/git/blobs', { content: text, encoding: 'utf-8' })
  const tree = [
    { path: `source/_posts/${target}`, mode: '100644', type: 'blob', sha: blob.sha },
  ]
  if (remote && name !== target) tree.push({ path: `source/_posts/${name}`, mode: '100644', type: 'blob', sha: null })
  if (remote && name !== target) tree.push({ path: aliasPath, mode: '100644', type: 'blob', content: JSON.stringify(aliases, null, 2) + '\n' })
  const resultTree = await call('/git/trees', { base_tree: commit.tree.sha, tree })
  const resultCommit = await call('/git/commits', { message: `${remote ? 'Publish' : 'Add'} post: ${target}`, tree: resultTree.sha, parents: [head] })
  await call(`/git/refs/heads/${env.BRANCH}`, { sha: resultCommit.sha, force: false }, 'PATCH')
  return { name: target, sha: blob.sha, text, aliases }
}

export async function deletePublishedPost(env, token, github, name, sha) {
  const root = `/repos/${env.OWNER}/${env.REPO}`
  const call = (path, body, method = 'POST') => github(env, token, root + path, body ? { method, body: JSON.stringify(body) } : {})
  const head = (await call(`/git/ref/heads/${env.BRANCH}`)).object.sha
  const aliases = await readAliases(env, token, github, head)
  let remote = null
  try { remote = await call(`/contents/source/_posts/${encodeURIComponent(name)}?ref=${head}`) }
  catch (error) { if (error.status !== 404) throw error }
  if (remote && remote.sha !== sha) throw fail('GitHub 上已有新修改，请重新载入文章后再删除。')
  const nextAliases = Object.fromEntries(Object.entries(aliases).filter(([old, target]) => old !== name && target !== name))
  if (!remote && Object.keys(nextAliases).length === Object.keys(aliases).length) return nextAliases
  const commit = await call(`/git/commits/${head}`)
  const tree = []
  if (remote) tree.push({ path: `source/_posts/${name}`, mode: '100644', type: 'blob', sha: null })
  if (Object.keys(nextAliases).length !== Object.keys(aliases).length) {
    tree.push({ path: aliasPath, mode: '100644', type: 'blob', content: JSON.stringify(nextAliases, null, 2) + '\n' })
  }
  const resultTree = await call('/git/trees', { base_tree: commit.tree.sha, tree })
  const resultCommit = await call('/git/commits', { message: `Delete post: ${name}`, tree: resultTree.sha, parents: [head] })
  await call(`/git/refs/heads/${env.BRANCH}`, { sha: resultCommit.sha, force: false }, 'PATCH')
  return nextAliases
}
