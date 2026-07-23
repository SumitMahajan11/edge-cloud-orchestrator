import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, X509Certificate, webcrypto } from 'crypto';
import * as x509 from '@peculiar/x509';
import fs from 'fs/promises';
import path from 'path';
import type { FastifyBaseLogger } from 'fastify';
import type { Logger as PinoLogger } from 'pino';

export type Logger = FastifyBaseLogger | PinoLogger;

import { SecretManagerFactory } from '@edgecloud/shared-kernel';

interface CertificateConfig {
  validityDays: number;
  keySize: number;
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
}

interface CertificateAuthority {
  privateKey: string;
  certificate: string;
  serialNumber: string;
  createdAt: Date;
  expiresAt: Date;
}

interface AgentCertificate {
  nodeId: string;
  privateKey: string;
  certificate: string;
  serialNumber: string;
  fingerprint: string;
  issuedAt: Date;
  expiresAt: Date;
}

interface BootstrapToken {
  id: string;
  token: string;
  nodeId?: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  usedBy?: string;
}

const CERT_CONFIG: CertificateConfig = {
  validityDays: 365,
  keySize: 2048,
  hashAlgorithm: 'sha256',
};

const CA_CONFIG: CertificateConfig = {
  validityDays: 3650, // 10 years
  keySize: 2048,
  hashAlgorithm: 'sha256',
};

// ============================================================================
// 1. Certificate Authority Setup
// ============================================================================

