import "dotenv/config";
import { z } from "zod";
import { baseEnvSchema, validateEnv } from "@edgecloud/shared-kernel";

/**
 * Environment variables schema for the Metrics Service.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3005),
  API_URL: z.string().url().default("http://api:3000"),
  TASK_SERVICE_URL: z.string().url().default("http://task-service:3001"),
  NODE_SERVICE_URL: z.string().url().default("http://node-service:3002"),
  SCHEDULER_SERVICE_URL: z
    .string()
    .url()
    .default("http://scheduler-service:3003"),
  WEBSOCKET_GATEWAY_URL: z
    .string()
    .url()
    .default("http://websocket-gateway:3004"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
});

export const env = validateEnv(envSchema);
export type Env = z.infer<typeof envSchema>;
