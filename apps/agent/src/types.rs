use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum TaskRuntime {
    Docker,
    Wasm,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskSpec {
    pub task_id: String,
    pub runtime: TaskRuntime,
    pub image: String,
    pub wasm_artifact_id: Option<String>,
    pub input: serde_json::Value,
    pub memory_limit_mb: u32,
    pub cpu_fuel: Option<u64>,
    pub timeout_seconds: u32,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecutionResult {
    pub task_id: String,
    pub status: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub error: Option<String>,
}