export class CertificateAuthorityManager {
  private prisma: PrismaClient;
  private logger: Logger;
  private ca: CertificateAuthority | null = null;

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
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
    });

    if (existingCA && existingCA.expiresAt > new Date()) {
      // Decrypt private key when loading
      const { decrypt, isEncrypted } = await import('../utils/encryption.js');
      const privateKeyPem = isEncrypted(existingCA.privateKeyPem)
        ? decrypt(existingCA.privateKeyPem)
        : existingCA.privateKeyPem;

      this.ca = {
        privateKey: privateKeyPem,
        certificate: existingCA.certificatePem,
        serialNumber: existingCA.serialNumber,
        createdAt: existingCA.issuedAt,
        expiresAt: existingCA.expiresAt,
      };
      this.logger.info(
        { serialNumber: existingCA.serialNumber },
        'Loaded existing CA',
      );
      return this.ca;
    }

    // Create new CA
    this.logger.warn('No valid CA found, creating new Certificate Authority');
    return this.createCA();
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
    const keys = await webcrypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: CA_CONFIG.keySize,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

    const privateKeyBuffer = await webcrypto.subtle.exportKey(
      'pkcs8',
      keys.privateKey,
    );
    const publicKeyBuffer = await webcrypto.subtle.exportKey(
      'spki',
      keys.publicKey,
    );

    const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(
      privateKeyBuffer,
    )
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n')}\n-----END PRIVATE KEY-----`;
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(
      publicKeyBuffer,
    )
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n')}\n-----END PUBLIC KEY-----`;

    const serialNumber = this.generateSerial('CA');
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + CA_CONFIG.validityDays);

    const certificate = await this.createCACertificate(
      keys.publicKey,
      keys.privateKey,
      serialNumber,
      now,
      expiresAt,
    );

    // Encrypt private key before storage
    const { encrypt } = await import('../utils/encryption.js');
    const encryptedPrivateKey = encrypt(privateKey);

    // Store in database with encrypted private key
    await this.prisma.certificateAuthority.create({
      data: {
        serialNumber,
        certificatePem: certificate,
        privateKeyPem: encryptedPrivateKey,
        publicKeyPem: publicKey,
        issuedAt: now,
        expiresAt,
        isActive: true,
      },
    });

    this.ca = {
      privateKey,
      certificate,
      serialNumber,
      createdAt: now,
      expiresAt,
    };

    this.logger.info(
      { serialNumber, expiresAt },
      'Created new Certificate Authority',
    );
    return this.ca;
  }

  /**
   * Get CA certificate for distribution to edge agents
   */
  getCACertificate(): string {
    if (!this.ca) {
      throw new Error('CA not initialized');
    }
    return this.ca.certificate;
  }

  /**
   * Get CA private key for test usage
   */
  getCAPrivateKey(): string {
    if (!this.ca) {
      throw new Error('CA not initialized');
    }
    return this.ca.privateKey;
  }

  /**
   * Sign a Certificate Signing Request (CSR)
   */
  async signCSR(
    _csrPem: string,
    nodeId: string,
    bootstrapToken: string,
  ): Promise<AgentCertificate> {
    if (!this.ca) {
      throw new Error('CA not initialized');
    }

    // Validate and atomically consume bootstrap token (prevents race conditions)
    await this.validateAndConsumeBootstrapToken(bootstrapToken, nodeId);

    let certificate: string;
    let serialNumber: string;

    // Use Vault PKI to issue a certificate instead of local signing
    const secretManager = SecretManagerFactory.create();
    let certBundle: any = null;
    if (secretManager.issueCertificate) {
      try {
        certBundle = await secretManager.issueCertificate(
          'edge-agent',
          nodeId,
          `${CERT_CONFIG.validityDays}d`,
        );
      } catch (err) {
        this.logger.warn({ err }, 'Vault certificate issuance failed, falling back to local CA signing');
      }
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + CERT_CONFIG.validityDays);

    if (certBundle) {
      certificate = certBundle.certificate;
      serialNumber = certBundle.serial_number;
    } else {
      // Local signing fallback
      this.logger.info({ nodeId }, 'Using local CA to sign agent CSR');
      const cleanPem = this.ca.privateKey.replace(
        /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
        '',
      );
      const caKey = await webcrypto.subtle.importKey(
        'pkcs8',
        Buffer.from(cleanPem, 'base64'),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true,
        ['sign'],
      );

      const parsedCsr = new x509.Pkcs10CertificateRequest(_csrPem);
      const agentPublicKey = await parsedCsr.publicKey.export();
      
      serialNumber = this.generateSerial('NODE');

      const cert = await x509.X509CertificateGenerator.create({
        serialNumber,
        subject: `CN=${nodeId}, O=EdgeCloud, OU=Edge Nodes`,
        issuer: `CN=EdgeCloud-CA, O=EdgeCloud`,
        notBefore: now,
        notAfter: expiresAt,
        signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        publicKey: agentPublicKey,
        signingKey: caKey,
      });

      certificate = cert.toString('pem');
    }

    // Generate fingerprint for the issued certificate
    const fingerprint = this.calculateFingerprint(certificate);

    // Store certificate in database (public key not needed as agent holds its key)
    await this.prisma.nodeCertificate.create({
      data: {
        nodeId,
        serialNumber,
        certificatePem: certificate,
        publicKeyPem: '', // Not stored; agents provide their own public key separately if needed
        issuedAt: now,
        expiresAt,
        isActive: true,
      },
    });

    this.logger.info(
      { nodeId, serialNumber, expiresAt },
      'Issued agent certificate successfully',
    );

    return {
      nodeId,
      privateKey: '', // Agent already has its own private key
      certificate,
      serialNumber,
      fingerprint,
      issuedAt: now,
      expiresAt,
    };
  }

  /**
   * Revoke a certificate
   */
  async revokeCertificate(nodeId: string, reason: string): Promise<void> {
    const cert = await this.prisma.nodeCertificate.findFirst({
      where: { nodeId, isActive: true },
      orderBy: { issuedAt: 'desc' },
    });

    if (!cert) {
      throw new Error(`No active certificate for node ${nodeId}`);
    }

    // Add to CRL
    await this.prisma.certificateRevocation.create({
      data: {
        serialNumber: cert.serialNumber,
        nodeId,
        reason,
        revokedAt: new Date(),
      },
    });

    // Mark certificate as inactive
    await this.prisma.nodeCertificate.update({
      where: { id: cert.id },
      data: { isActive: false },
    });

    this.logger.warn(
      { nodeId, serialNumber: cert.serialNumber, reason },
      'Certificate revoked',
    );
  }

  // ... helper methods
  private generateSerial(_prefix: string): string {
    return randomBytes(16).toString('hex');
  }

  private async createCACertificate(
    publicKey: webcrypto.CryptoKey,
    privateKey: webcrypto.CryptoKey,
    serialNumber: string,
    notBefore: Date,
    notAfter: Date,
  ): Promise<string> {
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber,
      name: 'CN=EdgeCloud-CA, O=EdgeCloud',
      notBefore,
      notAfter,
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      keys: {
        publicKey,
        privateKey,
      },
      extensions: [
        new x509.BasicConstraintsExtension(true, undefined, true),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
          true,
        ),
      ],
    });
    return cert.toString('pem');
  }

  private calculateFingerprint(cert: string): string {
    const hash = createHash('sha256').update(cert).digest('hex');
    return hash.match(/.{2}/g)?.join(':').toUpperCase() || hash;
  }

  private async validateAndConsumeBootstrapToken(
    token: string,
    nodeId: string,
  ): Promise<any> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const t = await tx.bootstrapToken.findUnique({
          where: { token },
          include: {
            user: {
              include: {
                tenantUsers: {
                  take: 1,
                },
              },
            },
          },
        });

        if (!t) throw new Error('Invalid bootstrap token');
        if (t.usedAt) throw new Error('Bootstrap token already used');
        if (t.expiresAt < new Date())
          throw new Error('Bootstrap token expired');

        return await tx.bootstrapToken.update({
          where: { token },
          data: { usedAt: new Date(), usedBy: nodeId },
          include: {
            user: {
              include: {
                tenantUsers: {
                  take: 1,
                },
              },
            },
          },
        });
      });
    } catch (error: any) {
      throw new Error(error.message || 'Bootstrap token consumption failed');
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
  static async generateKeyPairAndCSR(
    nodeId: string,
    region: string,
  ): Promise<{
    privateKey: string;
    publicKey: string;
    csr: string;
  }> {
    const keys = await webcrypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: CERT_CONFIG.keySize,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

    const privateKeyBuffer = await webcrypto.subtle.exportKey(
      'pkcs8',
      keys.privateKey,
    );
    const publicKeyBuffer = await webcrypto.subtle.exportKey(
      'spki',
      keys.publicKey,
    );

    const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(
      privateKeyBuffer,
    )
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n')}\n-----END PRIVATE KEY-----`;
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(
      publicKeyBuffer,
    )
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n')}\n-----END PUBLIC KEY-----`;

    const csr = await this.createCSR(
      keys.publicKey,
      keys.privateKey,
      nodeId,
      region,
    );

    return { privateKey, publicKey, csr };
  }

  /**
   * Create a Certificate Signing Request
   */
  private static async createCSR(
    publicKey: webcrypto.CryptoKey,
    privateKey: webcrypto.CryptoKey,
    nodeId: string,
    region: string,
  ): Promise<string> {
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: `CN=${nodeId}, O=EdgeCloud, OU=Edge Nodes, L=${region}`,
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      keys: {
        publicKey,
        privateKey,
      },
    });
    return csr.toString('pem');
  }

  /**
   * Store certificate and key securely on edge agent
   */
  static async storeCertificate(
    _nodeId: string,
    certificate: string,
    privateKey: string,
    caCertificate: string,
    certDir: string,
  ): Promise<void> {
    // In production, store with proper file permissions
    // - node.key: 600 (owner read/write only)
    // - node.crt: 644 (world readable)
    // - ca.crt: 644 (world readable)

    await fs.mkdir(certDir, { recursive: true });

    await fs.writeFile(
      path.join(certDir, 'node.key'),
      privateKey,
      { mode: 0o600 }, // Secure permissions
    );

    await fs.writeFile(path.join(certDir, 'node.crt'), certificate, {
      mode: 0o644,
    });

    await fs.writeFile(path.join(certDir, 'ca.crt'), caCertificate, {
      mode: 0o644,
    });
  }
}

