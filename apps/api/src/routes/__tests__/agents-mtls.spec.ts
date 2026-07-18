import 'reflect-metadata';

import { webcrypto } from 'crypto';
import { SecretManagerFactory } from '@edgecloud/shared-kernel';
import * as x509 from '@peculiar/x509';
import fastify from 'fastify';
import pino from 'pino';

// Define dynamic mockEnv using vi.hoisted to prevent hoisting issues
const mockEnv = vi.hoisted(() => ({
  TRUST_X_CLIENT_CERT: true,
  TRUST_PROXY: undefined as string | undefined,
  ENCRYPTION_KEY: 'a'.repeat(32),
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret',
}));

vi.mock('../../config/env', () => ({
  env: mockEnv,
}));

import { CertificateAuthorityManager } from '../../services/mtls-authentication.js';
import agentRoutes from '../agents.js';

// Mock SecretManagerFactory for test stability
SecretManagerFactory.create = () =>
  ({
    issueCertificate: (_role: string, commonName: string, _ttl?: string) =>
      Promise.resolve({
        certificate: `-----BEGIN CERTIFICATE-----\nFAKE_CERTIFICATE_FOR_${commonName}\n-----END CERTIFICATE-----`,
        serial_number: `${commonName}-serial`,
      }),
  }) as any;

describe('Agent routes mTLS / X-Client-Cert validation', () => {
  let app: any;
  let caManager: CertificateAuthorityManager;
  const logger = pino({ level: 'error' });

  // Store CA DB record locally for mock return
  let dbCA: any = null;

  const mockPrisma: any = {
    $extends: vi.fn().mockReturnThis(),
    $disconnect: vi.fn(),
    $transaction: vi.fn().mockImplementation((cb) => cb(mockPrisma)),
    certificateAuthority: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(dbCA)),
      create: vi.fn().mockImplementation(({ data }: any) => {
        dbCA = data;
        return Promise.resolve(data);
      }),
    },
    edgeNode: {
      findUnique: vi.fn(),
    },
    task: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  async function generateCert(
    nodeId: string,
    serialNumber: string,
    caManagerInstance?: CertificateAuthorityManager,
    expired = false,
  ) {
    const keys = await (webcrypto as any).subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

    const now = new Date();
    const notBefore = expired ? new Date(now.getTime() - 172800000) : now;
    const notAfter = expired
      ? new Date(now.getTime() - 86400000)
      : new Date(now.getTime() + 86400000);

    if (caManagerInstance) {
      // Sign with the system CA
      const caKey = await (webcrypto as any).subtle.importKey(
        'pkcs8',
        Buffer.from(
          caManagerInstance
            .getCAPrivateKey()
            .replace(
              /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,
              '',
            ),
          'base64',
        ),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true,
        ['sign'],
      );

      const cert = await x509.X509CertificateGenerator.create({
        serialNumber,
        subject: `CN=${nodeId}, O=EdgeCloud`,
        issuer: `CN=EdgeCloud-CA, O=EdgeCloud`,
        notBefore,
        notAfter,
        signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        publicKey: keys.publicKey,
        signingKey: caKey,
      });

      return cert.toString('pem');
    } else {
      // Self-signed certificate
      const cert = await x509.X509CertificateGenerator.createSelfSigned({
        serialNumber,
        name: `CN=${nodeId}, O=EdgeCloud`,
        notBefore,
        notAfter,
        signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        keys: {
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
      });

      return cert.toString('pem');
    }
  }

  beforeEach(async () => {
    dbCA = null;
    mockEnv.TRUST_X_CLIENT_CERT = true;
    mockEnv.TRUST_PROXY = '127.0.0.1';

    // 1. Initialize CA and populate dbCA
    caManager = new CertificateAuthorityManager(mockPrisma, logger);
    await caManager.initialize();

    // 2. Setup fastify app
    app = fastify();
    app.decorate('prisma', mockPrisma);
    app.decorate('authenticate', vi.fn());
    app.decorate(
      'requireRole',
      vi.fn(() => (_req: any, _res: any, done: any) => done()),
    );

    const { ErrorSchema } = await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../../utils/zod-schema.js');
    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });

    await app.register(agentRoutes);
  });

  it('rejects X-Client-Cert signature verification failures (self-signed)', async () => {
    const forgedCert = await generateCert('node-forged', '11223344');

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/pending',
      headers: {
        'x-client-cert': encodeURIComponent(forgedCert),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('UNAUTHORIZED');
  });

  it('rejects expired client certificates', async () => {
    const expiredCert = await generateCert(
      'node-expired',
      '22334455',
      caManager,
      true,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/pending',
      headers: {
        'x-client-cert': encodeURIComponent(expiredCert),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('UNAUTHORIZED');
  });

  it('rejects valid certificates if TRUST_X_CLIENT_CERT is disabled', async () => {
    mockEnv.TRUST_X_CLIENT_CERT = false;

    const validCert = await generateCert('node-valid', '33445566', caManager);

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/pending',
      headers: {
        'x-client-cert': encodeURIComponent(validCert),
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects valid certificates if request IP is not in TRUST_PROXY list', async () => {
    mockEnv.TRUST_PROXY = '192.168.1.1, 10.0.0.1';

    const validCert = await generateCert('node-valid', '44556677', caManager);

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/pending',
      headers: {
        'x-client-cert': encodeURIComponent(validCert),
      },
    });

    // Fastify inject IP defaults to 127.0.0.1, which is not in the TRUST_PROXY list
    expect(response.statusCode).toBe(401);
  });

  it('rejects valid certificates if TRUST_PROXY is not configured (fails closed)', async () => {
    mockEnv.TRUST_PROXY = undefined;

    const validCert = await generateCert('node-valid', '99999999', caManager);

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/pending',
      headers: {
        'x-client-cert': encodeURIComponent(validCert),
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a valid signed client certificate with matching node identity and proxy settings', async () => {
    const validCert = await generateCert('node-valid', '55667788', caManager);

    // Mock node database resolution for /tasks/pending
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: 'node-valid',
      tenantId: 'tenant-abc',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/pending',
      headers: {
        'x-client-cert': encodeURIComponent(validCert),
      },
    });

    // Since node exists and cert is valid, it falls through to standard route logic (fetching tasks) and returns 404 (No tasks pending)
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe('NOT_FOUND');
  });
});
