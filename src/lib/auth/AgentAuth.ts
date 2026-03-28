/**
 * Edge Agent Authentication Module
 * Implements mTLS, JWT tokens, and API key authentication
 */

import { logger } from '../logger'

// Types
export interface AgentCredentials {
  agentId: string
  apiKey: string
  publicKey?: string
  certificate?: string
}

export interface JWTClaims {
  sub: string        // Agent ID
  iss: string        // Issuer (orchestrator)
  aud: string        // Audience (edge-agent)
  exp: number        // Expiration timestamp
  iat: number        // Issued at timestamp
  jti: string        // JWT ID
  permissions: string[]
  nodeId: string
  location: string
}

export interface AuthResult {
  authenticated: boolean
  agentId?: string
  permissions?: string[]
  error?: string
  token?: string
  expiresAt?: number
}

export interface ApiKeyRecord {
  id: string
  agentId: string
  keyHash: string
  prefix: string
  permissions: string[]
  createdAt: Date
  lastUsed: Date
  expiresAt?: Date
  rateLimit: number
  enabled: boolean
}

export interface MTLSConfig {
  caCertificate: string
  verifyClient: boolean
  verifyDepth: number
  allowExpired: boolean
}

// AuthMethod types for documentation
// type AuthMethod = 'api-key' | 'jwt' | 'mtls' | 'hmac'

const API_KEY_PREFIX = 'ec_'
const JWT_ISSUER = 'edge-cloud-orchestrator'
const JWT_AUDIENCE = 'edge-agent'
const JWT_EXPIRY = 3600 // 1 hour
const HMAC_ALGORITHM = 'SHA-256'

/**
 * Authentication Manager for Edge Agents
 */
export class AgentAuthManager {
  private apiKeys: Map<string, ApiKeyRecord> = new Map()
  private jwtSecret: string
  private mtlsConfig: MTLSConfig
  private revokedTokens: Set<string> = new Set()
  private nonceCache: Map<string, number> = new Map()

  constructor(config?: { jwtSecret?: string; mtlsConfig?: Partial<MTLSConfig> }) {
    this.jwtSecret = config?.jwtSecret || this.generateSecret()
    this.mtlsConfig = {
      caCertificate: '',
      verifyClient: true,
      verifyDepth: 2,
      allowExpired: false,
      ...config?.mtlsConfig,
    }

    // Start cleanup interval
    this.startCleanup()
  }

