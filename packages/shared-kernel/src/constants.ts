export const VERSION = '2.0.0';

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

export const SCHEDULER_CONSTANTS = {
  DEFAULT_INTERVAL_MS: 5000,
  TASK_TIMEOUT_MS: 300000, // 5 minutes
  REDIS_KEY_TTL_SEC: 86400, // 24 hours
  REQUEST_TIMEOUT_MS: 30000, // 30 seconds
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_MS: 60000,
  LEADER_LOCK_TTL_MS: 10000,
  LEADER_LOCK_KEY: 'scheduler:leader:lock',
  HEALER_LOCK_KEY: 'healer:leader:lock',
} as const;

export const API_CONSTANTS = {
  PLUGIN_TIMEOUT_MS: 30000,
  BODY_LIMIT_BYTES: 10 * 1024 * 1024, // 10MB
} as const;
