import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, APIError, message, setCSRF, SessionExpiredError, sessionExpiredEvent } from './api'
import type { Catalog, Profile } from './types'

const AppContext = createContext<{
  authReady: boolean
  requireLogin: boolean
  catalog: Catalog | null
  profile: Profile | null
  catalogError: string
  catalogLoading: boolean
  refresh: () => Promise<void>
  retryCatalog: () => void
  notify: (text: string) => void
  notice: string
}>({
  authReady: false,
  requireLogin: true,
  catalog: null,
  profile: null,
  catalogError: '',
  catalogLoading: true,
  refresh: async () => {},
  retryCatalog: () => {},
  notify: () => {},
  notice: '',
})
export const useApp = () => useContext(AppContext)

export function AppProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false)
  const [requireLogin, setRequireLogin] = useState(true)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [notice, notify] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const expire = () => {
      setProfile(null)
      setCatalog(null)
      setCatalogError('')
      notify('')
      setRequireLogin(true)
      setAuthReady(true)
    }
    window.addEventListener(sessionExpiredEvent, expire)
    return () => window.removeEventListener(sessionExpiredEvent, expire)
  }, [])
  const refresh = useCallback(async () => {
    try {
      const value = await api<Profile>('api/content/me')
      setCSRF(value.csrf)
      setProfile(value)
    } catch (error) {
      if (
        error instanceof SessionExpiredError ||
        (error instanceof APIError && error.status === 401)
      ) {
        setCSRF('')
        setProfile(null)
      } else throw error
    }
  }, [])
  useEffect(() => {
    Promise.all([
      refresh(),
      api<{ requireLogin: boolean }>('api/auth/info').then((info) =>
        setRequireLogin(info.requireLogin),
      ),
    ])
      .catch((error) => notify(message(error)))
      .finally(() => setAuthReady(true))
  }, [refresh])
  useEffect(() => {
    if (!authReady || (requireLogin && !profile)) {
      setCatalog(null)
      return
    }
    const abort = new AbortController()
    setCatalog(null)
    setCatalogLoading(true)
    setCatalogError('')
    api<Catalog>('api/catalog', { signal: abort.signal })
      .then(setCatalog)
      .catch((error) => {
        if (!abort.signal.aborted && !(error instanceof APIError && error.status === 401))
          setCatalogError(message(error))
      })
      .finally(() => {
        if (!abort.signal.aborted) setCatalogLoading(false)
      })
    return () => abort.abort()
  }, [profile?.userId, attempt, authReady, requireLogin])
  useEffect(() => {
    if (!profile?.userId) return
    const abort = new AbortController()
    api<{ unread: number }>('api/content/inbox', { signal: abort.signal })
      .then((value) =>
        setProfile((previous) =>
          previous ? { ...previous, inboxUnread: value.unread } : previous,
        ),
      )
      .catch((error) => {
        if (!abort.signal.aborted) notify(message(error))
      })
    return () => abort.abort()
  }, [profile?.userId])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => notify(''), 7000)
    return () => clearTimeout(timer)
  }, [notice])
  return (
    <AppContext.Provider
      value={{
        authReady,
        requireLogin,
        catalog,
        profile,
        catalogError,
        catalogLoading,
        refresh,
        retryCatalog: () => setAttempt((value) => value + 1),
        notify,
        notice,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
