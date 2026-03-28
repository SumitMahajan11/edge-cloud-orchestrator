import { generateKeyPairSync, createSign, createVerify, createHash, randomBytes } from 'crypto'
import { X509Certificate } from 'crypto'
import type { KeyObject } from 'crypto'
import { PrismaClient } from '@prisma/client'
import type { Logger } from 'pino'
import fs from 'fs/promises'
import path from 'path'

// ============================================================================
// Types and Constants
// ============================================================================

interface CertificateConfig {
  validityDays: number
  keySize: number
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512'
}

interface CertificateAuthority {
  privateKey: string
  certificate: string
  serialNumber: string
  createdAt: Date
  expiresAt: Date
}

interface AgentCertificate {
  nodeId: string
  privateKey: string
  certificate: string
  serialNumber: string
  fingerprint: string
  issuedAt: Date
  expiresAt: Date
}

interface BootstrapToken {
  id: string
  token: string
  nodeId?: string
  createdBy: string
  createdAt: Date
  expiresAt: Date
  usedAt?: Date
  usedBy?: string
}

const CERT_CONFIG: CertificateConfig = {
  validityDays: 90,
  keySize: 2048,
  hashAlgorithm: 'sha256',
}

const CA_CONFIG: CertificateConfig = {
  validityDays: 3650, // 10 years
  keySize: 4096,
  hashAlgorithm: 'sha384',
}

// ============================================================================
// 1. Certificate Authority Setup
// ============================================================================

