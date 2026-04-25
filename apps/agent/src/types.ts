export interface AgentConfig {
  PORT: number;
  NODE_ID: string;
  NODE_NAME: string;
  NODE_LOCATION: string;
  ORCHESTRATOR_URL: string;
  API_KEY?: string;
  REQUIRE_API_KEY: boolean;
  ENABLE_MTLS: boolean;
  TLS_CERT_PATH: string;
  TLS_KEY_PATH: string;
  TLS_CA_PATH: string;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
  REQUEST_SIGNATURE_SECRET: string;
  CORS_ORIGINS: string[];
  DOCKER_HOST?: string;
  DOCKER_TLS_CA?: string;
  DOCKER_TLS_CERT?: string;
  DOCKER_TLS_KEY?: string;
  IMAGE_ALLOWLIST_REGEX: string;
}

export interface TaskPayload {
  taskId: string;
  image: string;
  command?: string | string[];
  env?: Record<string, string>;
  resources?: {
    cpu?: number;
    memory?: string; // e.g. "512m"
  };
  network?: 'none' | 'bridge' | 'host';
  maxDurationSeconds?: number; // Task timeout in seconds (default: 3600)
}

export interface ExecutionResult {
  taskId: string;
  status: 'completed' | 'failed' | 'timeout' | 'killed';
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  executionTime: number;
  error?: string;
}

export interface NodeStats {
  cpuUsage: number;
  memoryUsage: number;
  totalMemory: number;
  tasksRunning: number;
  tasksCompleted: number;
  tasksFailed: number;
  uptime: number;
  startTime: number;
}
