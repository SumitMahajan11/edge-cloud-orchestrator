import { Prisma } from '@prisma/client';

/**
 * Checks if an error is a Prisma connection error (network or auth failures).
 */
export function isPrismaConnectionError(e: any): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  
  // P1000: Authentication failed
  // P1001: Can't reach database server
  // P1002: Database server timed out
  // P1008: Operations timed out (can be connection related)
  // P1017: Server has closed the connection
  const connectionCodes = ['P1000', 'P1001', 'P1002', 'P1008', 'P1017'];
  return connectionCodes.includes(e.code);
}

/**
 * Checks if an error is a Prisma query timeout error.
 */
export function isPrismaTimeoutError(e: any): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError && e.message.includes('timed out')) {
    return true;
  }
  
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  // P2024: Timed out fetching a new connection from the pool
  return e.code === 'P2024' || e.message.toLowerCase().includes('timeout');
}

/**
 * Checks if an error is due to Prisma connection pool exhaustion.
 */
export function isPrismaPoolExhausted(e: any): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  // P2024: Timed out fetching a new connection from the pool
  return e.code === 'P2024';
}

/**
 * Checks if an error is a Prisma P2025 "Record not found" error.
 */
export function isPrismaNotFound(e: any): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return e.code === 'P2025';
}

/**
 * Checks if an error is a Prisma P2002 "Unique constraint violation" error (Conflict).
 */
export function isPrismaConflict(e: any): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return e.code === 'P2002';
}
