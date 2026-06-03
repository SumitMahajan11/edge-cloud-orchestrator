use anyhow::Result;
use std::sync::Arc;
use std::time::{Instant};
use tokio::time::{self, Duration};
use tracing::{info, error, warn};
use chrono::Utc;
use crate::persistence::DatabaseManager;
use crate::transport::client::MTlsClient;
use crate::executors::wasm_executor::WasmExecutor;
use crate::types::{TaskSpec, ExecutionResult};
use crate::metrics::SystemMetrics;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Agent {
    db: Arc<DatabaseManager>,
    transport: Arc<MTlsClient>,
    wasm_executor: Arc<WasmExecutor>,
    last_contact: Arc<tokio::sync::RwLock<Option<Instant>>>,
    metrics: Arc<Mutex<SystemMetrics>>,
}

impl Agent {
    pub fn new(db: Arc<DatabaseManager>, transport: Arc<MTlsClient>) -> Result<Self> {
        Ok(Self {
            db,
            transport,
            wasm_executor: Arc::new(WasmExecutor::new()?),
            last_contact: Arc::new(tokio::sync::RwLock::new(Some(Instant::now()))),
            metrics: Arc::new(Mutex::new(SystemMetrics::new())),
        })
    }

    pub async fn run(&self) -> Result<()> {
        info!("Starting agent main loop and daemons...");

        // 1. Recover crashed tasks
        self.handle_recovery().await?;

        // 2. Spawn Sync Daemon
        let db_sync = self.db.clone();
        let transport_sync = self.transport.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if let Err(e) = Self::sync_unsynced_results(&db_sync, &transport_sync).await {
                    error!("Sync daemon error: {}", e);
                }
                if let Err(e) = Self::flush_heartbeat_buffer(&db_sync, &transport_sync).await {
                    error!("Heartbeat flush error: {}", e);
                }
            }
        });

        // 3. Spawn Heartbeat Loop
        let db_hb = self.db.clone();
        let transport_hb = self.transport.clone();
        let last_contact_hb = self.last_contact.clone();
        let metrics_hb = self.metrics.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(5));
            let mut metrics_unavailable_warned = false;
            let pid = sysinfo::get_current_pid().expect("Failed to get current PID");

            loop {
                interval.tick().await;
                
                let mut metrics = metrics_hb.lock().await;
                metrics.refresh();

                let cpu_usage = metrics.cpu_usage_percent();
                let mem_used_bytes = metrics.memory_used_bytes();
                let mem_total_bytes = metrics.memory_total_bytes();
                let disk_used_bytes = metrics.disk_used_bytes();
                let load_avg = metrics.load_average_1m();

                // Process-level metrics for the agent itself
                let (agent_cpu, agent_mem_bytes) = metrics.get_process_metrics(pid);

                let metrics_unavailable = if mem_total_bytes == 0 { 1 } else { 0 };
                if metrics_unavailable == 1 && !metrics_unavailable_warned {
                    warn!("sysinfo cannot read CPU metrics in this environment — using 0.0. Set CAP_SYS_PTRACE or run with host PID namespace");
                    metrics_unavailable_warned = true;
                }

                let heartbeat = serde_json::json!({
                    "timestamp": Utc::now().timestamp(),
                    "status": "online",
                    "metrics": {
                        "cpu_usage": cpu_usage,
                        "memory_used_mb": mem_used_bytes / 1_048_576,
                        "memory_total_mb": mem_total_bytes / 1_048_576,
                        "disk_used_gb": disk_used_bytes / 1_073_741_824,
                        "load_average": load_avg,
                        "agent_process_cpu": agent_cpu,
                        "agent_process_memory_mb": agent_mem_bytes / 1_048_576,
                        "agent_metrics_unavailable": metrics_unavailable,
                    }
                });

                if transport_hb.send_heartbeat(&heartbeat).await.is_ok() {
                    let mut lc = last_contact_hb.write().await;
                    *lc = Some(Instant::now());
                } else {
                    if let Err(e) = db_hb.buffer_heartbeat(&heartbeat).await {
                        error!("Failed to buffer heartbeat: {}", e);
                    }
                }
            }
        });

        // 4. Spawn Maintenance Daemon
        let db_maint = self.db.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(86400)); // 24 hours
            loop {
                interval.tick().await;
                info!("Running daily database maintenance...");
                if let Err(e) = db_maint.cleanup().await {
                    error!("Maintenance daemon error: {}", e);
                }
            }
        });

        // 5. Main Task Receiver Loop
        info!("Starting task receiver loop...");
        let mut interval = time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            
            match self.transport.get_pending_task().await {
                Ok(Some(task)) => {
                    info!("Received task assignment: {}", task.task_id);
                    let agent = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = agent.handle_task_assignment(task).await {
                            error!("Task execution failed: {}", e);
                        }
                    });
                }
                Ok(None) => {
                    // No tasks pending
                }
                Err(e) => {
                    error!("Failed to poll for tasks: {}", e);
                }
            }
        }
    }

    async fn handle_recovery(&self) -> Result<()> {
        let crashed_ids = self.db.recover_crashed_tasks().await?;
        if !crashed_ids.is_empty() {
            warn!("Recovered {} crashed tasks. Marked as FAILED.", crashed_ids.len());
        }
        Ok(())
    }

    pub async fn handle_task_assignment(&self, spec: TaskSpec) -> Result<()> {
        use crate::telemetry::get_parent_context;
        use tracing_opentelemetry::OpenTelemetrySpanExt;

        let parent_cx = get_parent_context(spec.trace_id.clone(), spec.span_id.clone());
        let span = tracing::info_span!("agent:execute_task", task_id = %spec.task_id);
        span.set_parent(parent_cx);
        
        let _enter = span.enter();
        
        info!("Processing task assignment: {}", spec.task_id);
        
        // a. Persist BEFORE execution
        self.db.save_task(&spec).await?;
        self.db.update_task_status(&spec.task_id, "RUNNING").await?;

        // b. Execute
        let result = self.wasm_executor.execute(&spec).await?;

        // c. Update local DB
        self.db.save_task_result(&result).await?;

        // d. Attempt to report
        if let Err(e) = self.transport.report_task_result(&result).await {
            warn!("Failed to report result for task {}: {}. Will retry in background.", spec.task_id, e);
        } else {
            self.db.mark_task_synced(&spec.task_id).await?;
            info!("Successfully reported result for task {}", spec.task_id);
        }

        Ok(())
    }

    pub async fn send_heartbeat(&self, payload: serde_json::Value) -> Result<()> {
        if let Err(e) = self.transport.send_heartbeat(&payload).await {
            warn!("Control plane unreachable, buffering heartbeat: {}", e);
            self.db.buffer_heartbeat(&payload).await?;
        }
        Ok(())
    }

    async fn sync_unsynced_results(db: &DatabaseManager, transport: &MTlsClient) -> Result<()> {
        let rows = sqlx::query(
            "SELECT id, result, assigned_at FROM pending_tasks WHERE synced = 0 AND status IN ('completed', 'failed', 'timeout')"
        )
        .fetch_all(&db.pool)
        .await?;

        if rows.is_empty() {
            return Ok(());
        }

        info!("Syncing {} unsynced task results...", rows.len());
        let now = Utc::now().timestamp();

        for row in rows {
            let task_id: String = sqlx::Row::get(&row, 0);
            let result_json: String = sqlx::Row::get(&row, 1);
            let assigned_at: i64 = sqlx::Row::get(&row, 2);

            if let Ok(result) = serde_json::from_str::<ExecutionResult>(&result_json) {
                if transport.report_task_result(&result).await.is_ok() {
                    db.mark_task_synced(&task_id).await?;
                } else {
                    // Escalation check
                    if now - assigned_at > 3600 {
                        error!("CRITICAL: Task {} has been unsynced for > 1 hour!", task_id);
                    }
                }
            }
        }
        Ok(())
    }

    async fn flush_heartbeat_buffer(db: &DatabaseManager, transport: &MTlsClient) -> Result<()> {
        let buffered = db.get_unsent_heartbeats(50).await?;
        if buffered.is_empty() {
            return Ok(());
        }

        // Get the oldest heartbeat timestamp to estimate outage start
        let first_hb_time = sqlx::query_scalar::<_, i64>("SELECT created_at FROM heartbeat_buffer WHERE sent = 0 ORDER BY created_at ASC LIMIT 1")
            .fetch_one(&db.pool)
            .await
            .unwrap_or_else(|_| Utc::now().timestamp());
        
        let outage_duration = Utc::now().timestamp() - first_hb_time;
        warn!("Network outage detected! Reconnected after {} seconds. Flushing {} buffered heartbeats...", outage_duration, buffered.len());

        for (id, payload) in buffered {
            if transport.send_heartbeat(&payload).await.is_ok() {
                db.mark_heartbeat_sent(id).await?;
                // Throttle as per requirements: 10 per second
                tokio::time::sleep(Duration::from_millis(100)).await;
            } else {
                break; // Stop flushing if still unreachable
            }
        }
        Ok(())
    }
}
