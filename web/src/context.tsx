import { createContext, useContext } from 'react'
import type { Catalog, Profile } from './types'
export const AppContext = createContext<{
  catalog: Catalog | null
  profile: Profile | null
  refresh: () => Promise<void>
  notify: (text: string) => void
}>({ catalog: null, profile: null, refresh: async () => {}, notify: () => {} })
export const useApp = () => useContext(AppContext)
