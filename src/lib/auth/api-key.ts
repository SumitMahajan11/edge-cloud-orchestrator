// crypto polyfill for browser environment
const crypto = {
  randomUUID: (): string => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  randomBytes: (_size: number): { toString: (enc?: string) => string } => ({
    toString: (enc?: string) => {
      if (enc === 'base64') {
        return btoa(Math.random().toString(36).repeat(5))
      }
      return Math.random().toString(36).repeat(5)
    }
  }),
  createHash: (_algo: string): { update: (data: string) => { digest: (enc?: string) => string } } => ({
    update: (data: string) => ({
      digest: (enc?: string) => {
        // Simple hash for demo - use proper hash in production
        let hash = 0
        for (let i = 0; i < data.length; i++) {
          const char = data.charCodeAt(i)
          hash = ((hash << 5) - hash) + char
          hash = hash & hash
        }
        const hex = Math.abs(hash).toString(16).padStart(64, '0')
        return enc === 'hex' ? hex : hex
      }
    })
  })
}

interface ApiKey {
  id: string
  key: string
  name: string
  permissions: string[]
  createdAt: number
  expiresAt?: number
  lastUsedAt?: number
  usageCount: number
  enabled: boolean
}

interface ApiKeyConfig {
  keyPrefix?: string
  keyLength?: number
  defaultExpiryDays?: number
}

class ApiKeyManager {
  private keys: Map<string, ApiKey> = new Map()
  private keyIndex: Map<string, string> = new Map() // key hash -> key id
  private config: Required<ApiKeyConfig>

  constructor(config: ApiKeyConfig = {}) {
    this.config = {
      keyPrefix: 'ec_',
      keyLength: 32,
      defaultExpiryDays: 365,
      ...config,
    }
  }

  generateKey(name: string, permissions: string[] = ['read'], expiryDays?: number): { key: string; apiKey: ApiKey } {
    const id = crypto.randomUUID()
    const keyBytes = crypto.randomBytes(this.config.keyLength)
    const key = `${this.config.keyPrefix}${keyBytes.toString('base64').replace(/[+/=]/g, '').substring(0, this.config.keyLength)}`

    const now = Date.now()
    const expiresAt = expiryDays !== undefined
      ? now + expiryDays * 24 * 60 * 60 * 1000
      : this.config.defaultExpiryDays > 0
        ? now + this.config.defaultExpiryDays * 24 * 60 * 60 * 1000
        : undefined

    const apiKey: ApiKey = {
      id,
      key: this.hashKey(key),
      name,
      permissions,
      createdAt: now,
      expiresAt,
      usageCount: 0,
      enabled: true,
    }

    this.keys.set(id, apiKey)
    this.keyIndex.set(apiKey.key, id)

    return { key, apiKey }
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex')
  }

  validateKey(key: string): { valid: boolean; apiKey?: ApiKey; error?: string } {
    const hashedKey = this.hashKey(key)
    const keyId = this.keyIndex.get(hashedKey)

    if (!keyId) {
      return { valid: false, error: 'Invalid API key' }
    }

    const apiKey = this.keys.get(keyId)
    if (!apiKey) {
      return { valid: false, error: 'API key not found' }
    }

    if (!apiKey.enabled) {
      return { valid: false, error: 'API key is disabled' }
    }

    if (apiKey.expiresAt && Date.now() > apiKey.expiresAt) {
      return { valid: false, error: 'API key has expired' }
    }

    // Update usage stats
    apiKey.lastUsedAt = Date.now()
    apiKey.usageCount++

    return { valid: true, apiKey }
  }

  hasPermission(apiKey: ApiKey, permission: string): boolean {
    return apiKey.permissions.includes(permission) || apiKey.permissions.includes('admin')
  }

  revokeKey(id: string): boolean {
    const apiKey = this.keys.get(id)
    if (!apiKey) return false

    apiKey.enabled = false
    this.keyIndex.delete(apiKey.key)
    return true
  }

  deleteKey(id: string): boolean {
    const apiKey = this.keys.get(id)
    if (!apiKey) return false

    this.keyIndex.delete(apiKey.key)
    return this.keys.delete(id)
  }

  getKey(id: string): ApiKey | undefined {
    return this.keys.get(id)
  }

  listKeys(): ApiKey[] {
    return Array.from(this.keys.values())
  }

  rotateKey(id: string): { key: string; apiKey: ApiKey } | null {
    const oldKey = this.keys.get(id)
    if (!oldKey) return null

    // Generate new key with same permissions
    const result = this.generateKey(oldKey.name, oldKey.permissions)

    // Disable old key
    this.revokeKey(id)

    return result
  }

  getStats(): {
    total: number
    active: number
    revoked: number
    expired: number
  } {
    const now = Date.now()
    let active = 0
    let revoked = 0
    let expired = 0

    for (const key of this.keys.values()) {
      if (!key.enabled) {
        revoked++
      } else if (key.expiresAt && now > key.expiresAt) {
        expired++
      } else {
        active++
      }
    }

    return {
      total: this.keys.size,
      active,
      revoked,
      expired,
    }
  }
}

// Middleware for API key authentication
function apiKeyAuthMiddleware(keyManager: ApiKeyManager, requiredPermission?: string) {
  return async (req: Request): Promise<Response | null> => {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const [scheme, key] = authHeader.split(' ')

    if (scheme !== 'Bearer' || !key) {
      return new Response(JSON.stringify({ error: 'Invalid Authorization format. Use: Bearer <api-key>' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const validation = keyManager.validateKey(key)

    if (!validation.valid) {
      return new Response(JSON.stringify({ error: validation.error }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (requiredPermission && !keyManager.hasPermission(validation.apiKey!, requiredPermission)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Attach API key info to request for downstream use
    ;(req as unknown as Record<string, unknown>).apiKey = validation.apiKey

    return null // Continue to next handler
  }
}

// Singleton instance
export const apiKeyManager = new ApiKeyManager()

export { ApiKeyManager, apiKeyAuthMiddleware }
export type { ApiKey, ApiKeyConfig }