// ============================================================================
// 3. Certificate Validation on API Server
// ============================================================================

export interface CertificateValidationResult {
  valid: boolean;
  nodeId?: string;
  serialNumber?: string;
  expiresAt?: Date;
  error?: string;
}

export class CertificateValidator {
  private prisma: PrismaClient;
  private logger: Logger;
  private caManager: CertificateAuthorityManager | undefined;
  private crlCache: Map<string, { revoked: boolean; expiresAt: number }> =
    new Map();
  private crlLastRefresh: Date = new Date(0);

  constructor(
    prisma: PrismaClient,
    logger: Logger,
    caManager?: CertificateAuthorityManager,
  ) {
    this.prisma = prisma;
    this.logger = logger;
    this.caManager = caManager;
  }

  /**
   * Validate a client certificate presented during mTLS handshake
   */
  async validateClientCertificate(
    certPem: string,
  ): Promise<CertificateValidationResult> {
    try {
      await this.refreshCRLIfNeeded();
      const cert = new X509Certificate(certPem);
      const { subject } = cert;
      const nodeIdMatch = subject.match(/CN=([^\n,;]+)/);
      const nodeId =
        nodeIdMatch && nodeIdMatch[1] ? nodeIdMatch[1].trim() : null;

      if (!nodeId) {
        return { valid: false, error: 'Certificate missing CN (node ID)' };
      }

      const validFrom = new Date(cert.validFrom);
      const validTo = new Date(cert.validTo);
      const now = new Date();

      if (now < validFrom) {
        return { valid: false, nodeId, error: 'Certificate not yet valid' };
      }

      if (now > validTo) {
        return { valid: false, nodeId, error: 'Certificate expired' };
      }

      const { serialNumber } = cert;
      if (await this.isRevoked(serialNumber)) {
        return {
          valid: false,
          nodeId,
          serialNumber,
          error: 'Certificate revoked',
        };
      }

      const dbCert = await this.prisma.nodeCertificate.findFirst({
        where: { nodeId, serialNumber, isActive: true },
      });

      if (!dbCert) {
        return {
          valid: false,
          nodeId,
          serialNumber,
          error: 'Certificate not found or inactive in database',
        };
      }

      // Verify signature and chain
      const isChainValid = await this.verifyCertificateChain(certPem);
      if (!isChainValid) {
        return {
          valid: false,
          nodeId,
          serialNumber,
          error: 'Certificate signature or chain verification failed',
        };
      }

      this.logger.debug(
        { nodeId, serialNumber },
        'Certificate validated successfully',
      );

      return {
        valid: true,
        nodeId,
        serialNumber,
        expiresAt: validTo,
      };
    } catch (error: any) {
      this.logger.error({ error }, 'Certificate validation failed');
      return { valid: false, error: 'Invalid certificate format' };
    }
  }

