const KEY = 'blog-editor:token'
const PREFERENCE = 'blog-editor:remember-session'

function read(storage) { try { return storage.getItem(KEY) || '' } catch { return '' } }
function write(storage, value) { try { value ? storage.setItem(KEY, value) : storage.removeItem(KEY) } catch { /* Private browsers may disable storage. */ } }

export function readSession() {
  return read(sessionStorage) || read(localStorage)
}

export function rememberSession(token, remember) {
  write(sessionStorage, token)
  write(localStorage, remember ? token : '')
  try { localStorage.setItem(PREFERENCE, String(remember)) } catch { /* Optional preference. */ }
}

export function shouldRememberSession() {
  try { return localStorage.getItem(PREFERENCE) !== 'false' } catch { return true }
}

export function clearSession() {
  write(sessionStorage, '')
  write(localStorage, '')
}
