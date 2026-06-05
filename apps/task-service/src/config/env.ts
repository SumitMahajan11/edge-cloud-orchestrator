import "dotenv/config";
import { z } from "zod";
import { baseEnvSchema, validateEnv } from "@edgecloud/shared-kernel";

/**
 * Environment variables schema for the Task Service.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().default(26257),
  DATABASE_NAME: z.string().default("edgecloud"),
  DATABASE_USER: z.string().default("root"),
  DATABASE_PASSWORD: z.string().default(""),
  DATABASE_SSL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REDIS_SENTINELS: z.string().optional(),
  KAFKA_BROKERS: z.string().default("localhost:9092"),
  SERVICE_TOKEN: z.string().default("dev-service-token"),
  CORS_ORIGINS: z.string().default("*"),
});

export const env = validateEnv(envSchema);
export type Env = z.infer<typeof envSchema>;