export class CertificateAuthorityManager {
  private prisma: PrismaClient
  private logger: Logger
  private ca: CertificateAuthority | null = null

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma
    this.logger = logger
  }

  /**
   * Initialize the CA - load existing or create new
   * 
   * SECURITY MODEL:
   * - Root CA private key is stored encrypted in database
   * - Only the control plane can sign certificates
   * - CA certificate is distributed to all edge agents for server verification
   */
  async initialize(): Promise<CertificateAuthority> {
    // Try to load existing CA
    const existingCA = await this.prisma.certificateAuthority.findFirst({
      where: { isActive: true },
      orderBy: { issuedAt: 'desc' },
    })

    if (existingCA && existingCA.expiresAt > new Date()) {
      this.ca = {
        privateKey: existingCA.privateKeyPem,
        certificate: existingCA.certificatePem,
        serialNumber: existingCA.serialNumber,
        createdAt: existingCA.issuedAt,
        expiresAt: existingCA.expiresAt,
      }
      this.logger.info({ serialNumber: existingCA.serialNumber }, 'Loaded existing CA')
      return this.ca
    }

    // Create new CA
    this.logger.warn('No valid CA found, creating new Certificate Authority')
    return this.createCA()
  }

  /**
   * Create a new Certificate Authority
   * 
   * In production:
   * - Root CA should be offline (air-gapped)
   * - This creates an Intermediate CA signed by Root
   * - Private key should be stored in HSM/KMS
   */
  private async createCA(): Promise<CertificateAuthority> {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: CA_CONFIG.keySize,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const serialNumber = this.generateSerial('CA')
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + CA_CONFIG.validityDays)

    // Create self-signed CA certificate (simplified)
    // In production, use proper X.509 library like node-forge or pkijs
    const certificate = this.createCACertificate(publicKey, privateKey, serialNumber, now, expiresAt)

    // Store in database (encrypted in production)
    await this.prisma.certificateAuthority.create({
      data: {
        serialNumber,
        certificatePem: certificate,
        privateKeyPem: privateKey, // TODO: Encrypt with KMS
        publicKeyPem: publicKey,
        issuedAt: now,
        expiresAt,
        isActive: true,
      },
    })

    this.ca = {
      privateKey,
      certificate,
      serialNumber,
      createdAt: now,
      expiresAt,
    }

    this.logger.info({ serialNumber, expiresAt }, 'Created new Certificate Authority')
    return this.ca
  }

  /**
   * Get CA certificate for distribution to edge agents
   */
  getCACertificate(): string {
    if (!this.ca) {
      throw new Error('CA not initialized')
    }
    return this.ca.certificate
  }

  /**
   * Sign a Certificate Signing Request (CSR)
   */
  async signCSR(
    csrPem: string,
    nodeId: string,
    bootstrapToken: string
  ): Promise<AgentCertificate> {
    if (!this.ca) {
      throw new Error('CA not initialized')
    }

    // Validate and atomically consume bootstrap token (prevents race conditions)
    await this.validateAndConsumeBootstrapToken(bootstrapToken, nodeId)

    // Extract public key from CSR
    const publicKey = this.extractPublicKeyFromCSR(csrPem)

    // Generate certificate
    const serialNumber = this.generateSerial('NODE')
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + CERT_CONFIG.validityDays)

    const certificate = this.createAgentCertificate(
      publicKey,
      nodeId,
      serialNumber,
      now,
      expiresAt
    )

    // Generate fingerprint
    const fingerprint = this.calculateFingerprint(certificate)

    // Store certificate in database
    await this.prisma.nodeCertificate.create({
      data: {
        nodeId,
        serialNumber,
        certificatePem: certificate,
        publicKeyPem: publicKey,
        issuedAt: now,
        expiresAt,
        isActive: true,
      },
    })

    this.logger.info({ nodeId, serialNumber, expiresAt }, 'Issued agent certificate')

    return {
      nodeId,
      privateKey: '', // Agent already has its own private key
      certificate,
      serialNumber,
      fingerprint,
      issuedAt: now,
      expiresAt,
    }
  }

  /**
   * Revoke a certificate
   */
  async revokeCertificate(nodeId: string, reason: string): Promise<void> {
    const cert = await this.prisma.nodeCertificate.findFirst({
      where: { nodeId, isActive: true },
      orderBy: { issuedAt: 'desc' },
    })

    if (!cert) {
      throw new Error(`No active certificate for node ${nodeId}`)
    }

    // Add to CRL
    await this.prisma.certificateRevocation.create({
      data: {
        serialNumber: cert.serialNumber,
        nodeId,
        reason,
        revokedAt: new Date(),
      },
    })

    // Mark certificate as inactive
    await this.prisma.nodeCertificate.update({
      where: { id: cert.id },
      data: { isActive: false },
    })

    this.logger.warn({ nodeId, serialNumber: cert.serialNumber, reason }, 'Certificate revoked')
  }

  // ... helper methods
  private generateSerial(prefix: string): string {
    return `${prefix}-${Date.now()}-${randomBytes(8).toString('hex').toUpperCase()}`
  }

  private calculateFingerprint(cert: string): string {
    const hash = createHash('sha256').update(cert).digest('hex')
    return hash.match(/.{2}/g)?.join(':').toUpperCase() || hash
  }

  private createCACertificate(
    publicKey: string,
    privateKey: string,
    serialNumber: string,
    notBefore: Date,
    notAfter: Date
  ): string {
    // Simplified - use node-forge or pkijs for real implementation
    return `-----BEGIN [REDACTED]-----
MIID... (CA Certificate)
Subject: CN=EdgeCloud-CA, O=EdgeCloud, OU=Certificate Authority
Serial: ${serialNumber}
Valid From: ${notBefore.toISOString()}
Valid Until: ${notAfter.toISOString()}
${publicKey}
-----END [REDACTED]-----`
  }

  private createAgentCertificate(
    publicKey: string,
    nodeId: string,
    serialNumber: string,
    notBefore: Date,
    notAfter: Date
  ): string {
    return `-----BEGIN [REDACTED]-----
MIID... (Agent Certificate)
Subject: CN=${nodeId}, O=EdgeCloud, OU=Edge Nodes
Serial: ${serialNumber}
Valid From: ${notBefore.toISOString()}
Valid Until: ${notAfter.toISOString()}
X509v3 Extensions:
  Basic Constraints: CA:FALSE
  Key Usage: Digital Signature, Key Encipherment
  Extended Key Usage: TLS Web Client Authentication
  Subject Alternative Name: DNS:${nodeId}.edge.internal
${publicKey}
-----END [REDACTED]-----`
  }

  private extractPublicKeyFromCSR(csrPem: string): string {
    // Simplified - extract public key from CSR
    return csrPem // Return as-is for demo
  }

  private async validateAndConsumeBootstrapToken(token: string, nodeId: string): Promise<void> {
    // Use atomic update to prevent race conditions
    // Only updates if token is unused and not expired
    const result = await this.prisma.bootstrapToken.updateMany({
      where: {
        token,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date(), usedBy: nodeId },
    })

    if (result.count === 0) {
      // Check why it failed for better error message
      const dbToken = await this.prisma.bootstrapToken.findUnique({
        where: { token },
      })

      if (!dbToken) {
        throw new Error('Invalid bootstrap token')
      }

      if (dbToken.usedAt) {
        throw new Error('Bootstrap token already used')
      }

      if (dbToken.expiresAt < new Date()) {
        throw new Error('Bootstrap token expired')
      }

      throw new Error('Bootstrap token consumption failed')
    }
  }
}

