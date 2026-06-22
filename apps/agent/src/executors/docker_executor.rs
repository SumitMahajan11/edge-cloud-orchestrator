use crate::types::{TaskSpec, ExecutionResult};
use anyhow::Result;
use metrics::histogram;

#[derive(Default)]
pub struct DockerExecutor;

impl DockerExecutor {
    pub fn new() -> Self {
        Self
    }

    pub async fn execute(&self, spec: &TaskSpec) -> Result<ExecutionResult> {
        histogram!("docker_task_cold_start_duration_seconds", 0.500);

        // Placeholder for Docker execution (existing behavior)
        Ok(ExecutionResult {
            task_id: spec.task_id.clone(),
            status: "completed".to_string(),
            exit_code: 0,
            stdout: "Docker task executed (mock)".to_string(),
            stderr: "".to_string(),
            duration_ms: 250,
            error: None,
        })
    }
}
