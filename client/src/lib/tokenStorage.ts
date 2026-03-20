/**
 * Safe token storage that works in both browser (localStorage) and
 * Tauri's strict webview context (falls back to in-memory).
 *
 * In Tauri, localStorage may be blocked by the strict CSP/security context.
 * We try localStorage first, and if it throws, use a module-scoped Map.
 */

const TOKEN_KEY = 'mingle-token'

// In-memory fallback (process lifetime only — good enough for Tauri)
let _memToken: string | null = null

function safeLocalStorage(): Storage | null {
  try {
    // This throws in Tauri's strict webview context
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('__test__', '1')
      window.localStorage.removeItem('__test__')
      return window.localStorage
    }
  } catch {
    // Blocked — fall through to in-memory
  }
  return null
}

export function getToken(): string | null {
  const ls = safeLocalStorage()
  if (ls) return ls.getItem(TOKEN_KEY)
  return _memToken
}

export function setToken(token: string): void {
  const ls = safeLocalStorage()
  if (ls) {
    ls.setItem(TOKEN_KEY, token)
  } else {
    _memToken = token
  }
}

export function removeToken(): void {
  const ls = safeLocalStorage()
  if (ls) {
    ls.removeItem(TOKEN_KEY)
  } else {
    _memToken = null
  }
}
