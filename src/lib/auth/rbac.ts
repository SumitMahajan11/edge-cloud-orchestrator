type Role = 'admin' | 'operator' | 'viewer' | 'service'

type Resource = 
  | 'nodes' 
  | 'tasks' 
  | 'policies' 
  | 'webhooks' 
  | 'users' 
  | 'logs' 
  | 'settings'
  | 'certificates'
  | 'audit'

type Action = 'create' | 'read' | 'update' | 'delete' | 'execute' | 'admin'

interface Permission {
  resource: Resource
  actions: Action[]
}

interface RoleDefinition {
  name: Role
  description: string
  permissions: Permission[]
}

interface UserSession {
  userId: string
  email: string
  role: Role
  permissions: Permission[]
  issuedAt: number
  expiresAt: number
  ipAddress: string
  userAgent: string
  mfaVerified: boolean
}

const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  admin: {
    name: 'admin',
    description: 'Full system access',
    permissions: [
      { resource: 'nodes', actions: ['create', 'read', 'update', 'delete', 'execute', 'admin'] },
      { resource: 'tasks', actions: ['create', 'read', 'update', 'delete', 'execute', 'admin'] },
      { resource: 'policies', actions: ['create', 'read', 'update', 'delete', 'admin'] },
      { resource: 'webhooks', actions: ['create', 'read', 'update', 'delete', 'admin'] },
      { resource: 'users', actions: ['create', 'read', 'update', 'delete', 'admin'] },
      { resource: 'logs', actions: ['read', 'admin'] },
      { resource: 'settings', actions: ['read', 'update', 'admin'] },
      { resource: 'certificates', actions: ['create', 'read', 'update', 'delete', 'admin'] },
      { resource: 'audit', actions: ['read', 'admin'] },
    ]
  },
  operator: {
    name: 'operator',
    description: 'Can manage tasks and nodes, view logs',
    permissions: [
      { resource: 'nodes', actions: ['read', 'update', 'execute'] },
      { resource: 'tasks', actions: ['create', 'read', 'update', 'execute'] },
      { resource: 'policies', actions: ['read'] },
      { resource: 'webhooks', actions: ['read'] },
      { resource: 'users', actions: ['read'] },
      { resource: 'logs', actions: ['read'] },
      { resource: 'settings', actions: ['read'] },
      { resource: 'certificates', actions: ['read'] },
      { resource: 'audit', actions: ['read'] },
    ]
  },
  viewer: {
    name: 'viewer',
    description: 'Read-only access',
    permissions: [
      { resource: 'nodes', actions: ['read'] },
      { resource: 'tasks', actions: ['read'] },
      { resource: 'policies', actions: ['read'] },
      { resource: 'webhooks', actions: ['read'] },
      { resource: 'logs', actions: ['read'] },
      { resource: 'settings', actions: ['read'] },
    ]
  },
  service: {
    name: 'service',
    description: 'Service account for API access',
    permissions: [
      { resource: 'nodes', actions: ['read', 'update'] },
      { resource: 'tasks', actions: ['create', 'read', 'update', 'execute'] },
      { resource: 'logs', actions: ['create', 'read'] },
    ]
  }
}

class RBACManager {
  private sessions: Map<string, UserSession> = new Map()
  private sessionTimeout = 24 * 60 * 60 * 1000 // 24 hours

  createSession(
    userId: string,
    email: string,
    role: Role,
    ipAddress: string,
    userAgent: string,
    mfaVerified: boolean = false
  ): UserSession {
    const session: UserSession = {
      userId,
      email,
      role,
      permissions: ROLE_DEFINITIONS[role].permissions,
      issuedAt: Date.now(),
      expiresAt: Date.now() + this.sessionTimeout,
      ipAddress,
      userAgent,
      mfaVerified,
    }

    this.sessions.set(userId, session)
    return session
  }

  checkPermission(
    session: UserSession,
    resource: Resource,
    action: Action
  ): boolean {
    // Check session expiry
    if (Date.now() > session.expiresAt) {
      return false
    }

    // Find permission for resource
    const permission = session.permissions.find(p => p.resource === resource)
    if (!permission) {
      return false
    }

    // Check if action is allowed
    return permission.actions.includes(action) || permission.actions.includes('admin')
  }

  requirePermission(
    session: UserSession,
    resource: Resource,
    action: Action
  ): void {
    if (!this.checkPermission(session, resource, action)) {
      throw new PermissionDeniedError(
        `User ${session.email} does not have ${action} permission on ${resource}`
      )
    }
  }

  getSession(userId: string): UserSession | undefined {
    const session = this.sessions.get(userId)
    if (!session) return undefined

    // Check if expired
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(userId)
      return undefined
    }

    return session
  }

  invalidateSession(userId: string): boolean {
    return this.sessions.delete(userId)
  }

  invalidateAllSessions(userId: string): number {
    let count = 0
    for (const [key, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(key)
        count++
      }
    }
    return count
  }

  getActiveSessions(): UserSession[] {
    const now = Date.now()
    return Array.from(this.sessions.values()).filter(
      session => session.expiresAt > now
    )
  }

  extendSession(userId: string): boolean {
    const session = this.sessions.get(userId)
    if (!session) return false

    session.expiresAt = Date.now() + this.sessionTimeout
    return true
  }

  getRoleDefinition(role: Role): RoleDefinition {
    return ROLE_DEFINITIONS[role]
  }

  getAllRoles(): RoleDefinition[] {
    return Object.values(ROLE_DEFINITIONS)
  }

  hasRole(session: UserSession, role: Role): boolean {
    return session.role === role
  }

  requireRole(session: UserSession, role: Role): void {
    if (!this.hasRole(session, role)) {
      throw new PermissionDeniedError(
        `User ${session.email} does not have required role: ${role}`
      )
    }
  }

  // Middleware helper for checking permissions
  middleware(resource: Resource, action: Action) {
    return (session: UserSession) => {
      this.requirePermission(session, resource, action)
    }
  }
}

class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermissionDeniedError'
  }
}

// Singleton instance
export const rbacManager = new RBACManager()

export { RBACManager, PermissionDeniedError, ROLE_DEFINITIONS }
export type { Role, Resource, Action, Permission, RoleDefinition, UserSession }
