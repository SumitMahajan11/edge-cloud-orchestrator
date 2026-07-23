import 'dotenv/config';
import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@edgecloud/shared-kernel';

/**
 * Environment variables schema for the Orchestrator API.
 * This schema defines all required and optional environment variables
 * and enforces strict type-safety and format validation at startup.
 */
const envSchema = baseEnvSchema.extend({
  // --- Core Node Settings ---
  PORT: z.coerce.number().int().min(1024).max(65535).default(3090),
  HOST: z.string().default('0.0.0.0'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  TRUST_PROXY: z.string().optional(),

  // --- Database Configuration ---
  DATABASE_URL: z.string(),
  DATABASE_READ_URL: z.string().optional(),
  FORCE_MOCK_DB: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // --- Redis & Messaging ---
  REDIS_URL: z.string().url().optional(),
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_NAME: z.string().default('mymaster'),
  REDIS_PASSWORD: z.string().optional(),
  FORCE_MOCK_REDIS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  KAFKA_BROKERS: z.string().default('localhost:9092'),

  // --- Authentication & Security ---
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('edge-cloud-orchestrator'),
  JWT_AUDIENCE: z.string().default('edge-cloud-clients'),
  ENCRYPTION_KEY: z
    .string()
    .min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
  REQUEST_SIGNATURE_SECRET: z
    .string()
    .min(32, 'REQUEST_SIGNATURE_SECRET must be at least 32 characters')
    .default('your-agent-signature-secret-minimum-32-chars'),


  // --- Rate Limiting & Auth Policy ---
  MAX_LOGIN_ATTEMPTS: z.coerce.number().default(5),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().default(15),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),

  // --- Scheduler ---
  SCHEDULER_POLL_INTERVAL_MS: z.coerce.number().default(2000),

  // --- Networking & CORS ---
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://localhost:3000,https://edge-cloud-orchestrator-web-swart.vercel.app,*.vercel.app',
    ),

  // --- Monitoring & Telemetry ---
  METRICS_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  OTEL_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  OTEL_DEBUG: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  OTEL_SERVICE_NAME: z.string().default('edge-cloud-orchestrator'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .default('http://localhost:4317'),
  JAEGER_ENDPOINT: z
    .string()
    .url()
    .default('http://localhost:14268/api/traces'),

  // --- mTLS Configuration ---
  MTLS_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  MTLS_SERVER_CERT: z.string().optional().default('/etc/edgecloud/server.crt'),
  MTLS_SERVER_KEY: z.string().optional().default('/etc/edgecloud/server.key'),
  MTLS_CA_CERT: z.string().optional(),
  TRUST_X_CLIENT_CERT: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // --- External Integrations ---
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO_OWNER: z.string().optional(),
  GITHUB_REPO_NAME: z.string().optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_THROTTLE_MS: z.coerce.number().default(60000),
  ELECTRICITY_MAPS_API_KEY: z.string().optional(),

  // --- Orchestrator Specific ---
  SCHEDULING_INTERVAL: z.coerce.number().default(5000),
  APP_VERSION: z.string().default('4.0.0'),
  KUBECONFIG: z.string().optional(),
  ML_MODEL_MIN_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('1.0.0'),

  // --- AutoHealer Configuration ---
  HEALER_COOLDOWN_MS: z.coerce.number().default(60000),
  HEALER_MAX_CONCURRENT: z.coerce.number().default(5),
  HEALER_K8S_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  HEALER_K8S_NAMESPACE: z.string().default('default'),
  PROMETHEUS_URL: z.string().url().default('http://prometheus:9090'),

  // --- Backpressure Configuration ---
  BP_MAX_QUEUE: z.coerce.number().default(1000),
  BP_MAX_CONCURRENT: z.coerce.number().default(100),
  BP_SHED_THRESHOLD: z.coerce.number().default(0.9),
  BP_THROTTLE_THRESHOLD: z.coerce.number().default(0.7),

  // --- Secret Management (Optional backend) ---
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  SECRET_BACKEND: z.enum(['env', 'vault', 'k8s']).default('env'),

  // --- OpenAPI Generation ---
  GEN_OPENAPI: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  EXIT_AFTER_GEN: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // --- Seed Data ---
  ADMIN_PASSWORD: z.string().optional(),
  OPERATOR_PASSWORD: z.string().optional(),
  VIEWER_PASSWORD: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_OPERATOR_PASSWORD: z.string().optional(),
  SEED_VIEWER_PASSWORD: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@edge-cloud.io'),
  SEED_OPERATOR_EMAIL: z.string().email().default('operator@edge-cloud.io'),
  SEED_VIEWER_EMAIL: z.string().email().default('viewer@edge-cloud.io'),
  ENABLE_DEMO_CREDENTIALS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  ENABLE_DEMO_AGENT: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),


  // --- Test ---
  VITEST: z.string().optional(),
  RUN_INTEGRATION_TESTS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
});

/**
 * Validate process.env against the schema.
 * Throws and exits if validation fails.
 */
export const env = validateEnv(envSchema);
export type Env = z.infer<typeof envSchema>;

