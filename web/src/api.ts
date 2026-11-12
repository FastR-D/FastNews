export const base = import.meta.env.BASE_URL.replace(/\/$/, '')
export const asset = (path: string) => `${base}/${path.replace(/^\//, '')}`
let csrf = ''
export function setCSRF(token: string) {
  csrf = token
}
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (csrf) headers.set('X-CSRF-Token', csrf)
  const response = await fetch(asset(path), { ...init, headers, credentials: 'include' })
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
export const message = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试')
export function safeURL(raw?: string) {
  try {
    const u = new URL(raw || '')
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : undefined
  } catch {
    return undefined
  }
}
