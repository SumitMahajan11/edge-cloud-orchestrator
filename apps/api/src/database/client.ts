import { PrismaClient } from '@prisma/client';
import { trace } from '@opentelemetry/api';
import { env } from '../config/env';

/**
 * Extension to record slow database queries in OpenTelemetry traces
 */
const slowQueryExtension = {
  query: {
    async $allOperations({ operation, model, args, query }: any) {
      const start = Date.now();
      const result = await query(args);
      const duration = Date.now() - start;

      if (duration > 500) {
        const span = trace.getActiveSpan();
        if (span) {
          span.addEvent('slow_db_query', {
            'db.operation': operation,
            'db.model': model || 'unknown',
            'db.duration_ms': duration,
          });
        }
      }
      return result;
    },
  },
};

class PrismaClientWithReplicas {
  private primary: any;
  private readReplica: any = null;
  private useReadReplica: boolean;

  constructor() {
    const primaryUrl = env.DATABASE_URL;
    const readReplicaUrl = env.DATABASE_READ_URL || primaryUrl;

    const basePrimary = new PrismaClient({
      log:
        env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
    this.primary = basePrimary.$extends(slowQueryExtension);

    // Only create read replica client if URL is different from primary
    this.useReadReplica = readReplicaUrl !== primaryUrl && !!readReplicaUrl;

    if (this.useReadReplica) {
      const baseReplica = new PrismaClient({
        datasources: {
          db: {
            url: readReplicaUrl,
          },
        },
        log:
          env.NODE_ENV === 'development'
            ? ['query', 'error', 'warn']
            : ['error'],
      });
      this.readReplica = baseReplica.$extends(slowQueryExtension);
    }
  }

  /**
   * Get client for write operations (always uses primary)
   */
  get write(): PrismaClient {
    return this.primary;
  }

  /**
   * Get client for read operations (uses replica if available)
   */
  get read(): PrismaClient {
    return this.readReplica || this.primary;
  }

  /**
   * Get primary client for transactions
   */
  get $transaction() {
    return this.primary.$transaction.bind(this.primary);
  }

  /**
   * Connect both clients
   */
  async $connect() {
    // Note: $extends clients don't have $connect themselves, use base
    // Actually they usually do, but let's be safe if they don't.
    // In Prisma 5+, they do have it.
    await this.primary.$connect();
    if (this.readReplica) {
      await this.readReplica.$connect();
    }
  }

  /**
   * Disconnect both clients
   */
  async $disconnect() {
    await this.primary.$disconnect();
    if (this.readReplica) {
      await this.readReplica.$disconnect();
    }
  }

  /**
   * Health check for both connections
   */
  async healthCheck(): Promise<{ primary: boolean; replica: boolean }> {
    const results = { primary: false, replica: false };

    try {
      await this.primary.$queryRaw`SELECT 1`;
      results.primary = true;
    } catch {
      results.primary = false;
    }

    if (this.readReplica) {
      try {
        await this.readReplica.$queryRaw`SELECT 1`;
        results.replica = true;
      } catch {
        results.replica = false;
      }
    } else {
      results.replica = results.primary; // Same as primary if no replica
    }

    return results;
  }
}

// Singleton instance
const globalForPrisma = global as unknown as {
  prisma: PrismaClientWithReplicas;
};

export const prisma = globalForPrisma.prisma || new PrismaClientWithReplicas();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Backward-compatible default export
export const prismaClient = prisma.write;
export default prismaClient;