  /**
   * Generate API Key for an agent
   */
  generateApiKey(agentId: string, permissions: string[] = ['task:execute', 'metrics:report']): { id: string; key: string } {
    const id = `key-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const keyBytes = new Uint8Array(32)
    crypto.getRandomValues(keyBytes)
    const key = `${API_KEY_PREFIX}${this.base64Encode(keyBytes)}`
    
    const record: ApiKeyRecord = {
      id,
      agentId,
      keyHash: this.hashKey(key),
      prefix: key.substring(0, 10),
      permissions,
      createdAt: new Date(),
      lastUsed: new Date(),
      rateLimit: 100, // requests per minute
      enabled: true,
    }

    this.apiKeys.set(id, record)
    logger.info('API key generated', { agentId, keyId: id, permissions })

    return { id, key }
  }

  /**
   * Validate API Key
   */
  async validateApiKey(authHeader: string): Promise<AuthResult> {
    if (!authHeader.startsWith('Bearer ')) {
      return { authenticated: false, error: 'Invalid authorization header format' }
    }

    const key = authHeader.substring(7)
    
    if (!key.startsWith(API_KEY_PREFIX)) {
      return { authenticated: false, error: 'Invalid API key format' }
    }

    const keyHash = this.hashKey(key)
    
    for (const [, record] of this.apiKeys) {
      if (record.keyHash === keyHash) {
        if (!record.enabled) {
          return { authenticated: false, error: 'API key is disabled' }
        }

        if (record.expiresAt && record.expiresAt < new Date()) {
          return { authenticated: false, error: 'API key has expired' }
        }

        // Update last used
        record.lastUsed = new Date()

        return {
          authenticated: true,
          agentId: record.agentId,
          permissions: record.permissions,
        }
      }
    }

    return { authenticated: false, error: 'Invalid API key' }
  }

  /**
   * Generate JWT Token for an agent
   */
  async generateJWT(agentId: string, nodeId: string, location: string, permissions: string[]): Promise<{ token: string; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000)
    const jti = `${agentId}-${now}-${Math.random().toString(36).substr(2, 9)}`

    const claims: JWTClaims = {
      sub: agentId,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      exp: now + JWT_EXPIRY,
      iat: now,
      jti,
      permissions,
      nodeId,
      location,
    }

    const token = await this.signJWT(claims)

    return {
      token,
      expiresAt: claims.exp * 1000,
    }
  }

  /**
   * Validate JWT Token
   */
  async validateJWT(authHeader: string): Promise<AuthResult> {
    if (!authHeader.startsWith('Bearer ')) {
      return { authenticated: false, error: 'Invalid authorization header format' }
    }

    const token = authHeader.substring(7)

    // Check if revoked
    if (this.revokedTokens.has(token)) {
      return { authenticated: false, error: 'Token has been revoked' }
    }

    try {
      const claims = await this.verifyJWT(token)

      if (claims.exp < Date.now() / 1000) {
        return { authenticated: false, error: 'Token has expired' }
      }

      if (claims.iss !== JWT_ISSUER) {
        return { authenticated: false, error: 'Invalid token issuer' }
      }

      if (claims.aud !== JWT_AUDIENCE) {
        return { authenticated: false, error: 'Invalid token audience' }
      }

      return {
        authenticated: true,
        agentId: claims.sub,
        permissions: claims.permissions,
        token,
        expiresAt: claims.exp * 1000,
      }
    } catch (error) {
      return { authenticated: false, error: `Token verification failed: ${(error as Error).message}` }
    }
  }

  /**
   * Validate HMAC Signature (for webhook-style auth)
   */
  async validateHMAC(
    signature: string,
    timestamp: string,
    nonce: string,
    body: string,
    agentId: string
  ): Promise<AuthResult> {
    // Check timestamp (prevent replay attacks)
    const ts = parseInt(timestamp, 10)
    const now = Date.now()
    const maxDrift = 300000 // 5 minutes

    if (isNaN(ts) || Math.abs(now - ts) > maxDrift) {
      return { authenticated: false, error: 'Timestamp drift too large' }
    }

    // Check nonce (prevent replay)
    if (this.nonceCache.has(nonce)) {
      return { authenticated: false, error: 'Nonce already used' }
    }

    this.nonceCache.set(nonce, ts)

    // Find agent's API key
    let apiKey: ApiKeyRecord | null = null
    for (const record of this.apiKeys.values()) {
      if (record.agentId === agentId) {
        apiKey = record
        break
      }
    }

    if (!apiKey) {
      return { authenticated: false, error: 'Agent not found' }
    }

    // Verify signature
    const expectedSignature = await this.generateHMACSignature(
      `${timestamp}.${nonce}.${body}`,
      apiKey.keyHash
    )

    if (signature !== expectedSignature) {
      return { authenticated: false, error: 'Invalid HMAC signature' }
    }

    return {
      authenticated: true,
      agentId,
      permissions: apiKey.permissions,
    }
  }

  /**
   * Validate mTLS Certificate
   */
  validateMTLS(certificate: string, expectedAgentId: string): AuthResult {
    if (!this.mtlsConfig.verifyClient) {
      return { authenticated: true, agentId: expectedAgentId }
    }

    try {
      // Parse certificate (simplified - in production use proper X.509 parsing)
      const certInfo = this.parseCertificate(certificate)

      if (!certInfo) {
        return { authenticated: false, error: 'Invalid certificate format' }
      }

      // Check expiration
      if (!this.mtlsConfig.allowExpired && certInfo.expiresAt < Date.now()) {
        return { authenticated: false, error: 'Certificate has expired' }
      }

      // Verify agent ID matches certificate CN
      if (certInfo.commonName !== expectedAgentId) {
        return { authenticated: false, error: 'Certificate CN does not match agent ID' }
      }

      return {
        authenticated: true,
        agentId: expectedAgentId,
        permissions: ['task:execute', 'metrics:report', 'health:check'],
      }
    } catch (error) {
      return { authenticated: false, error: `Certificate validation failed: ${(error as Error).message}` }
    }
  }

  /**
   * Revoke a JWT token
   */
  revokeToken(token: string): void {
    this.revokedTokens.add(token)
    logger.warn('Token revoked', { tokenPrefix: token.substring(0, 20) })
  }

  /**
   * Revoke all tokens for an agent
   */
  revokeAgentTokens(agentId: string): void {
    for (const [id, record] of this.apiKeys) {
      if (record.agentId === agentId) {
        record.enabled = false
        logger.warn('API key disabled', { agentId, keyId: id })
      }
    }
  }

  /**
   * Unified authentication - tries multiple methods
   */
  async authenticate(
    headers: Record<string, string>,
    body?: string
  ): Promise<AuthResult> {
    const authHeader = headers['authorization'] || headers['Authorization']
    const signature = headers['x-signature']
    const timestamp = headers['x-timestamp']
    const nonce = headers['x-nonce']
    const agentId = headers['x-agent-id']
    const clientCert = headers['x-client-cert']

    // Try mTLS first (highest security)
    if (clientCert && agentId) {
      const result = this.validateMTLS(clientCert, agentId)
      if (result.authenticated) {
        return result
      }
    }

    // Try JWT
    if (authHeader && authHeader.split('.').length === 3) {
      const result = await this.validateJWT(authHeader)
      if (result.authenticated) {
        return result
      }
    }

    // Try HMAC signature
    if (signature && timestamp && nonce && body && agentId) {
      const result = await this.validateHMAC(signature, timestamp, nonce, body, agentId)
      if (result.authenticated) {
        return result
      }
    }

    // Try API Key
    if (authHeader) {
      const result = await this.validateApiKey(authHeader)
      if (result.authenticated) {
        return result
      }
    }

    return { authenticated: false, error: 'No valid authentication method found' }
  }

  // Private helper methods

  private generateSecret(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return this.base64Encode(bytes)
  }

  private hashKey(key: string): string {
    // Simple hash for demo - in production use proper hashing
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(16)
  }

  private base64Encode(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }

  private async signJWT(claims: JWTClaims): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' }
    const headerB64 = btoa(JSON.stringify(header))
    const payloadB64 = btoa(JSON.stringify(claims))
    
    const signature = await this.generateHMACSignature(
      `${headerB64}.${payloadB64}`,
      this.jwtSecret
    )

    return `${headerB64}.${payloadB64}.${signature}`
  }

  private async verifyJWT(token: string): Promise<JWTClaims> {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid token format')
    }

    const [headerB64, payloadB64, signature] = parts
    
    const expectedSignature = await this.generateHMACSignature(
      `${headerB64}.${payloadB64}`,
      this.jwtSecret
    )

    if (signature !== expectedSignature) {
      throw new Error('Invalid signature')
    }

    return JSON.parse(atob(payloadB64))
  }

  private async generateHMACSignature(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: HMAC_ALGORITHM },
      false,
      ['sign']
    )
    
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
    return this.base64Encode(new Uint8Array(signature))
  }

  private parseCertificate(cert: string): { commonName: string; expiresAt: number } | null {
    // Simplified certificate parsing - in production use proper X.509 library
    try {
      // Extract CN from certificate (very simplified)
      const cnMatch = cert.match(/CN=([^,]+)/)
      const commonName = cnMatch ? cnMatch[1] : ''

      // Assume 1 year validity
      return {
        commonName,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      }
    } catch {
      return null
    }
  }

  private startCleanup(): void {
    setInterval(() => {
      // Clean expired nonces
      const now = Date.now()
      for (const [nonce, timestamp] of this.nonceCache) {
        if (now - timestamp > 300000) { // 5 minutes
          this.nonceCache.delete(nonce)
        }
      }

      // Limit revoked tokens set size
      if (this.revokedTokens.size > 10000) {
        // Keep most recent 5000
        const tokens = Array.from(this.revokedTokens)
        this.revokedTokens.clear()
        tokens.slice(-5000).forEach(t => this.revokedTokens.add(t))
      }
    }, 60000)
  }
}

// Singleton instance
export const agentAuthManager = new AgentAuthManager()

// Middleware helper for Express-style handlers
export function requireAuth(permissions: string[] = []) {
  return async (req: { headers: Record<string, string>; body?: string }, _res: unknown, next: () => void) => {
    const result = await agentAuthManager.authenticate(req.headers, req.body)

    if (!result.authenticated) {
      throw new Error(`Authentication failed: ${result.error}`)
    }

    // Check permissions
    if (permissions.length > 0) {
      const hasPermission = permissions.some(p => 
        result.permissions?.includes(p) || result.permissions?.includes('*')
      )
      
      if (!hasPermission) {
        throw new Error('Insufficient permissions')
      }
    }

    // Attach auth info to request
    ;(req as unknown as Record<string, unknown>).auth = result
    next()
  }
}