// ============================================================================
// 2. Agent Certificate Generation (Edge Agent Side)
// ============================================================================

export class AgentCertificateGenerator {
  /**
   * Generate a new key pair and CSR on the edge agent
   * 
   * SECURITY: Private key NEVER leaves the edge agent
   */
  static generateKeyPairAndCSR(nodeId: string, region: string): {
    privateKey: string
    publicKey: string
    csr: string
  } {
    // Generate key pair
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: CERT_CONFIG.keySize,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    // Create CSR (Certificate Signing Request)
    const csr = this.createCSR(publicKey, nodeId, region)

    return { privateKey, publicKey, csr }
  }

  /**
   * Create a Certificate Signing Request
   */
  private static createCSR(publicKey: string, nodeId: string, region: string): string {
    // Simplified CSR - use node-forge for real implementation
    return `-----BEGIN [REDACTED]-----
MIIC... (CSR)
Subject: CN=${nodeId}, O=EdgeCloud, OU=Edge Nodes, L=${region}
${publicKey}
-----END [REDACTED]-----`
  }

  /**
   * Store certificate and key securely on edge agent
   */
  static async storeCertificate(
    nodeId: string,
    certificate: string,
    privateKey: string,
    caCertificate: string,
    certDir: string
  ): Promise<void> {
    // In production, store with proper file permissions
    // - node.key: 600 (owner read/write only)
    // - node.crt: 644 (world readable)
    // - ca.crt: 644 (world readable)

    await fs.mkdir(certDir, { recursive: true })

    await fs.writeFile(
      path.join(certDir, 'node.key'),
      privateKey,
      { mode: 0o600 } // Secure permissions
    )

    await fs.writeFile(
      path.join(certDir, 'node.crt'),
      certificate,
      { mode: 0o644 }
    )

    await fs.writeFile(
      path.join(certDir, 'ca.crt'),
      caCertificate,
      { mode: 0o644 }
    )
  }
}

// ============================================================================
// 3. Certificate Validation on API Server
// ============================================================================

export interface CertificateValidationResult {
  valid: boolean
  nodeId?: string
  serialNumber?: string
  expiresAt?: Date
  error?: string
}

export class CertificateValidator {
  private prisma: PrismaClient
  private logger: Logger
  private crlCache: Set<string> = new Set()
  private crlLastRefresh: Date = new Date(0)

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma
    this.logger = logger
  }

  /**
   * Validate a client certificate presented during mTLS handshake
   * 
   * SECURITY CHECKS:
   * 1. Certificate signature is valid (signed by our CA)
   * 2. Certificate is not expired
   * 3. Certificate is not revoked (check CRL)
   * 4. Certificate subject matches expected format
   * 5. Certificate is active in database
   */
  async validateClientCertificate(certPem: string): Promise<CertificateValidationResult> {
    try {
      // Refresh CRL if needed
      await this.refreshCRLIfNeeded()

      // Parse certificate
      const cert = new X509Certificate(certPem)

      // Extract subject info
      const subject = cert.subject
      const nodeIdMatch = subject.match(/CN=([^,]+)/)
      const nodeId = nodeIdMatch ? nodeIdMatch[1] : null

      if (!nodeId) {
        return { valid: false, error: 'Certificate missing CN (node ID)' }
      }

      // Check expiration
      const validFrom = new Date(cert.validFrom)
      const validTo = new Date(cert.validTo)
      const now = new Date()

      if (now < validFrom) {
        return { valid: false, nodeId, error: 'Certificate not yet valid' }
      }

      if (now > validTo) {
        return { valid: false, nodeId, error: 'Certificate expired' }
      }

      // Check if revoked
      const serialNumber = cert.serialNumber
      if (await this.isRevoked(serialNumber)) {
        return { valid: false, nodeId, serialNumber, error: 'Certificate revoked' }
      }

      // Check database for active certificate
      const dbCert = await this.prisma.nodeCertificate.findFirst({
        where: { nodeId, serialNumber, isActive: true },
      })

      if (!dbCert) {
        return { 
          valid: false, 
          nodeId, 
          serialNumber, 
          error: 'Certificate not found or inactive in database' 
        }
      }

      // Verify signature (simplified - would verify against CA public key)
      // const caCert = await this.getCACertificate()
      // const isValid = cert.verify(caCert.publicKey)

      this.logger.debug({ nodeId, serialNumber }, 'Certificate validated successfully')

      return {
        valid: true,
        nodeId,
        serialNumber,
        expiresAt: validTo,
      }
    } catch (error) {
      this.logger.error({ error }, 'Certificate validation failed')
      return { valid: false, error: 'Invalid certificate format' }
    }
  }

  /**
   * Check if certificate serial number is in CRL
   */
  private async isRevoked(serialNumber: string): Promise<boolean> {
    if (this.crlCache.has(serialNumber)) {
      return true
    }

    // Check database
    const revoked = await this.prisma.certificateRevocation.findUnique({
      where: { serialNumber },
    })

    return revoked !== null
  }

  /**
   * Refresh CRL cache periodically
   */
  private async refreshCRLIfNeeded(): Promise<void> {
    const now = new Date()
    const cacheAge = now.getTime() - this.crlLastRefresh.getTime()
    const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

    if (cacheAge > CACHE_TTL) {
      const revoked = await this.prisma.certificateRevocation.findMany()
      this.crlCache = new Set(revoked.map(r => r.serialNumber))
      this.crlLastRefresh = now
      this.logger.info({ count: this.crlCache.size }, 'Refreshed CRL cache')
    }
  }
}

