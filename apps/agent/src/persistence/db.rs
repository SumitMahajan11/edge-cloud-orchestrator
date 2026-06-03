use anyhow::Result;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use chrono::Utc;
use crate::types::{TaskSpec, ExecutionResult};
use serde_json;

pub struct DatabaseManager {
    pub pool: SqlitePool,
    db_path: std::path::PathBuf,
}

impl DatabaseManager {
    pub async fn new(db_path: &std::path::Path) -> Result<Self> {
        let options = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true);

        let pool = SqlitePool::connect_with(options).await?;
        let manager = Self { 
            pool,
            db_path: db_path.to_path_buf(),
        };
        manager.initialize().await?;
        Ok(manager)
    }

    async fn initialize(&self) -> Result<()> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS pending_tasks (
                id TEXT PRIMARY KEY,
                spec TEXT NOT NULL,
                assigned_at INTEGER NOT NULL,
                status TEXT NOT NULL,
                attempt_count INTEGER DEFAULT 0,
                result TEXT,
                synced INTEGER DEFAULT 0
            )"
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS heartbeat_buffer (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                sent INTEGER DEFAULT 0
            )"
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn save_task(&self, spec: &TaskSpec) -> Result<()> {
        let spec_json = serde_json::to_string(spec)?;
        sqlx::query(
            "INSERT OR REPLACE INTO pending_tasks (id, spec, assigned_at, status, synced) 
             VALUES (?, ?, ?, ?, 0)"
        )
        .bind(&spec.task_id)
        .bind(spec_json)
        .bind(Utc::now().timestamp())
        .bind("PENDING")
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_task_status(&self, task_id: &str, status: &str) -> Result<()> {
        sqlx::query("UPDATE pending_tasks SET status = ? WHERE id = ?")
            .bind(status)
            .bind(task_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn save_task_result(&self, result: &ExecutionResult) -> Result<()> {
        let result_json = serde_json::to_string(result)?;
        sqlx::query(
            "UPDATE pending_tasks SET status = ?, result = ?, synced = 0 WHERE id = ?"
        )
        .bind(&result.status)
        .bind(result_json)
        .bind(&result.task_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_task_synced(&self, task_id: &str) -> Result<()> {
        sqlx::query("UPDATE pending_tasks SET synced = 1 WHERE id = ?")
            .bind(task_id)
            .bind(sqlx::types::chrono::Utc::now().timestamp())
            .execute(&self.pool)
            .await?;
        // Wait, the schema doesn't have synced_at. I'll just set synced=1.
        Ok(())
    }

    pub async fn get_unsynced_results(&self) -> Result<Vec<ExecutionResult>> {
        let rows = sqlx::query(
            "SELECT result FROM pending_tasks WHERE synced = 0 AND status IN ('completed', 'failed', 'timeout')"
        )
        .fetch_all(&self.pool)
        .await?;

        let mut results = Vec::new();
        for row in rows {
            let result_json: String = sqlx::Row::get(&row, 0);
            if let Ok(res) = serde_json::from_str(&result_json) {
                results.push(res);
            }
        }
        Ok(results)
    }

    pub async fn buffer_heartbeat(&self, payload: &serde_json::Value) -> Result<()> {
        let payload_json = serde_json::to_string(payload)?;
        
        // Limit buffer to 500 entries
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM heartbeat_buffer WHERE sent = 0")
            .fetch_one(&self.pool)
            .await?;

        if count >= 500 {
            // Delete oldest unsent
            sqlx::query("DELETE FROM heartbeat_buffer WHERE id IN (SELECT id FROM heartbeat_buffer WHERE sent = 0 ORDER BY created_at ASC LIMIT 1)")
                .execute(&self.pool)
                .await?;
        }

        sqlx::query(
            "INSERT INTO heartbeat_buffer (payload, created_at, sent) VALUES (?, ?, 0)"
        )
        .bind(payload_json)
        .bind(Utc::now().timestamp())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_unsent_heartbeats(&self, limit: i32) -> Result<Vec<(i64, serde_json::Value)>> {
        let rows = sqlx::query(
            "SELECT id, payload FROM heartbeat_buffer WHERE sent = 0 ORDER BY created_at ASC LIMIT ?"
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        let mut heartbeats = Vec::new();
        for row in rows {
            let id: i64 = sqlx::Row::get(&row, 0);
            let payload_json: String = sqlx::Row::get(&row, 1);
            if let Ok(payload) = serde_json::from_str(&payload_json) {
                heartbeats.push((id, payload));
            }
        }
        Ok(heartbeats)
    }

    pub async fn mark_heartbeat_sent(&self, id: i64) -> Result<()> {
        sqlx::query("UPDATE heartbeat_buffer SET sent = 1 WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn recover_crashed_tasks(&self) -> Result<Vec<String>> {
        let rows = sqlx::query("SELECT id FROM pending_tasks WHERE status = 'RUNNING'")
            .fetch_all(&self.pool)
            .await?;

        let mut recovered_ids = Vec::new();
        for row in rows {
            let id: String = sqlx::Row::get(&row, 0);
            recovered_ids.push(id.clone());
            
            let result = ExecutionResult {
                task_id: id.clone(),
                status: "failed".to_string(),
                exit_code: 1,
                stdout: "".to_string(),
                stderr: "Agent crashed mid-execution".to_string(),
                duration_ms: 0,
                error: Some("agent_restart".to_string()),
            };
            let result_json = serde_json::to_string(&result)?;

            // Mark as failed locally
            sqlx::query("UPDATE pending_tasks SET status = 'failed', result = ?, synced = 0 WHERE id = ?")
                .bind(result_json)
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        Ok(recovered_ids)
    }

    pub async fn cleanup(&self) -> Result<()> {
        // Delete synced tasks older than 7 days
        let seven_days_ago = Utc::now().timestamp() - (7 * 24 * 3600);
        sqlx::query("DELETE FROM pending_tasks WHERE synced = 1 AND assigned_at < ?")
            .bind(seven_days_ago)
            .execute(&self.pool)
            .await?;

        // Delete sent heartbeats older than 24 hours
        let one_day_ago = Utc::now().timestamp() - (24 * 3600);
        sqlx::query("DELETE FROM heartbeat_buffer WHERE sent = 1 AND created_at < ?")
            .bind(one_day_ago)
            .execute(&self.pool)
            .await?;

        sqlx::query("VACUUM").execute(&self.pool).await?;

        // Log database size
        if let Ok(metadata) = std::fs::metadata(&self.db_path) {
            tracing::info!("Database maintenance complete. Current size: {} bytes", metadata.len());
        }

        Ok(())
    }
}
