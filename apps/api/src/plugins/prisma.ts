import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import { prismaForTenant } from '@edgecloud/shared-kernel';
import { Histogram, register as globalRegister } from 'prom-client';
import { CircuitBreaker } from '@edgecloud/circuit-breaker';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    dbCircuitBreaker: CircuitBreaker;
  }
}

// Helper to get or create metric
function getDbQueryDuration() {
  const name = 'db_query_duration_seconds';
  const existing = globalRegister.getSingleMetric(name);
  if (existing) return existing as Histogram<string>;

  return new Histogram({
    name,
    help: 'Duration of Database queries in seconds',
    labelNames: ['model', 'operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  });
}

export const prismaPlugin = fp(
  async (fastify, options: { prisma: PrismaClient }) => {
    fastify.log.info('Initializing Prisma with resilience middleware...');

    const isMock = (options.prisma as any).isMock;
    const dbQueryDuration = getDbQueryDuration();

    // Create Circuit Breaker for DB - scoped to this plugin instance
    const dbCircuitBreaker = new CircuitBreaker({
      name: 'database',
      failureThreshold: 5,
      resetTimeout: 30000, // 30s
    });

    // 1. Add Scoped Tenant Extension
    let extendedPrisma = isMock
      ? options.prisma
      : prismaForTenant(options.prisma);

    // Common handler for all database operations
    const handleOperation = async ({ model, operation, args, query }: any) => {
      const start = Date.now();
      const modelName = model || 'none';

      try {
        // Execute within Circuit Breaker
        const result = await dbCircuitBreaker.execute(async () => {
          return query(args);
        });

        const duration = (Date.now() - start) / 1000;
        dbQueryDuration.observe({ model: modelName, operation }, duration);

        // Log slow queries
        if (duration > 0.1) {
          // 100ms
          fastify.log.warn({
            msg: 'Slow database query detected',
            model: modelName,
            operation,
            duration: `${duration}s`,
          });
        }

        return result;
      } catch (error: any) {
        const duration = (Date.now() - start) / 1000;
        dbQueryDuration.observe({ model: modelName, operation }, duration);

        // If it's a circuit breaker open error, log it specifically
        if (error.name === 'CircuitBreakerOpenError') {
          fastify.log.error({
            msg: 'Database circuit breaker is OPEN. Rejecting query.',
            model: modelName,
            operation,
          });
        }
        throw error;
      }
    };

    // 2. Add Observability and Resilience Extension
    extendedPrisma = extendedPrisma.$extends({
      query: {
        $allModels: {
          $allOperations: handleOperation,
        },
        $queryRaw: handleOperation,
        $executeRaw: handleOperation,
        $queryRawUnsafe: handleOperation,
        $executeRawUnsafe: handleOperation,
      },
    });

    if (!fastify.prisma) {
      fastify.decorate('prisma', extendedPrisma);
      fastify.decorate('dbCircuitBreaker', dbCircuitBreaker);
      fastify.log.info('Prisma and DB Circuit Breaker decorated successfully');
    }

    fastify.addHook('onClose', async () => {
      await options.prisma.$disconnect();
    });
  },
);
