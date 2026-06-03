use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use anyhow::{Context, Result};
use tokio::sync::RwLock;
use wasmtime::*;
use wasmtime_wasi::tokio::WasiCtxBuilder;
use sha2::{Digest, Sha256};
use crate::types::{TaskSpec, ExecutionResult};
use metrics::{increment_counter, histogram};

pub struct WasmExecutor {
    engine: Engine,
    module_cache: Arc<RwLock<HashMap<String, (Module, Instant)>>>,
    client: reqwest::Client,
}

impl WasmExecutor {
    pub fn new() -> Result<Self> {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.async_support(true); // Enable async support for tokio integration
        
        let engine = Engine::new(&config)?;
        
        Ok(Self {
            engine,
            module_cache: Arc::new(RwLock::new(HashMap::new())),
            client: reqwest::Client::new(),
        })
    }

    pub async fn execute(&self, spec: &TaskSpec) -> Result<ExecutionResult> {
        let start_time = Instant::now();
        
        // 1. Download or retrieve cached .wasm binary
        let wasm_bytes = self.get_wasm_bytes(&spec.image).await?;
        let content_hash = self.calculate_hash(&wasm_bytes);
        
        // 2. Get or compile module
        let module = self.get_or_compile_module(&content_hash, &wasm_bytes).await?;
        
        // 3. Prepare WASI context using wasi_common pipes
        let mut wasi_builder = WasiCtxBuilder::new();
        
        // Pass task.input as JSON via WASI stdin
        let input_bytes = serde_json::to_vec(&spec.input)?;
        let stdin = wasi_common::pipe::ReadPipe::new(std::io::Cursor::new(input_bytes));
        wasi_builder.stdin(Box::new(stdin));
        
        // Capture stdout/stderr using memory pipes
        let stdout_pipe = wasi_common::pipe::WritePipe::new_in_memory();
        let stderr_pipe = wasi_common::pipe::WritePipe::new_in_memory();
        wasi_builder.stdout(Box::new(stdout_pipe.clone()));
        wasi_builder.stderr(Box::new(stderr_pipe.clone()));
        
        // No filesystem access by default
        // No network access from within WASM (wasmtime doesn't provide it by default)
        
        let wasi = wasi_builder.build();
        
        // 4. Instantiate with limits
        let mut store = Store::new(&self.engine, wasi);
        store.add_fuel(spec.cpu_fuel.unwrap_or(10_000_000_000))?;
        
        let mut linker = Linker::new(&self.engine);
        wasmtime_wasi::tokio::add_to_linker(&mut linker, |cx| cx)?;
        
        let instance = linker.instantiate_async(&mut store, &module).await?;
        let main = instance.get_typed_func::<(), ()>(&mut store, "_start")
            .context("failed to find _start function")?;

        // 5. Execution with timeout
        let timeout = Duration::from_secs(spec.timeout_seconds as u64);
        let execution_result = tokio::time::timeout(timeout, main.call_async(&mut store, ())).await;
        
        let duration = start_time.elapsed();
        histogram!("wasm_task_execution_duration_seconds", duration.as_secs_f64());
        
        // Drop store to release pipe references
        drop(store);
        
        let stdout_bytes = stdout_pipe.try_into_inner()
            .expect("sole remaining reference to stdout_pipe")
            .into_inner();
        let stderr_bytes = stderr_pipe.try_into_inner()
            .expect("sole remaining reference to stderr_pipe")
            .into_inner();
            
        let out = String::from_utf8_lossy(&stdout_bytes).to_string();
        let err = String::from_utf8_lossy(&stderr_bytes).to_string();
        
        match execution_result {
            Ok(Ok(_)) => {
                Ok(ExecutionResult {
                    task_id: spec.task_id.clone(),
                    status: "completed".to_string(),
                    exit_code: 0,
                    stdout: out,
                    stderr: err,
                    duration_ms: duration.as_millis() as u64,
                    error: None,
                })
            }
            Ok(Err(e)) => {
                let err_msg = e.to_string();
                Ok(ExecutionResult {
                    task_id: spec.task_id.clone(),
                    status: "failed".to_string(),
                    exit_code: 1,
                    stdout: out,
                    stderr: if err.is_empty() { err_msg.clone() } else { format!("{}\nError: {}", err, err_msg) },
                    duration_ms: duration.as_millis() as u64,
                    error: Some(err_msg),
                })
            }
            Err(_) => {
                Ok(ExecutionResult {
                    task_id: spec.task_id.clone(),
                    status: "timeout".to_string(),
                    exit_code: 137,
                    stdout: out,
                    stderr: if err.is_empty() { "Execution timed out".to_string() } else { format!("{}\nExecution timed out", err) },
                    duration_ms: duration.as_millis() as u64,
                    error: Some("Timeout".to_string()),
                })
            }
        }
    }

    async fn get_wasm_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let resp = self.client.get(url).send().await?;
        let bytes = resp.bytes().await?;
        Ok(bytes.to_vec())
    }

    fn calculate_hash(&self, bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hex::encode(hasher.finalize())
    }

    async fn get_or_compile_module(&self, hash: &str, bytes: &[u8]) -> Result<Module> {
        {
            let cache = self.module_cache.read().await;
            if let Some((module, _)) = cache.get(hash) {
                increment_counter!("wasm_module_cache_hits_total");
                return Ok(module.clone());
            }
        }

        let module = Module::new(&self.engine, bytes)?;
        
        let mut cache = self.module_cache.write().await;
        cache.insert(hash.to_string(), (module.clone(), Instant::now()));
        
        Ok(module)
    }

    pub async fn evict_stale_modules(&self) {
        let mut cache = self.module_cache.write().await;
        let now = Instant::now();
        cache.retain(|_, (_, last_used)| {
            now.duration_since(*last_used) < Duration::from_secs(3600)
        });
    }
}