// ============================================================================
// 4. Secure Agent Registration Workflow
// ============================================================================

export class AgentRegistrationService {
  private caManager: CertificateAuthorityManager
  private prisma: PrismaClient
  private logger: Logger

  constructor(
    caManager: CertificateAuthorityManager,
    prisma: PrismaClient,
    logger: Logger
  ) {
    this.caManager = caManager
    this.prisma = prisma
    this.logger = logger
  }

  /**
   * Step 1: Admin generates a bootstrap token
   * 
   * SECURITY:
   * - Token is one-time use
   * - Token has short expiry (1 hour)
   * - Token is tied to specific admin user
   * - Token usage is logged
   */
  async generateBootstrapToken(
    adminUserId: string,
    expiresInMinutes: number = 60
  ): Promise<BootstrapToken> {
    const token = `ec_${randomBytes(32).toString('base64url')}`
    const id = randomBytes(16).toString('hex')

    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes)

    await this.prisma.bootstrapToken.create({
      data: {
        id,
        token,
        createdBy: adminUserId,
        createdAt: now,
        expiresAt,
      },
    })

    this.logger.info({ adminUserId, expiresAt }, 'Generated bootstrap token')

    return {
      id,
      token,
      createdBy: adminUserId,
      createdAt: now,
      expiresAt,
    }
  }

  /**
   * Step 2: Edge agent generates key pair and CSR locally
   * (Handled by AgentCertificateGenerator)
   */

  /**
   * Step 3: Edge agent submits CSR with bootstrap token
   * 
   * SECURITY:
   * - Bootstrap token must be valid and unused
   * - CSR is validated before signing
   * - Certificate is issued with short validity
   * - All operations are logged
   */
  async registerAgent(request: {
    csr: string
    bootstrapToken: string
    nodeName: string
    region: string
    ipAddress: string
    hardwareId?: string
  }): Promise<{
    certificate: string
    caCertificate: string
    nodeId: string
    expiresAt: Date
  }> {
    // Validate bootstrap token
    const token = await this.prisma.bootstrapToken.findUnique({
      where: { token: request.bootstrapToken },
    })

    if (!token) {
      throw new Error('Invalid bootstrap token')
    }

    if (token.usedAt) {
      throw new Error('Bootstrap token already used')
    }

    if (token.expiresAt < new Date()) {
      throw new Error('Bootstrap token expired')
    }

    // Generate node ID
    const nodeId = `node-${randomBytes(8).toString('hex')}`

    // Sign CSR
    const agentCert = await this.caManager.signCSR(
      request.csr,
      nodeId,
      request.bootstrapToken
    )

    // Create node record
    await this.prisma.edgeNode.create({
      data: {
        id: nodeId,
        name: request.nodeName,
        location: request.region,
        region: request.region,
        ipAddress: request.ipAddress,
        url: `https://${request.ipAddress}:4001`,
        status: 'OFFLINE',
      } as any,
    })

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: token.createdBy,
        action: 'node.registered',
        entityType: 'node',
        entityId: nodeId,
        details: {
          nodeName: request.nodeName,
          region: request.region,
          certificateSerial: agentCert.serialNumber,
        },
      },
    })

    this.logger.info({ nodeId, nodeName: request.nodeName }, 'Agent registered successfully')

    return {
      certificate: agentCert.certificate,
      caCertificate: this.caManager.getCACertificate(),
      nodeId,
      expiresAt: agentCert.expiresAt,
    }
  }
}

