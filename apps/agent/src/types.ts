import { z } from 'zod';
import { TaskV1ResponseSchema, CreateTaskV1Schema } from '../api-contracts/v1/task';

// Note: This file is a bridge between the TS schema and Rust types for documentation.
// The actual Rust implementation will use the types defined below.

export const TaskRuntimeSchema = z.enum(['Docker', 'Wasm']);

export const WasmTaskSpecSchema = z.object({
  imageUrl: z.string().url(),
  memoryLimitMb: z.number().int().min(1).max(256).default(64),
  timeoutSeconds: z.number().int().min(1).max(300).default(30),
  fuelLimit: z.number().int().default(10000000000),
});

// Rust equivalents (using pseudo-rust for clarity in this turn)
/*
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum TaskRuntime {
    Docker,
    Wasm,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskSpec {
    pub id: String,
    pub runtime: TaskRuntime,
    pub image: String, // URL for WASM or image name for Docker
    pub input: serde_json::Value,
    pub resources: Resources,
    pub timeout_seconds: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Resources {
    pub memory_mb: u32,
    pub cpu_cores: f32,
}
*/
