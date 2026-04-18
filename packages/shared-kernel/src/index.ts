// Domain models
export * from './domain/node';
export * from './domain/task';

// Telemetry
export * from './telemetry';
export * from './telemetry/propagation';

/**
 * Get unified request headers for outgoing calls (OTel + Correlation ID)
 */
export function getRequestHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const { injectTraceHeaders } = require('./telemetry/propagation');
  const { getRequestId } = require('./logger/context');
  
  const headers = injectTraceHeaders(extraHeaders);
  const requestId = getRequestId();
  
  if (requestId) {
    headers['x-request-id'] = requestId;
  }
  
  return headers;
}

// Domain logic
export * from './domain/scheduler';
export * from './domain/recovery';
export * from './domain/backpressure';

// Leader Election
export * from './leader-election';

// Types
export * from './types/domain';

// Events
export * from './events/domain-events';

// Utilities
export * from './utils/id-generator';
export * from './utils/validation';
export * from './utils/secrets-validation';

// Secrets Management
export * from './secrets/SecretManager';
export * from './secrets/SecretManagerFactory';

// Middleware
export * from './middleware/auth';

// Constants
export const REGIONS = ['us-east', 'us-west', 'eu', 'apac'] as const;
export type Region = typeof REGIONS[number];

export const REDIS_CHANNELS = {
  NODE_HEARTBEAT: 'node:heartbeat',
  TASK_UPDATES: 'task:updates',
} as const;

export const NODE_OFFLINE_THRESHOLD_MS = 30000;
export const NODE_STALE_THRESHOLD_MS = 15000;

export const RAFT_DEFAULTS = {
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  maxLogEntriesPerRequest: 100,
} as const;

// API Contracts
export * as v1Contracts from './api-contracts/v1/task';
export * as v1NodeContracts from './api-contracts/v1/node';

// Version
export const VERSION = '2.0.0';

// Logging
export * from './logger/index';
export * from './logger/context';
export * from './logger/fastify-plugin';
export * from './logger/express-middleware';

// Lifecycle
export * from './lifecycle/shutdown';
export * from './lifecycle/health';

