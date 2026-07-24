import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { prismaPlugin } from '../plugins/prisma';
import { register } from 'prom-client';
import { mockPrisma } from '../initializers/mock-prisma';

describe('Database Resilience & Observability', () => {
  let app: any;
  let basePrisma: any;

  beforeEach(async () => {
    // Reset prometheus register to avoid duplicate metric errors
    register.clear();

    app = Fastify({ logger: true });
    // Mock the logger to be spiable
    app.log.warn = vi.fn();
    app.log.error = vi.fn();
    app.log.info = vi.fn();

    basePrisma = mockPrisma;

    vi.spyOn(basePrisma, '$queryRaw').mockImplementation(async () => {
      return [{ 1: 1 }];
    });

    await app.register(prismaPlugin, { prisma: basePrisma });

    // MANUALLY register the health route in the test app since we aren't loading index.ts
    app.get('/health/ready', async (_request: any, reply: any) => {
      const startDb = Date.now();
      let dbStatus = 'healthy';
      let dbLatency = '0ms';
      const dbCircuit = app.dbCircuitBreaker?.getState() || 'CLOSED';

      if (dbCircuit === 'OPEN') {
        dbStatus = 'degraded';
      } else {
        try {
          await app.prisma.user.findFirst();
          dbLatency = `${Date.now() - startDb}ms`;
        } catch (e) {
          dbStatus = 'unhealthy';
        }
      }

      const isReady = dbStatus === 'healthy';
      if (!isReady) reply.status(503);

      return {
        status: isReady ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        services: {
          db: { status: dbStatus, latency: dbLatency, circuit: dbCircuit },
          redis: { status: 'healthy', latency: '0ms' },
        },
      };
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await basePrisma.$disconnect();
    vi.restoreAllMocks();
  });

  it('should record query metrics on successful execution', async () => {
    vi.spyOn(basePrisma.user, 'findFirst').mockResolvedValue({
      id: '1',
    } as any);
    await app.prisma.user.findFirst();

    const metrics = await register.getMetricsAsJSON();
    const durationMetric = metrics.find(
      (m) => m.name === 'db_query_duration_seconds',
    );

    expect(durationMetric).toBeDefined();
  });

  it('should open circuit breaker after consecutive failures', async () => {
    const error = new Error('Database connection lost');
    // Mock the base client model to always fail
    vi.spyOn(basePrisma.user, 'findFirst').mockRejectedValue(error);

    // The threshold is 25 in our tuned serverless implementation
    for (let i = 0; i < 25; i++) {
      await expect(app.prisma.user.findFirst()).rejects.toThrow(
        'Database connection lost',
      );
    }

    // The 26th call should be blocked by the circuit breaker
    await expect(app.prisma.user.findFirst()).rejects.toThrow(
      /Circuit breaker 'database' is OPEN/,
    );
    expect(app.dbCircuitBreaker.getState()).toBe('OPEN');
  });

  it('should return 503 from /health/ready when circuit breaker is OPEN', async () => {
    // Force open the circuit
    app.dbCircuitBreaker.forceOpen();
    expect(app.dbCircuitBreaker.getState()).toBe('OPEN');

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe('not_ready');
    expect(payload.services.db.status).toBe('degraded');
    expect(payload.services.db.circuit).toBe('OPEN');
  });

  it('should log a warning for slow queries', async () => {
    const logSpy = vi.spyOn(app.log, 'warn');

    // Mock a slow query (threshold is 100ms in our implementation)
    vi.spyOn(basePrisma.user, 'findFirst').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { id: '1' } as any;
    });

    await app.prisma.user.findFirst();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Slow database query detected',
        duration: expect.stringMatching(/0\.1/),
      }),
    );
  });
});