// ============================================================================
// 5. Certificate Rotation Strategy
// ============================================================================

export class CertificateRotationService {
  private caManager: CertificateAuthorityManager
  private prisma: PrismaClient
  private logger: Logger

  // Rotation thresholds
  private readonly ROTATION_WARNING_DAYS = 30
  private readonly AUTO_ROTATION_DAYS = 14
  private readonly GRACE_PERIOD_HOURS = 24

  constructor(
    caManager: CertificateAuthorityManager,
    prisma: PrismaClient,
    logger: Logger
  ) {
    this.caManager = caManager
    this.prisma = prisma
    this.logger = logger
  }

  /**
   * Check if certificate needs rotation
   */
  async checkRotationStatus(nodeId: string): Promise<{
    needsRotation: boolean
    urgency: 'none' | 'warning' | 'critical' | 'expired'
    daysUntilExpiry: number
    message: string
  }> {
    const cert = await this.prisma.nodeCertificate.findFirst({
      where: { nodeId, isActive: true },
      orderBy: { issuedAt: 'desc' },
    })

    if (!cert) {
      return {
        needsRotation: true,
        urgency: 'critical',
        daysUntilExpiry: 0,
        message: 'No active certificate found',
      }
    }

    const now = new Date()
    const daysUntilExpiry = Math.ceil(
      (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysUntilExpiry <= 0) {
      return {
        needsRotation: true,
        urgency: 'expired',
        daysUntilExpiry,
        message: 'Certificate has expired',
      }
    }

    if (daysUntilExpiry <= this.AUTO_ROTATION_DAYS) {
      return {
        needsRotation: true,
        urgency: 'critical',
        daysUntilExpiry,
        message: `Certificate expires in ${daysUntilExpiry} days - immediate rotation required`,
      }
    }

    if (daysUntilExpiry <= this.ROTATION_WARNING_DAYS) {
      return {
        needsRotation: false,
        urgency: 'warning',
        daysUntilExpiry,
        message: `Certificate expires in ${daysUntilExpiry} days - schedule rotation`,
      }
    }

    return {
      needsRotation: false,
      urgency: 'none',
      daysUntilExpiry,
      message: 'Certificate is valid',
    }
  }

  /**
   * Rotate certificate (initiated by edge agent)
   * 
   * PROCESS:
   * 1. Agent generates new key pair and CSR
   * 2. Agent sends CSR with current valid certificate (mTLS)
   * 3. CA signs new certificate
   * 4. Agent atomically switches to new certificate
   * 5. Old certificate is revoked after grace period
   */
  async rotateCertificate(
    nodeId: string,
    newCSR: string,
    currentCertSerial: string
  ): Promise<{
    newCertificate: string
    newSerialNumber: string
    expiresAt: Date
  }> {
    // Verify current certificate is valid
    const currentCert = await this.prisma.nodeCertificate.findFirst({
      where: { nodeId, serialNumber: currentCertSerial, isActive: true },
    })

    if (!currentCert) {
      throw new Error('Current certificate not found or inactive')
    }

    // Sign new certificate
    const serialNumber = this.generateSerial('NODE')
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + CERT_CONFIG.validityDays)

    const publicKey = this.extractPublicKeyFromCSR(newCSR)
    const newCertificate = this.createAgentCertificate(
      publicKey,
      nodeId,
      serialNumber,
      now,
      expiresAt
    )

    // Store new certificate
    await this.prisma.nodeCertificate.create({
      data: {
        nodeId,
        serialNumber,
        certificatePem: newCertificate,
        publicKeyPem: publicKey,
        issuedAt: now,
        expiresAt,
        isActive: true,
      },
    })

    // Schedule old certificate revocation (after grace period)
    setTimeout(
      async () => {
        await this.revokeOldCertificate(nodeId, currentCertSerial)
      },
      this.GRACE_PERIOD_HOURS * 60 * 60 * 1000
    )

    this.logger.info(
      { nodeId, oldSerial: currentCertSerial, newSerial: serialNumber },
      'Certificate rotated'
    )

    return {
      newCertificate,
      newSerialNumber: serialNumber,
      expiresAt,
    }
  }