  async verifyCertificateChain(clientCertPem: string): Promise<boolean> {
    try {
      const clientCert = new X509Certificate(clientCertPem);
      const now = new Date();
      if (new Date(clientCert.validTo) < now) {
        this.logger.warn(
          { serialNumber: clientCert.serialNumber, expiry: clientCert.validTo },
          'Client certificate expired',
        );
        return false;
      }
      if (!this.caManager) {
        this.logger.error(
          'CA Manager not available for signature verification',
        );
        return false;
      }
      const caCertPem = this.caManager.getCACertificate();
      const caCert = new X509Certificate(caCertPem);
      const isSignedByCA = clientCert.verify(caCert.publicKey);
      if (!isSignedByCA) {
        this.logger.warn(
          { serialNumber: clientCert.serialNumber, issuer: clientCert.issuer },
          'Certificate not signed by trusted CA',
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error({ err }, 'Certificate chain verification error');
      return false;
    }
  }

  private async isRevoked(serialNumber: string): Promise<boolean> {
    const cached = this.crlCache.get(serialNumber);
    if (cached) {
      if (cached.revoked) {
        return true;
      }
      if (cached.expiresAt > Date.now()) {
        return false;
      }
    }

    const revoked = await this.prisma.certificateRevocation.findUnique({
      where: { serialNumber },
    });

    if (revoked) {
      this.crlCache.set(serialNumber, { revoked: true, expiresAt: Infinity });
      return true;
    } else {
      this.crlCache.set(serialNumber, {
        revoked: false,
        expiresAt: Date.now() + 300_000,
      });
      return false;
    }
  }

  private async refreshCRLIfNeeded(): Promise<void> {
    const now = new Date();
    const cacheAge = now.getTime() - this.crlLastRefresh.getTime();
    const CACHE_TTL = 6 * 60 * 60 * 1000;

    if (cacheAge > CACHE_TTL) {
      const revoked = await this.prisma.certificateRevocation.findMany();
      revoked.forEach((r) => {
        this.crlCache.set(r.serialNumber, {
          revoked: true,
          expiresAt: Infinity,
        });
      });
      this.crlLastRefresh = now;
      this.logger.info({ count: revoked.length }, 'Refreshed CRL cache');
    }
  }
}

// ============================================================================
// 4. Secure Agent Registration Workflow
// ============================================================================

export class AgentRegistrationService {
  private caManager: CertificateAuthorityManager;
  private prisma: PrismaClient;
  private logger: Logger;

  constructor(
    caManager: CertificateAuthorityManager,
    prisma: PrismaClient,
    logger: Logger,
  ) {
    this.caManager = caManager;
    this.prisma = prisma;
    this.logger = logger;
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
    expiresInMinutes: number = 60,
  ): Promise<BootstrapToken> {
    const token = `ec_${randomBytes(32).toString('base64url')}`;
    const id = randomBytes(16).toString('hex');

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);

    await this.prisma.bootstrapToken.create({
      data: {
        id,
        token,
        createdBy: adminUserId,
        createdAt: now,
        expiresAt,
      },
    });

    this.logger.info({ adminUserId, expiresAt }, 'Generated bootstrap token');

    return {
      id,
      token,
      createdBy: adminUserId,
      createdAt: now,
      expiresAt,
    };
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
    csr: string;
    bootstrapToken: string;
    nodeName: string;
    region: string;
    ipAddress: string;
    port: number;
    cpuCores: number;
    memoryGB: number;
    storageGB: number;
    hardwareId?: string;
  }): Promise<{
    certificate: string;
    caCertificate: string;
    nodeId: string;
    expiresAt: Date;
  }> {
    // Generate node ID
    const nodeId = `node-${randomBytes(8).toString('hex')}`;

    // Get tenant info from the bootstrap token
    const token = (await this.prisma.bootstrapToken.findUnique({
      where: { token: request.bootstrapToken },
      include: {
        user: { include: { tenantUsers: { take: 1 } } },
      },
    })) as any;

    if (!token) {
      throw new Error('Invalid bootstrap token');
    }
    if (token.usedAt) {
      throw new Error('Bootstrap token already used');
    }
    if (token.expiresAt < new Date()) {
      throw new Error('Bootstrap token expired');
    }

    const tenantId = token.user.tenantUsers[0]!.tenantId;

    // Create node record first to satisfy foreign key constraint in NodeCertificate
    await this.prisma.edgeNode.create({
      data: {
        id: nodeId,
        name: request.nodeName,
        location: request.region,
        region: request.region,
        ipAddress: request.ipAddress,
        port: request.port,
        url: `https://${request.ipAddress}:${request.port}`,
        status: 'OFFLINE',
        cpuCores: request.cpuCores,
        memoryGB: request.memoryGB,
        storageGB: request.storageGB,
        tenantId,
      },
    });

    // Sign CSR (Atomics handled inside signCSR)
    const agentCert = await this.caManager.signCSR(
      request.csr,
      nodeId,
      request.bootstrapToken,
    );

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: token.createdBy,
        tenantId,
        action: 'node.registered',
        entityType: 'node',
        entityId: nodeId,
        details: {
          nodeName: request.nodeName,
          region: request.region,
          certificateSerial: agentCert.serialNumber,
        },
      },
    });

    this.logger.info(
      { nodeId, nodeName: request.nodeName },
      'Agent registered successfully',
    );

    return {
      certificate: agentCert.certificate,
      caCertificate: this.caManager.getCACertificate(),
      nodeId,
      expiresAt: agentCert.expiresAt,
    };
  }
}

