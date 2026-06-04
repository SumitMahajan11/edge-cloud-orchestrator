import 'reflect-metadata';

import { webcrypto,X509Certificate } from 'crypto';
import { SecretManagerFactory } from '@edgecloud/shared-kernel';
import * as x509 from '@peculiar/x509';
import pino from 'pino';
// using globals for vitest API

import { AgentCertificateGenerator,CertificateAuthorityManager, CertificateValidator } from '../mtls-authentication';

// Mock env
vi.mock('../../config/env', () => ({
  env: {
    ENCRYPTION_KEY: 'a'.repeat(32),
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret',
  }
}));

// Mock SecretManagerFactory
SecretManagerFactory.create = () => ({
    issueCertificate: (_role: string, commonName: string, _ttl?: string) => Promise.resolve({
      certificate: `-----BEGIN CERTIFICATE-----\nFAKE_CERTIFICATE_FOR_${commonName}\n-----END CERTIFICATE-----`,
      serial_number: `${commonName}-serial`,
    }),
}) as any;

describe('mTLS Forgery Protection', () => {
  let prisma: any;
  const logger = pino({ level: 'info' }); 

  beforeEach(() => {
    prisma = {
      certificateAuthority: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      nodeCertificate: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      certificateRevocation: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      bootstrapToken: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn((fn) => fn(prisma)),
    };
  });

  async function generateSelfSignedCert(nodeId: string, serialNumber: string) {
    const keys = await (webcrypto as any).subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber,
      name: `CN=${nodeId}, O=EdgeCloud`,
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 86400000),
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      keys: {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
    });

    return cert.toString('pem');
  }

  it('rejects a certificate signed by a different CA even if serial is in DB', async () => {
    // 1. Initialize the official CA
    prisma.certificateAuthority.findFirst.mockResolvedValue(null);
    prisma.certificateAuthority.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    const caManager = new CertificateAuthorityManager(prisma, logger);
    await caManager.initialize();

    // 2. Generate a forged (self-signed) certificate
    const nodeId = 'rogue-node';
    const serialNumber = '12345678';
    const forgedCertPem = await generateSelfSignedCert(nodeId, serialNumber);

    // 3. Simulating the attacker having stolen a valid serial number
    prisma.nodeCertificate.findFirst.mockResolvedValue({
      id: 'cert-id',
      nodeId,
      serialNumber,
      isActive: true,
      expiresAt: new Date(Date.now() + 86400000),
    });

    // 4. Validate
    const validator = new CertificateValidator(prisma, logger, caManager);
    const result = await validator.validateClientCertificate(forgedCertPem);

    // 5. Assert rejection
    expect(result.valid).toBe(false);
    expect(result.error).toContain('signature or chain verification failed');
  }, 30000);

  it('accepts a valid certificate signed by the system CA', async () => {
    // 1. Initialize CA
    prisma.certificateAuthority.findFirst.mockResolvedValue(null);
    prisma.certificateAuthority.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    const caManager = new CertificateAuthorityManager(prisma, logger);
    await caManager.initialize();

    // 2. Generate a valid cert using the real signCSR workflow
    const nodeId = 'valid-node';
    const { csr } = await AgentCertificateGenerator.generateKeyPairAndCSR(nodeId, 'us-east-1');
    
    prisma.bootstrapToken.findUnique.mockResolvedValue({
        id: 'token-id',
        token: 'valid-token',
        usageLimit: 10,
        usageCount: 0,
        expiresAt: new Date(Date.now() + 86400000),
    });
    prisma.bootstrapToken.update.mockResolvedValue({ id: 'token-id' });
    prisma.bootstrapToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.nodeCertificate.create.mockImplementation(({ data }: any) => Promise.resolve({ ...data, id: 'db-id' }));
    
    SecretManagerFactory.create = () => ({
        issueCertificate: async (_role: string, commonName: string) => {
            const caKey = await (webcrypto as any).subtle.importKey(
                'pkcs8',
                Buffer.from(caManager.getCAPrivateKey().replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, ''), 'base64'),
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                true,
                ['sign']
            );
            const keys = await (webcrypto as any).subtle.generateKey(
                { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
                true,
                ['sign', 'verify']
            );
            const cert = await x509.X509CertificateGenerator.create({
                serialNumber: 'abcdef12',
                subject: `CN=${commonName}, O=EdgeCloud`,
                issuer: `CN=EdgeCloud-CA, O=EdgeCloud`,
                notBefore: new Date(),
                notAfter: new Date(Date.now() + 86400000),
                signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                publicKey: keys.publicKey,
                signingKey: caKey,
            });
            return {
                certificate: cert.toString('pem'),
                serial_number: 'abcdef12',
            };
        }
    }) as any;

    const signedCert = await caManager.signCSR(csr, nodeId, 'valid-token');

    // 3. Mock DB check for validation
    const x509Cert = new X509Certificate(signedCert.certificate);
    prisma.nodeCertificate.findFirst.mockResolvedValue({
      id: 'db-id',
      nodeId,
      serialNumber: x509Cert.serialNumber,
      isActive: true,
      expiresAt: new Date(x509Cert.validTo),
    });
    prisma.certificateRevocation.findUnique.mockResolvedValue(null);

    // 4. Validate
    const validator = new CertificateValidator(prisma, logger, caManager);
    const result = await validator.validateClientCertificate(signedCert.certificate);

    // 5. Assert success
    expect(result.valid).toBe(true);
    expect(result.nodeId).toBe(nodeId);
  }, 30000);
});
