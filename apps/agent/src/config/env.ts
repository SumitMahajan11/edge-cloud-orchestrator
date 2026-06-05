import dotenv from "dotenv";
import path from "path";
import fs from "fs";

const localEnvPath = path.resolve(process.cwd(), ".env");
const rootEnvPath = path.resolve(process.cwd(), "../../.env");

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

import { z } from "zod";
import { baseEnvSchema, validateEnv } from "@edgecloud/shared-kernel";

/**
 * Environment variables schema for the Edge Agent.
 * Ensures all required variables for node identification and orchestrator
 * communication are present and correctly formatted.
 */
const envSchema = baseEnvSchema.extend({
  // --- Node Identity ---
  NODE_ID: z.string().min(1, "NODE_ID is required"),
  NODE_NAME: z.string().default("Edge Node"),
  NODE_LOCATION: z.string().default("Local"),

  // --- Network Configuration ---
  PORT: z.coerce.number().int().min(1024).max(65535).default(4001),
  ORCHESTRATOR_URL: z.string().url("ORCHESTRATOR_URL must be a valid URL"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:3000"),

  // --- Security & Auth ---
  API_KEY: z.string().optional(),
  REQUIRE_API_KEY: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  REQUEST_SIGNATURE_SECRET: z
    .string()
    .min(1, "REQUEST_SIGNATURE_SECRET is required"),

  // --- mTLS Configuration ---
  ENABLE_MTLS: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  TLS_CERT_PATH: z.string().default("./certs/server.crt"),
  TLS_KEY_PATH: z.string().default("./certs/server.key"),
  TLS_CA_PATH: z.string().default("./certs/ca.crt"),

  // --- Performance & Limits ---
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  IMAGE_ALLOWLIST_REGEX: z
    .string()
    .default("^[^:]+(?::(?!latest)[a-zA-Z0-9._-]+)?$"),

  // --- Infrastructure ---
  DOCKER_HOST: z.string().optional(),
});

/**
 * Validate process.env against the schema.
 * Throws and exits if validation fails.
 */
export const env = validateEnv(envSchema);
export type Env = z.infer<typeof envSchema>;
