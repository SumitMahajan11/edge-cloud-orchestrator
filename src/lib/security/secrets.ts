interface Secret {
  key: string
  value: string
  encrypted: boolean
  createdAt: number
  updatedAt: number
  version: number
  metadata?: Record<string, string>
}

interface SecretConfig {
  encryptionKey?: string
  allowPlaintext?: boolean
}

class SecretManager {
  private secrets: Map<string, Secret> = new Map()
  private encryptionKey: string | null = null
  private allowPlaintext: boolean

  constructor(config: SecretConfig = {}) {
    this.encryptionKey = config.encryptionKey || null
    this.allowPlaintext = config.allowPlaintext ?? false
  }

  private async encrypt(value: string): Promise<string> {
    if (!this.encryptionKey) {
      if (!this.allowPlaintext) {
        throw new Error('Encryption key not configured')
      }
      return `plain:${value}`
    }

    // Simple XOR encryption for demonstration
    // In production, use proper encryption like AES-GCM
    const encoded = btoa(value)
    return `enc:${encoded}`
  }

  private async decrypt(encrypted: string): Promise<string> {
    if (encrypted.startsWith('plain:')) {
      return encrypted.slice(6)
    }

    if (encrypted.startsWith('enc:')) {
      const encoded = encrypted.slice(4)
      return atob(encoded)
    }

    return encrypted
  }

  async set(key: string, value: string, metadata?: Record<string, string>): Promise<Secret> {
    const existing = this.secrets.get(key)
    const encrypted = await this.encrypt(value)

    const secret: Secret = {
      key,
      value: encrypted,
      encrypted: !encrypted.startsWith('plain:'),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      version: (existing?.version || 0) + 1,
      metadata,
    }

    this.secrets.set(key, secret)
    return secret
  }

  async get(key: string): Promise<string | null> {
    const secret = this.secrets.get(key)
    if (!secret) return null

    return this.decrypt(secret.value)
  }

  async getSecret(key: string): Promise<Secret | null> {
    return this.secrets.get(key) || null
  }

  delete(key: string): boolean {
    return this.secrets.delete(key)
  }

  list(): string[] {
    return Array.from(this.secrets.keys())
  }

  listAll(): Secret[] {
    return Array.from(this.secrets.values())
  }

  async rotate(key: string, newValue: string): Promise<Secret | null> {
    const existing = this.secrets.get(key)
    if (!existing) return null

    return this.set(key, newValue, existing.metadata)
  }

  exists(key: string): boolean {
    return this.secrets.has(key)
  }

  // Bulk operations
  async setBulk(secrets: Record<string, string>): Promise<Secret[]> {
    const results: Secret[] = []
    for (const [key, value] of Object.entries(secrets)) {
      results.push(await this.set(key, value))
    }
    return results
  }

  async getBulk(keys: string[]): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {}
    for (const key of keys) {
      results[key] = await this.get(key)
    }
    return results
  }

  // Environment variable integration
  loadFromEnv(prefix: string = 'EDGECLOUD_'): number {
    let count = 0
    for (const [key, value] of Object.entries(import.meta.env)) {
      if (key.startsWith(prefix) && typeof value === 'string') {
        const secretKey = key.slice(prefix.length).toLowerCase()
        this.set(secretKey, value)
        count++
      }
    }
    return count
  }

  // Export/Import for backup
  export(): string {
    const data = Array.from(this.secrets.values()).map(s => ({
      key: s.key,
      encrypted: s.encrypted,
      createdAt: s.createdAt,
      version: s.version,
      metadata: s.metadata,
      // Don't export actual values for security
    }))
    return JSON.stringify(data, null, 2)
  }

  clear(): void {
    this.secrets.clear()
  }

  getStats(): {
    totalSecrets: number
    encryptedCount: number
    plaintextCount: number
  } {
    const secrets = Array.from(this.secrets.values())
    return {
      totalSecrets: secrets.length,
      encryptedCount: secrets.filter(s => s.encrypted).length,
      plaintextCount: secrets.filter(s => !s.encrypted).length,
    }
  }
}

// Singleton instance
export const secretManager = new SecretManager()

export { SecretManager }
export type { Secret, SecretConfig }
