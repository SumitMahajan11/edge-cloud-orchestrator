// Domain models
export * from './domain/task';
export * from './domain/node';

// Events
export * from './events/domain-events';

// Utilities
export * from './utils/id-generator';
export * from './utils/validation';

// Middleware
export * from './middleware/auth';

// Constants
export const REGIONS = ['us-east', 'us-west', 'eu', 'apac'] as const;
export type Region = typeof REGIONS[number];

export const DEFAULT_SCORE_WEIGHTS = {
  latency: 0.20,
  cpu: 0.15,
  memory: 0.15,
  cost: 0.10,
  network: 0.10,
  ml: 0.15,
  health: 0.15,
} as const;

export const RAFT_DEFAULTS = {
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  maxLogEntriesPerRequest: 100,
} as const;

// Version
export const VERSION = '2.0.0';
