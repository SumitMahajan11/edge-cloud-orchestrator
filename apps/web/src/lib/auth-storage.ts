import type { User } from '../types'

const TOKEN_KEY = 'auth_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const USER_KEY = 'user_data'

const isBrowser = typeof window !== 'undefined'

export const authStorage = {
  getToken: (): string | null => isBrowser ? localStorage.getItem(TOKEN_KEY) : null,
  setToken: (token: string) => isBrowser && localStorage.setItem(TOKEN_KEY, token),
  getRefreshToken: (): string | null => isBrowser ? localStorage.getItem(REFRESH_TOKEN_KEY) : null,
  setRefreshToken: (token: string) => isBrowser && localStorage.setItem(REFRESH_TOKEN_KEY, token),
  getUser: (): User | null => {
    if (!isBrowser) return null
    const user = localStorage.getItem(USER_KEY)
    return user ? JSON.parse(user) : null
  },
  setUser: (user: User) => isBrowser && localStorage.setItem(USER_KEY, JSON.stringify(user)),
  clear: () => {
    if (isBrowser) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
  },
}
