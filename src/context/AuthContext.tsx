import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { User } from '../types'
import { authApi, authStorage } from '../lib/api-simple'
import { Login } from '../pages/Login'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  register: (email: string, password: string, name: string) => Promise<boolean>
  hasPermission: (permission: string) => boolean
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['*'],
  OPERATOR: [
    'nodes:read', 'nodes:create', 'nodes:update',
    'tasks:read', 'tasks:create', 'tasks:update',
    'logs:read', 'monitoring:read',
    'policies:read', 'policies:update', 'webhooks:read',
  ],
  VIEWER: [
    'nodes:read', 'tasks:read', 'logs:read',
    'monitoring:read', 'policies:read',
  ],
}

function mapUserRole(role: string): 'admin' | 'operator' | 'viewer' {
  const roleMap: Record<string, 'admin' | 'operator' | 'viewer'> = {
    ADMIN: 'admin', OPERATOR: 'operator', VIEWER: 'viewer',
  }
  return roleMap[role] || 'viewer'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const storedUser = authStorage.getUser()
    const token = authStorage.getToken()

    if (storedUser && token) {
      authApi.getMe()
        .then(response => {
          if (response.data) {
            const apiUser = response.data as unknown as { id: string; email: string; name: string; role: string; createdAt: string; lastLoginAt?: string }
            const mappedUser: User = {
              id: apiUser.id, email: apiUser.email, name: apiUser.name,
              role: mapUserRole(apiUser.role),
              createdAt: new Date(apiUser.createdAt),
              lastLoginAt: apiUser.lastLoginAt ? new Date(apiUser.lastLoginAt) : undefined,
            }
            setUser(mappedUser)
            authStorage.setUser(mappedUser as unknown as import('../lib/api-simple').User)
          } else {
            authStorage.clear()
          }
        })
        .catch(() => authStorage.clear())
        .finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await authApi.login(email, password)
      if (response.error) {
        setError(response.error)
        return false
      }
      if (response.data) {
        const apiUser = response.data.user as unknown as { id: string; email: string; name: string; role: string; createdAt: string; lastLoginAt?: string }
        const mappedUser: User = {
          id: apiUser.id, email: apiUser.email, name: apiUser.name,
          role: mapUserRole(apiUser.role),
          createdAt: new Date(apiUser.createdAt),
          lastLoginAt: apiUser.lastLoginAt ? new Date(apiUser.lastLoginAt) : undefined,
        }
        setUser(mappedUser)
        return true
      }
      return false
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const register = useCallback(async (email: string, password: string, name: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await authApi.register(email, password, name)
      if (response.error) {
        setError(response.error)
        return false
      }
      return login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [login])

  const logout = useCallback(async () => {
    try { await authApi.logout() } catch {}
    setUser(null)
    authStorage.clear()
  }, [])

  const hasPermission = useCallback((permission: string): boolean => {
    if (!user) return false
    const permissions = ROLE_PERMISSIONS[user.role.toUpperCase()] || []
    return permissions.includes('*') || permissions.includes(permission)
  }, [user])

  const clearError = useCallback(() => setError(null), [])

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, error, login, logout, register, hasPermission, clearError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { isAuthenticated, isLoading, hasPermission } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!isAuthenticated) return <Login />

  if (permission && !hasPermission(permission)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
