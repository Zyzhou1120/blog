import config from '../realtime.config.json'

export const liveEndpoint = config.endpoint.replace(/\/$/, '')

export async function liveRequest(path, options = {}, token = '') {
  const response = await fetch(`${liveEndpoint}${path}`, {
    cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30000), ...options,
    headers: { ...(options.method && options.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.message || '实时服务暂时不可用'), { status: response.status })
  return data
}

export function liveUrl(name, root) {
  const url = new URL('read/', root)
  url.searchParams.set('post', name)
  return url
}
