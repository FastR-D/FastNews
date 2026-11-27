export const base = import.meta.env.BASE_URL.replace(/\/$/, '')
export const asset = (path: string) => `${base}/${path.replace(/^\//, '')}`
let csrf = ''
let sessionExpired = false
let sessionEpoch = 0
export const sessionExpiredEvent = 'fastnews:session-expired'
export function setCSRF(token: string) {
  if (token !== csrf) sessionEpoch++
  csrf = token
  if (token) sessionExpired = false
}
export class SessionExpiredError extends Error {}
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const epoch = sessionEpoch
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (csrf) headers.set('X-CSRF-Token', csrf)
  const response = await fetch(asset(path), { ...init, headers, credentials: 'include' })
  if (
    response.status === 401 &&
    path.replace(/^\//, '').split('?')[0] !== 'api/auth/login' &&
    (csrf || sessionExpired)
  ) {
    if (!sessionExpired && epoch === sessionEpoch) {
      csrf = ''
      sessionExpired = true
      sessionEpoch++
      window.dispatchEvent(new Event(sessionExpiredEvent))
    }
    throw new SessionExpiredError()
  }
  if (sessionExpired && epoch !== sessionEpoch) throw new SessionExpiredError()
  const result = await response.json().catch((error: unknown) => {
    // Cancellation can occur after headers arrive but before JSON has finished.
    // Never turn an aborted success response into a valid-looking domain object.
    if (init.signal?.aborted) throw error
    throw new APIError('服务器返回了无效响应', response.ok ? 502 : response.status)
  })
  if (!response.ok)
    throw new APIError(result.error || `请求失败 (${response.status})`, response.status)
  return result as T
}
export const message = (e: unknown) =>
  e instanceof SessionExpiredError ? '' : e instanceof Error ? e.message : '操作失败，请重试'
export function safeURL(raw?: string) {
  try {
    const u = new URL(raw || '')
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : undefined
  } catch {
    return undefined
  }
}