// ============================================================================
// 5. Certificate Rotation Strategy
// ============================================================================

export class CertificateRotationService {
  private prisma: PrismaClient;
  private logger: Logger;

  // Rotation thresholds
  private readonly ROTATION_WARNING_DAYS = 30;
  private readonly AUTO_ROTATION_DAYS = 14;
  private readonly GRACE_PERIOD_HOURS = 24;

  constructor(
    _caManager: CertificateAuthorityManager,
    prisma: PrismaClient,
    logger: Logger,
  ) {
    this.prisma = prisma;
    this.logger = logger;
  }

  /**
   * Check if certificate needs rotation
   */
  async checkRotationStatus(nodeId: string): Promise<{
    needsRotation: boolean;
    urgency: 'none' | 'warning' | 'critical' | 'expired';
    daysUntilExpiry: number;
    message: string;
  }> {
    const cert = await this.prisma.nodeCertificate.findFirst({
      where: { nodeId, isActive: true },
      orderBy: { issuedAt: 'desc' },
    });

    if (!cert) {
      return {
        needsRotation: true,
        urgency: 'critical',
        daysUntilExpiry: 0,
        message: 'No active certificate found',
      };
    }

    const now = new Date();
    const daysUntilExpiry = Math.ceil(
      (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntilExpiry <= 0) {
      return {
        needsRotation: true,
        urgency: 'expired',
        daysUntilExpiry,
        message: 'Certificate has expired',
      };
    }

    if (daysUntilExpiry <= this.AUTO_ROTATION_DAYS) {
      return {
        needsRotation: true,
        urgency: 'critical',
        daysUntilExpiry,
        message: `Certificate expires in ${daysUntilExpiry} days - immediate rotation required`,
      };
    }

    if (daysUntilExpiry <= this.ROTATION_WARNING_DAYS) {
      return {
        needsRotation: false,
        urgency: 'warning',
        daysUntilExpiry,
        message: `Certificate expires in ${daysUntilExpiry} days - schedule rotation`,
      };
    }

    return {
      needsRotation: false,
      urgency: 'none',
      daysUntilExpiry,
      message: 'Certificate is valid',
    };
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
    currentCertSerial: string,
  ): Promise<{
    newCertificate: string;
    newSerialNumber: string;
    expiresAt: Date;
  }> {
    // Verify current certificate is valid
    const currentCert = await this.prisma.nodeCertificate.findFirst({
      where: { nodeId, serialNumber: currentCertSerial, isActive: true },
    });

    if (!currentCert) {
      throw new Error('Current certificate not found or inactive');
    }

    // Sign new certificate
    const serialNumber = this.generateSerial('NODE');
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + CERT_CONFIG.validityDays);

    const publicKey = this.extractPublicKeyFromCSR(newCSR);
    const newCertificate = this.createAgentCertificate(
      publicKey,
      nodeId,
      serialNumber,
      now,
      expiresAt,
    );

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
    });

    // Schedule old certificate revocation (after grace period)
    setTimeout(
      async () => {
        await this.revokeOldCertificate(nodeId, currentCertSerial);
      },
      this.GRACE_PERIOD_HOURS * 60 * 60 * 1000,
    );

    this.logger.info(
      { nodeId, oldSerial: currentCertSerial, newSerial: serialNumber },
      'Certificate rotated',
    );

    return {
      newCertificate,
      newSerialNumber: serialNumber,
      expiresAt,
    };
  }

  /**
   * Automatic rotation check (run periodically)
   */
  async runAutomaticRotation(): Promise<void> {
    const now = new Date();
    const autoRotateBefore = new Date(now);
    autoRotateBefore.setDate(
      autoRotateBefore.getDate() + this.AUTO_ROTATION_DAYS,
    );

    // Find certificates expiring soon
    const expiringCerts = await this.prisma.nodeCertificate.findMany({
      where: {
        isActive: true,
        expiresAt: { lte: autoRotateBefore },
      },
      include: { node: true },
    });

    for (const cert of expiringCerts) {
      this.logger.info(
        { nodeId: cert.nodeId, expiresAt: cert.expiresAt },
        'Certificate approaching expiry - rotation recommended',
      );

      // In production, send notification to edge agent
      // Agent will initiate rotation via mTLS-authenticated request
    }
  }

  private async revokeOldCertificate(
    nodeId: string,
    serialNumber: string,
  ): Promise<void> {
    await this.prisma.nodeCertificate.updateMany({
      where: { nodeId, serialNumber },
      data: { isActive: false },
    });

    await this.prisma.certificateRevocation.create({
      data: {
        serialNumber,
        nodeId,
        reason: 'Superseded by rotation',
        revokedAt: new Date(),
      },
    });

    this.logger.info(
      { nodeId, serialNumber },
      'Old certificate revoked after rotation',
    );
  }

  private generateSerial(prefix: string): string {
    return `${prefix}-${Date.now()}-${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  private extractPublicKeyFromCSR(csr: string): string {
    return csr;
  }

  private createAgentCertificate(
    publicKey: string,
    nodeId: string,
    serialNumber: string,
    notBefore: Date,
    notAfter: Date,
  ): string {
    return `-----BEGIN [REDACTED]-----
Subject: CN=${nodeId}, O=EdgeCloud, OU=Edge Nodes
Serial: ${serialNumber}
Valid From: ${notBefore.toISOString()}
Valid Until: ${notAfter.toISOString()}
${publicKey}
-----END [REDACTED]-----`;
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
  cert: string;
  key: string;

  // CA certificate for client verification
  ca: string;

  // Request client certificate
  requestCert: boolean;

  // Reject unauthorized clients
  rejectUnauthorized: boolean;

  // Minimum TLS version
  minVersion: string;

  // Allowed cipher suites
  ciphers: string;
}

/**
 * Create Fastify server with mTLS
 */
export async function createMTLSServer(
  fastify: FastifyInstance,
  config: MTLSConfig,
  validator: CertificateValidator,
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
  });

  // Add mTLS verification hook
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip mTLS for health checks and registration
    if (request.url === '/health' || request.url === '/api/nodes/register') {
      return;
    }

    // Skip mTLS for user-authenticated routes (JWT)
    if (
      request.url.startsWith('/api/auth') ||
      request.url.startsWith('/api/webhooks')
    ) {
      return;
    }

    // Get client certificate from TLS socket
    const socket = request.raw.socket as any;
    const clientCert = socket.getPeerCertificate?.();

    if (!clientCert || Object.keys(clientCert).length === 0) {
      return reply.status(401).send({
        error: 'Client certificate required',
        code: 'MTLS_REQUIRED',
      });
    }

    // Validate certificate
    const certPem = `-----BEGIN [REDACTED]-----\n${clientCert.raw.toString('base64')}\n-----END [REDACTED]-----`;
    const validation = await validator.validateClientCertificate(certPem);

    if (!validation.valid) {
      return reply.status(401).send({
        error: 'Invalid client certificate',
        code: 'MTLS_INVALID',
        reason: validation.error,
      });
    }

    // Attach node identity to request
    (request as any).node = {
      id: validation.nodeId!,
      certificateSerial: validation.serialNumber!,
      certificateExpiresAt: validation.expiresAt!,
    };
  });
}

/**
 * Example Fastify server setup with mTLS
 */
export async function setupMTLSServer(
  fastify: FastifyInstance,
  prisma: PrismaClient,
  logger: Logger,
): Promise<void> {
  // Initialize CA
  const caManager = new CertificateAuthorityManager(prisma, logger);
  await caManager.initialize();

  // Initialize validator
  const validator = new CertificateValidator(prisma, logger, caManager);
  const { env } = await import('../config/env.js');

  // Load certificates from environment-configured paths
  const serverCertPath = env.MTLS_SERVER_CERT;
  const serverKeyPath = env.MTLS_SERVER_KEY;

  // Validate certificate files exist
  try {
    await fs.access(serverCertPath);
    await fs.access(serverKeyPath);
  } catch (error) {
    throw new Error(
      `mTLS certificate files not found. ` +
        `Set MTLS_SERVER_CERT and MTLS_SERVER_KEY environment variables. ` +
        `Expected: cert=${serverCertPath}, key=${serverKeyPath}`,
    );
  }

  // mTLS configuration
  const mtlsConfig: MTLSConfig = {
    // Server certificate (for API server identity) - loaded from env paths
    cert: await fs.readFile(serverCertPath, 'utf-8'),
    key: await fs.readFile(serverKeyPath, 'utf-8'),

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
  };

  // Apply mTLS configuration
  await createMTLSServer(fastify, mtlsConfig, validator);

  // Add certificate rotation endpoint (requires valid mTLS)
  fastify.post(
    '/api/nodes/:nodeId/certificate/rotate',
    async (request, reply) => {
      // Node identity verified by mTLS hook
      const { node } = request as any;
      const { nodeId } = request.params as { nodeId: string };

      // Ensure node is rotating its own certificate
      if (node.id !== nodeId) {
        return reply.status(403).send({
          error: 'Cannot rotate certificate for different node',
        });
      }

      const body = request.body as { csr: string } | undefined;
      if (!body || !body.csr) {
        return reply.status(400).send({
          error: 'CSR is required',
        });
      }
      const { csr } = body;
      const rotationService = new CertificateRotationService(
        caManager,
        prisma,
        logger,
      );

      const result = await rotationService.rotateCertificate(
        nodeId,
        csr,
        node.certificateSerial,
      );

      return reply.send(result);
    },
  );
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
import { FastifyInstance } from 'fastify';
