import { PrismaClient } from '@prisma/client'

// Read replica URL for scaling read operations
const readReplicaUrl = process.env.DATABASE_READ_URL || process.env.DATABASE_URL

// Primary database URL for writes
const primaryUrl = process.env.DATABASE_URL

// Extended Prisma client with read replica support
class PrismaClientWithReplicas {
  private primary: PrismaClient
  private readReplica: PrismaClient | null = null
  private useReadReplica: boolean

  constructor() {
    this.primary = new PrismaClient({
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'error', 'warn'] 
        : ['error'],
    })

    // Only create read replica client if URL is different from primary
    this.useReadReplica = readReplicaUrl !== primaryUrl && !!readReplicaUrl
    
    if (this.useReadReplica) {
      this.readReplica = new PrismaClient({
        datasources: {
          db: {
            url: readReplicaUrl,
          },
        },
        log: process.env.NODE_ENV === 'development' 
          ? ['query', 'error', 'warn'] 
          : ['error'],
      })
    }
  }

  /**
   * Get client for write operations (always uses primary)
   */
  get write(): PrismaClient {
    return this.primary
  }

  /**
   * Get client for read operations (uses replica if available)
   */
  get read(): PrismaClient {
    return this.readReplica || this.primary
  }

  /**
   * Get primary client for transactions
   */
  get $transaction() {
    return this.primary.$transaction.bind(this.primary)
  }

  /**
   * Connect both clients
   */
  async $connect() {
    await this.primary.$connect()
    if (this.readReplica) {
      await this.readReplica.$connect()
    }
  }

  /**
   * Disconnect both clients
   */
  async $disconnect() {
    await this.primary.$disconnect()
    if (this.readReplica) {
      await this.readReplica.$disconnect()
    }
  }

  /**
   * Health check for both connections
   */
  async healthCheck(): Promise<{ primary: boolean; replica: boolean }> {
    const results = { primary: false, replica: false }
    
    try {
      await this.primary.$queryRaw`SELECT 1`
      results.primary = true
    } catch {
      results.primary = false
    }

    if (this.readReplica) {
      try {
        await this.readReplica.$queryRaw`SELECT 1`
        results.replica = true
      } catch {
        results.replica = false
      }
    } else {
      results.replica = results.primary // Same as primary if no replica
    }

    return results
  }
}

// Singleton instance
const globalForPrisma = global as unknown as { 
  prisma: PrismaClientWithReplicas 
}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClientWithReplicas()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Backward-compatible default export
export const prismaClient = prisma.write
export default prismaClient
