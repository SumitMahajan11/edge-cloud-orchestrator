import fastify from 'fastify';
import { generateTestToken, TEST_JWT_SECRET } from './helpers/token-factory.js';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'a'.repeat(32);
  process.env.JWT_ISSUER = 'edge-cloud-orchestrator';
  process.env.JWT_AUDIENCE = 'edge-cloud-clients';
  process.env.LOG_LEVEL = 'fatal';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  process.env.ENCRYPTION_KEY = 'a'.repeat(32);
});

const { mockMtls } = vi.hoisted(() => ({
  mockMtls: {
    AgentRegistrationService: class {
      constructor() {}
    },
    CertificateAuthorityManager: class {
      constructor() {}
      async initialize() {
        return { certificatePem: 'mock' };
      }
      getCACertificate() {
        return 'mock-ca-cert';
      }
    },
  },
}));

vi.mock('../services/mtls-authentication.js', () => mockMtls);

import v2Routes from '../routes/v2-manifest.js';

function buildMultipartBody(
  boundary: string,
  fields: Record<string, string>,
  fileBuffer: Buffer,
  fileName: string
): Buffer {
  const chunks: Buffer[] = [];
  for (const [key, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(`${val}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    )
  );
  chunks.push(fileBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

describe('Federated Learning Endpoints Integration', () => {
  let app: any;

  const mockPrisma: any = {
    federatedRound: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    fLModel: {
      findFirst: vi.fn(),
    },
    federatedWeightSubmission: {
      upsert: vi.fn(),
      count: vi.fn(),
    },
    edgeNode: {
      findUnique: vi.fn(),
    },
  };

  const mockModelStorage = {
    uploadWeights: vi.fn().mockResolvedValue({ url: 'http://s3.local/model-weights.bin' }),
    downloadWeights: vi.fn().mockResolvedValue(Buffer.from(new Float32Array(961).buffer)),
  };

  const mockTaskScheduler: any = {
    modelRegistry: {
      getActiveModel: vi.fn().mockResolvedValue({ version: '1.0.0' }),
      MODEL_DIR: '/tmp',
    },
  };

  beforeEach(async () => {
    app = fastify();

    app.decorate('prisma', mockPrisma);
    app.decorate('modelStorage', mockModelStorage);
    app.decorate('taskScheduler', mockTaskScheduler);

    await app.register(import('@fastify/jwt'), {
      secret: TEST_JWT_SECRET,
      issuer: 'edge-cloud-orchestrator',
      audience: 'edge-cloud-clients',
    });
    await app.register(import('@fastify/rate-limit'), {
      max: 100,
      timeWindow: 60000,
    });

    const { default: multipart } = await import('@fastify/multipart');
    await app.register(multipart, {
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
        fields: 10,
      },
    });

    const { ErrorSchema, HealthSchema } = await import('@edgecloud/shared-kernel');
    const { zodToFastifySchema } = await import('../utils/zod-schema.js');
    app.addSchema({ $id: 'ErrorSchema', ...zodToFastifySchema(ErrorSchema) });
    app.addSchema({ $id: 'HealthSchema', ...zodToFastifySchema(HealthSchema) });

    const { authenticate, requirePermission, requireRole } = await import('../middleware/auth.middleware.js');
    app.decorate('authenticate', authenticate);
    app.decorate('requirePermission', requirePermission);
    app.decorate('requireRole', requireRole);

    await app.register(v2Routes, { prefix: '/api/v2' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const generateToken = (role = 'USER', tid = 't1') => {
    return generateTestToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 't@t.com',
      role,
      tenantId: tid,
    });
  };

  it('Test 1 — GET /api/v2/ml/federated/round (fetches/creates active round)', async () => {
    const token = generateToken();
    mockPrisma.federatedRound.findFirst.mockResolvedValue(null);
    mockPrisma.fLModel.findFirst.mockResolvedValue({ id: 'fl-model-1' });
    mockPrisma.federatedRound.create.mockResolvedValue({
      id: 'round-123',
      roundNumber: 1,
      modelId: 'fl-model-1',
      status: 'RUNNING',
      minParticipants: 3,
      submissions: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/ml/federated/round',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.roundId).toBe('round-123');
    expect(body.status).toBe('RUNNING');
  });

  it('Test 2 — GET /api/v2/ml/federated/model/:modelId/weights (downloads binary weights)', async () => {
    const token = generateToken();
    mockPrisma.fLModel.findFirst.mockResolvedValue({
      id: 'fl-model-1',
      weightsUrl: 's3://some-bucket/weights.bin',
      weightsChecksum: 'abcd',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/ml/federated/model/fl-model-1/weights',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    const buffer = response.rawPayload;
    expect(buffer.length).toBe(961 * 4); // 961 floats of 4 bytes each = 3844 bytes
  });

  it('Test 3 — POST /api/v2/ml/federated/weights/upload (multipart weights upload)', async () => {
    const token = generateToken();
    mockPrisma.federatedRound.findUnique.mockResolvedValue({
      id: 'round-123',
      status: 'RUNNING',
      minParticipants: 3,
    });
    mockPrisma.federatedWeightSubmission.upsert.mockResolvedValue({});
    mockPrisma.federatedWeightSubmission.count.mockResolvedValue(1);

    const boundary = '----TestBoundary123';
    const fields = {
      roundId: 'round-123',
      nodeId: 'node-abc',
      sampleCount: '15',
      avgReward: '0.92',
    };
    const fileData = Buffer.alloc(961 * 4, 1); // Mock 961 floats of weight deltas
    const payload = buildMultipartBody(boundary, fields, fileData, 'weights.bin');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/ml/federated/weights/upload',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.weightsUrl).toBe('http://s3.local/model-weights.bin');
  });
});
