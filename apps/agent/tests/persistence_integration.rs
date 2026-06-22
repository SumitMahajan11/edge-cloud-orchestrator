use anyhow::Result;
use edge_agent::persistence::DatabaseManager;
use edge_agent::types::{TaskSpec, TaskRuntime, ExecutionResult};
use tempfile::tempdir;
use serde_json::json;

#[tokio::test]
async fn test_task_persistence_and_sync() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("test_agent.db");
    let db = DatabaseManager::new(&db_path).await?;

    let spec = TaskSpec {
        task_id: "task-1".to_string(),
        runtime: TaskRuntime::Wasm,
        image: "test.wasm".to_string(),
        wasm_artifact_id: None,
        input: json!({"val": 1}),
        memory_limit_mb: 128,
        cpu_fuel: None,
        timeout_seconds: 30,
        trace_id: None,
        span_id: None,
    };

    // 1. Save task
    db.save_task(&spec).await?;
    db.update_task_status("task-1", "RUNNING").await?;

    // 2. Save result
    let result = ExecutionResult {
        task_id: "task-1".to_string(),
        status: "completed".to_string(),
        exit_code: 0,
        stdout: "done".to_string(),
        stderr: "".to_string(),
        duration_ms: 100,
        error: None,
    };
    db.save_task_result(&result).await?;

    // 3. Verify unsynced
    let unsynced = db.get_unsynced_results().await?;
    assert_eq!(unsynced.len(), 1);
    assert_eq!(unsynced[0].task_id, "task-1");

    // 4. Mark synced
    db.mark_task_synced("task-1").await?;
    let unsynced_after = db.get_unsynced_results().await?;
    assert_eq!(unsynced_after.len(), 0);

    Ok(())
}

#[tokio::test]
async fn test_heartbeat_buffering() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("test_heartbeat.db");
    let db = DatabaseManager::new(&db_path).await?;

    // Buffer 5 heartbeats
    for i in 0..5 {
        db.buffer_heartbeat(&json!({"seq": i})).await?;
    }

    // Verify buffer
    let buffered = db.get_unsent_heartbeats(10).await?;
    assert_eq!(buffered.len(), 5);
    assert_eq!(buffered[0].1["seq"], 0);

    // Mark one as sent
    db.mark_heartbeat_sent(buffered[0].0).await?;
    let buffered_after = db.get_unsent_heartbeats(10).await?;
    assert_eq!(buffered_after.len(), 4);
    assert_eq!(buffered_after[0].1["seq"], 1);

    Ok(())
}

#[tokio::test]
async fn test_crash_recovery() -> Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("test_crash.db");
    
    // Setup: Simulate a task that was RUNNING when agent stopped
    {
        let db = DatabaseManager::new(&db_path).await?;
        let spec = TaskSpec {
            task_id: "crashed-task".to_string(),
            runtime: TaskRuntime::Wasm,
            image: "test.wasm".to_string(),
            wasm_artifact_id: None,
            input: json!({}),
            memory_limit_mb: 128,
            cpu_fuel: None,
            timeout_seconds: 30,
            trace_id: None,
            span_id: None,
        };
        db.save_task(&spec).await?;
        db.update_task_status("crashed-task", "RUNNING").await?;
    }

    // Restart and recover
    let db = DatabaseManager::new(&db_path).await?;
    let recovered = db.recover_crashed_tasks().await?;
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0], "crashed-task");

    // Verify it's now unsynced and marked as failed
    let unsynced = db.get_unsynced_results().await?;
    assert_eq!(unsynced.len(), 1);
    assert_eq!(unsynced[0].task_id, "crashed-task");
    assert_eq!(unsynced[0].status, "failed");
    assert_eq!(unsynced[0].error, Some("agent_restart".to_string()));

    Ok(())
}
