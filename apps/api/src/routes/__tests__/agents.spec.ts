import 'reflect-metadata';

import { SecretManagerFactory } from '@edgecloud/shared-kernel';
import fastify from 'fastify';

import agentRoutes from '../agents.js';

// Mock SecretManagerFactory for Vault PKI
SecretManagerFactory.create = () =>
  ({
    issueCertificate: (_role: string, commonName: string, _ttl?: string) =>
      Promise.resolve({
        certificate: `-----BEGIN CERTIFICATE-----\nFAKE_CERTIFICATE_FOR_${commonName}\n-----END CERTIFICATE-----`,
        serial_number: `${commonName}-serial`,
      }),
  }) as any;

describe('Agent Registration Routes', () => {
  let app: any;
  const mockPrisma: any = {
    $extends: vi.fn().mockReturnThis(),
    $disconnect: vi.fn(),
    $transaction: vi.fn().mockImplementation((cb) => cb(mockPrisma)),
    bootstrapToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    certificateAuthority: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    edgeNode: {
      create: vi.fn(),
    },
    nodeCertificate: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  beforeEach(async () => {
    app = fastify();
    mockPrisma.isMock = true;
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

  it('should sign a valid CSR with a valid bootstrap token', async () => {
    const mockToken = {
      id: 'token-123',
      token: 'valid-token',
      expiresAt: new Date(Date.now() + 3600000),
      usedAt: null,
      user: {
        tenantUsers: [{ tenantId: 'tenant-1' }],
      },
    };

    const mockCA = {
      certificatePem:
        '-----BEGIN CERTIFICATE-----\nCA_CERT\n-----END CERTIFICATE-----',
    };

    mockPrisma.bootstrapToken.findUnique.mockResolvedValue(mockToken);
    mockPrisma.certificateAuthority.findFirst.mockResolvedValue(mockCA);
    mockPrisma.edgeNode.create.mockResolvedValue({ id: 'node-456' });
    mockPrisma.nodeCertificate.create.mockResolvedValue({});
    mockPrisma.bootstrapToken.updateMany.mockResolvedValue({ count: 1 }); // signCSR calls updateMany

    const response = await app.inject({
      method: 'POST',
      url: '/certificates/sign',
      payload: {
        csr: '-----BEGIN CERTIFICATE REQUEST-----\nFAKE_CSR\n-----END CERTIFICATE REQUEST-----',
        bootstrapToken: 'valid-token',
        nodeName: 'test-node',
        region: 'us-east-1',
        ipAddress: '127.0.0.1',
        port: 4000,
        cpuCores: 4,
        memoryGB: 8,
        storageGB: 100,
      },
    });

    expect(response.statusCode).toBe(200); // Route returns 200 on success
    const body = JSON.parse(response.body);
    expect(body.nodeId).toMatch(/^node-[a-f0-9]+$/);
    expect(body.certificate).toBeDefined();
    expect(body.caCertificate).toBeDefined();
  });

  it('should reject an expired bootstrap token', async () => {
    const mockToken = {
      id: 'token-123',
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 3600000),
      usedAt: null,
      user: {
        tenantUsers: [{ tenantId: 'tenant-1' }],
      },
    };

    mockPrisma.bootstrapToken.findUnique.mockResolvedValue(mockToken);

    const response = await app.inject({
      method: 'POST',
      url: '/certificates/sign',
      payload: {
        csr: 'FAKE_CSR',
        bootstrapToken: 'expired-token',
        nodeName: 'test-node',
        region: 'us-east-1',
      },
    });

    console.log(
      'DEBUG EXPIRED TOKEN RESPONSE:',
      response.statusCode,
      response.body,
    );
    expect(response.statusCode).toBe(400); // Current implementation returns 400
    expect(JSON.parse(response.body).error.message).toContain('expired');
  });
});
