import { z } from "zod";
import { v1Contracts } from "@edgecloud/shared-kernel";

// Note: This file is a bridge between the TS schema and Rust types for documentation.
// The actual Rust implementation will use the types defined below.

export const TaskRuntimeSchema = z.enum(["Docker", "Wasm"]);

export const WasmTaskSpecSchema = z.object({
  imageUrl: z.string().url(),
  memoryLimitMb: z.number().int().min(1).max(256).default(64),
  timeoutSeconds: z.number().int().min(1).max(300).default(30),
  fuelLimit: z.number().int().default(10000000000),
});

export interface AgentConfig {
  PORT: number;
  NODE_ID: string;
  NODE_NAME: string;
  NODE_LOCATION: string;
  ORCHESTRATOR_URL: string;
  API_KEY?: string | undefined;
  REQUIRE_API_KEY: boolean;
  ENABLE_MTLS: boolean;
  TLS_CERT_PATH: string;
  TLS_KEY_PATH: string;
  TLS_CA_PATH: string;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
  REQUEST_SIGNATURE_SECRET: string;
  CORS_ORIGINS: string[];
  IMAGE_ALLOWLIST_REGEX: string;
  DOCKER_HOST?: string | undefined;
  DOCKER_TLS_CA?: string | undefined;
  DOCKER_TLS_CERT?: string | undefined;
  DOCKER_TLS_KEY?: string | undefined;
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

export interface TaskPayload {
  taskId: string;
  image: string;
  maxDurationSeconds?: number | undefined;
  env?: Record<string, string> | undefined;
  command?: string | string[] | undefined;
  resources?:
    | {
        memory?: string | undefined;
        cpu?: number | undefined;
      }
    | undefined;
  network?: string | undefined;
  input?: any;
  metadata?: any;
}

export interface ExecutionResult {
  taskId: string;
  status: "completed" | "failed" | "timeout";
  exitCode?: number | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  error?: string | undefined;
  executionTime: number;
}
