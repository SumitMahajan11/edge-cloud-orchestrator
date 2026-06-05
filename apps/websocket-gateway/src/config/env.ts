import "dotenv/config";
import { z } from "zod";
import { baseEnvSchema, validateEnv } from "@edgecloud/shared-kernel";

/**
 * Environment variables schema for the WebSocket Gateway.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3004),
  HEARTBEAT_INTERVAL: z.coerce.number().default(30000),
  RECONNECT_BACKOFF_BASE: z.coerce.number().default(1000),
  RECONNECT_BACKOFF_MAX: z.coerce.number().default(30000),
  NODE_SERVICE_URL: z.string().url().default("http://localhost:3001"),
  SERVICE_TOKEN: z.string().default("internal-default"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:3000"),
});

export const env = validateEnv(envSchema);
export type Env = z.infer<typeof envSchema>;
