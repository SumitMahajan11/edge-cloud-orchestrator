import 'dotenv/config';
import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@edgecloud/shared-kernel';

/**
 * Environment variables schema for the Node Service.
 */
const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3002),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_HOST: z.string().optional(),
  DATABASE_PORT: z.coerce.number().default(26257),
  DATABASE_NAME: z.string().default('edgecloud'),
  DATABASE_USER: z.string().default('root'),
  DATABASE_PASSWORD: z.string().default(''),
  REDIS_URL: z.string().url().optional(),
  REDIS_SENTINELS: z.string().optional(),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  SERVICE_TOKEN: z.string().default('dev-service-token'),
  CORS_ORIGINS: z.string().default('*'),
});

export const env = validateEnv(envSchema);
export type Env = z.infer<typeof envSchema>;