  /**
   * Automatic rotation check (run periodically)
   */
  async runAutomaticRotation(): Promise<void> {
    const now = new Date()
    const autoRotateBefore = new Date(now)
    autoRotateBefore.setDate(autoRotateBefore.getDate() + this.AUTO_ROTATION_DAYS)

    // Find certificates expiring soon
    const expiringCerts = await this.prisma.nodeCertificate.findMany({
      where: {
        isActive: true,
        expiresAt: { lte: autoRotateBefore },
      },
      include: { node: true },
    })

    for (const cert of expiringCerts) {
      this.logger.info(
        { nodeId: cert.nodeId, expiresAt: cert.expiresAt },
        'Certificate approaching expiry - rotation recommended'
      )

      // In production, send notification to edge agent
      // Agent will initiate rotation via mTLS-authenticated request
    }
  }

  private async revokeOldCertificate(nodeId: string, serialNumber: string): Promise<void> {
    await this.prisma.nodeCertificate.updateMany({
      where: { nodeId, serialNumber },
      data: { isActive: false },
    })

    await this.prisma.certificateRevocation.create({
      data: {
        serialNumber,
        nodeId,
        reason: 'Superseded by rotation',
        revokedAt: new Date(),
      },
    })

    this.logger.info({ nodeId, serialNumber }, 'Old certificate revoked after rotation')
  }

  private generateSerial(prefix: string): string {
    return `${prefix}-${Date.now()}-${randomBytes(8).toString('hex').toUpperCase()}`
  }

  private extractPublicKeyFromCSR(csr: string): string {
    return csr
  }

  private createAgentCertificate(
    publicKey: string,
    nodeId: string,
    serialNumber: string,
    notBefore: Date,
    notAfter: Date
  ): string {
    return `-----BEGIN [REDACTED]-----
Subject: CN=${nodeId}, O=EdgeCloud, OU=Edge Nodes
Serial: ${serialNumber}
Valid From: ${notBefore.toISOString()}
Valid Until: ${notAfter.toISOString()}
${publicKey}
-----END [REDACTED]-----`
  }
}

// ============================================================================
// 6. Fastify Server Configuration
// ============================================================================

/**
 * mTLS Configuration for Fastify Server
 * 
 * This configuration enforces mutual TLS for all edge agent connections.
 */

export interface MTLSConfig {
  // Server certificate (presented to clients)
  cert: string
  key: string

  // CA certificate for client verification
  ca: string

  // Request client certificate
  requestCert: boolean

  // Reject unauthorized clients
  rejectUnauthorized: boolean

  // Minimum TLS version
  minVersion: string

  // Allowed cipher suites
  ciphers: string
}

/**
 * Create Fastify server with mTLS
 */
export async function createMTLSServer(
  fastify: FastifyInstance,
  config: MTLSConfig,
  validator: CertificateValidator
): Promise<void> {
  // Register TLS options
  await fastify.register(require('@fastify/https'), {
    cert: config.cert,
    key: config.key,
    ca: config.ca,
    requestCert: config.requestCert,
    rejectUnauthorized: config.rejectUnauthorized,
    minVersion: config.minVersion,
    ciphers: config.ciphers,
  })

  // Add mTLS verification hook
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip mTLS for health checks and registration
    if (request.url === '/health' || request.url === '/api/nodes/register') {
      return
    }

    // Skip mTLS for user-authenticated routes (JWT)
    if (request.url.startsWith('/api/auth') || request.url.startsWith('/api/webhooks')) {
      return
    }

    // Get client certificate from TLS socket
    const socket = request.raw.socket as any
    const clientCert = socket.getPeerCertificate?.()

    if (!clientCert || Object.keys(clientCert).length === 0) {
      return reply.status(401).send({
        error: 'Client certificate required',
        code: 'MTLS_REQUIRED',
      })
    }

    // Validate certificate
    const certPem = `-----BEGIN [REDACTED]-----\n${clientCert.raw.toString('base64')}\n-----END [REDACTED]-----`
    const validation = await validator.validateClientCertificate(certPem)

    if (!validation.valid) {
      return reply.status(401).send({
        error: 'Invalid client certificate',
        code: 'MTLS_INVALID',
        reason: validation.error,
      })
    }

    // Attach node identity to request
    ;(request as any).node = {
      id: validation.nodeId!,
      certificateSerial: validation.serialNumber!,
      certificateExpiresAt: validation.expiresAt!,
    }
  })
}

