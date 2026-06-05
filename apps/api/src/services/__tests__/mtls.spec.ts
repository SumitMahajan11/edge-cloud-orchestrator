import 'reflect-metadata';
// Set a dummy encryption key for tests (32 chars for AES-256)
vi.mock('../../config/env', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(32),
    NODE_ENV: 'test',
  },
}));

import { SecretManagerFactory } from '@edgecloud/shared-kernel';

// Mock SecretManagerFactory for tests
SecretManagerFactory.create = () =>
  ({
    issueCertificate: (_role: string, commonName: string, _ttl?: string) =>
      Promise.resolve({
        certificate: `-----BEGIN CERTIFICATE-----\nFAKE_CERTIFICATE_FOR_${commonName}\n-----END CERTIFICATE-----`,
        serial_number: `${commonName}-serial`,
      }),
  }) as any;
// import { expect, it, describe, beforeAll, vi } from 'vitest';
import {
  CertificateAuthorityManager,
  AgentCertificateGenerator,
} from '../mtls-authentication';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { X509Certificate } from 'crypto';

describe('mTLS Certificate Authority', () => {
  let prisma: any;
  const logger = pino({ level: 'silent' });

  beforeAll(async () => {
    // Mock Prisma
    prisma = {
      certificateAuthority: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      bootstrapToken: {
        updateMany: vi.fn(),
        findUnique: vi.fn(() =>
          Promise.resolve({
            token: 'valid-token',
            usedAt: null,
            expiresAt: new Date(Date.now() + 100000),
            user: {
              tenantUsers: [{ tenantId: 'test-tenant' }],
            },
          }),
        ),
        update: vi.fn(() =>
          Promise.resolve({
            token: 'valid-token',
            usedAt: new Date(),
            expiresAt: new Date(Date.now() + 100000),
            user: {
              tenantUsers: [{ tenantId: 'test-tenant' }],
            },
          }),
        ),
      },
      nodeCertificate: {
        create: vi.fn(),
      },
      $transaction: async (arg: any) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg(prisma);
      },
    };
  });

  it('should generate a real X.509 CA certificate', async () => {
    prisma.certificateAuthority.findFirst.mockResolvedValue(null);
    prisma.certificateAuthority.create.mockImplementation(({ data }: any) =>
      Promise.resolve(data),
    );

    const manager = new CertificateAuthorityManager(
      prisma as unknown as PrismaClient,
      logger,
    );
    const ca = await manager.initialize();

    expect(ca.certificate).toContain('-----BEGIN CERTIFICATE-----');
    expect(ca.privateKey).toContain('-----BEGIN PRIVATE KEY-----');

    const x509 = new X509Certificate(ca.certificate);
    expect(x509.subject).toContain('CN=EdgeCloud-CA');
    expect(x509.issuer).toContain('CN=EdgeCloud-CA');
    expect(x509.ca).toBe(true);
  });

  it('should issue and sign an agent certificate', async () => {
    // 1. Initialize CA
    prisma.certificateAuthority.findFirst.mockResolvedValue(null);
    prisma.certificateAuthority.create.mockImplementation(({ data }: any) =>
      Promise.resolve(data),
    );

    const manager = new CertificateAuthorityManager(
      prisma as unknown as PrismaClient,
      logger,
    );
    await manager.initialize();

    // 2. Generate Agent CSR
    const agentId = 'test-node-123';
    const { csr } = await AgentCertificateGenerator.generateKeyPairAndCSR(
      agentId,
      'us-east-1',
    );

    // 3. Sign CSR
    prisma.bootstrapToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.nodeCertificate.create.mockImplementation(({ data }: any) =>
      Promise.resolve(data),
    );

    const agentCert = await manager.signCSR(csr, agentId, 'valid-token');

    // 4. Verify Agent Cert
    expect(agentCert.certificate).toContain('-----BEGIN CERTIFICATE-----');
    expect(agentCert.certificate).toContain(`FAKE_CERTIFICATE_FOR_${agentId}`);

    // Signature and validity verification is handled by Vault in production,
    // so we skip X509 parsing for the mocked test string here.
  });
});
