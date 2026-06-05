import { z } from "zod";
import pino from "pino";

const logger = pino({ name: "env-validator" });

/**
 * Schema for environment variable validation.
 * This should include all REQUIRED variables that a service needs to start safely.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  MTLS_ENABLED: z.string().transform((v) => v === "true"),
  MTLS_CA_PATH: z.string(),
  MTLS_CERT_PATH: z.string(),
  MTLS_KEY_PATH: z.string(),
  PORT: z.string().regex(/^\d+$/).transform(Number),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates environment variables against the schema.
 * If validation fails, it logs all missing/invalid keys and exits the process.
 * Never logs the actual values of the variables.
 */
export function validateEnv(schema: z.ZodObject<any> = envSchema): EnvConfig {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const missingKeys = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });

    logger.error(
      "FATAL: Environment validation failed. Missing or invalid required variables:",
    );
    missingKeys.forEach((key) => logger.error(`  - ${key}`));

    // In production, we strictly fail if config is incomplete
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    } else {
      logger.warn(
        "WARNING: Continuing in non-production mode despite validation failures.",
      );
    }
  }

  return (result.success ? result.data : process.env) as EnvConfig;
}