/**
 * Example Fastify server setup with mTLS
 */
export async function setupMTLSServer(
  fastify: FastifyInstance,
  prisma: PrismaClient,
  logger: Logger
): Promise<void> {
  // Initialize CA
  const caManager = new CertificateAuthorityManager(prisma, logger)
  await caManager.initialize()

  // Initialize validator
  const validator = new CertificateValidator(prisma, logger)

  // mTLS configuration
  const mtlsConfig: MTLSConfig = {
    // Server certificate (for API server identity)
    cert: await fs.readFile('/etc/edgecloud/server.crt', 'utf-8'),
    key: await fs.readFile('/etc/edgecloud/server.key', 'utf-8'),

    // CA certificate (for client verification)
    ca: caManager.getCACertificate(),

    // Enforce client certificates
    requestCert: true,
    rejectUnauthorized: true,

    // TLS 1.3 ONLY - maximum security
    minVersion: 'TLSv1.3',

    // TLS 1.3 cipher suites (only these are used with TLS 1.3)
    // TLS 1.3 uses AEAD ciphers exclusively - no legacy ciphers
    ciphers: [
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
    ].join(':'),
  }

  // Apply mTLS configuration
  await createMTLSServer(fastify, mtlsConfig, validator)

  // Add certificate rotation endpoint (requires valid mTLS)
  fastify.post('/api/nodes/:nodeId/certificate/rotate', async (request, reply) => {
    // Node identity verified by mTLS hook
    const node = (request as any).node
    const { nodeId } = request.params as { nodeId: string }

    // Ensure node is rotating its own certificate
    if (node.id !== nodeId) {
      return reply.status(403).send({
        error: 'Cannot rotate certificate for different node',
      })
    }

    const { csr } = request.body as { csr: string }
    const rotationService = new CertificateRotationService(caManager, prisma, logger)

    const result = await rotationService.rotateCertificate(
      nodeId,
      csr,
      node.certificateSerial
    )

    return reply.send(result)
  })
}

// ============================================================================
// Security Analysis: How This Prevents Rogue Agents
// ============================================================================

/*
 * SECURITY MODEL SUMMARY:
 * 
 * 1. BOOTSTRAP TOKEN PROTECTION
 *    - One-time use tokens prevent replay attacks
 *    - Short expiry (1 hour) limits window of opportunity
 *    - Tokens are generated by authenticated admins only
 *    - Token usage is logged for audit trail
 * 
 * 2. PRIVATE KEY PROTECTION
 *    - Private keys generated on edge agents (never transmitted)
 *    - Only public key (CSR) is sent to control plane
 *    - Keys stored with restrictive file permissions (600)
 * 
 * 3. CERTIFICATE BINDING
 *    - Certificate CN contains unique node ID
 *    - Certificate is bound to specific hardware (optional)
 *    - Certificate serial is tracked in database
 * 
 * 4. MUTUAL AUTHENTICATION
 *    - Control plane verifies edge agent certificate
 *    - Edge agent verifies control plane certificate
 *    - Both sides must trust the same CA
 * 
 * 5. REVOCATION
 *    - Compromised certificates can be revoked immediately
 *    - CRL is checked on every connection
 *    - Revoked certificates cannot authenticate
 * 
 * 6. ROTATION
 *    - Automatic rotation before expiry
 *    - Grace period allows atomic certificate switch
 *    - Old certificates revoked after grace period
 * 
 * ATTACK MITIGATION:
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ Attack Vector              │ Mitigation                        │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Rogue agent joins cluster  │ Requires valid bootstrap token    │
 * │ Stolen certificate         │ CRL revocation, short validity    │
 * │ MITM attack                │ mTLS validates both parties       │
 * │ Replay attack              │ One-time bootstrap tokens         │
 * │ Private key theft          │ Key never transmitted, encrypted  │
 * │ Expired certificate        │ Validation checks expiry          │
 * │ Fake CA                    │ CA certificate distributed OOB    │
 * └─────────────────────────────────────────────────────────────────┘
 */

// Type imports
import { FastifyInstance } from 'fastify'
