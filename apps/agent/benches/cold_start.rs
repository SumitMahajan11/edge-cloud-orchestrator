use criterion::{criterion_group, criterion_main, Criterion};
use edge_agent::executors::wasm_executor::WasmExecutor;
use edge_agent::types::{TaskSpec, TaskRuntime};
use tokio::runtime::Runtime;

async fn bench_wasm_cold_start(executor: &WasmExecutor, spec: &TaskSpec) {
    let _ = executor.execute(spec).await.unwrap();
}

fn criterion_benchmark(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let executor = rt.block_on(async { WasmExecutor::new().unwrap() });
    
    let spec = TaskSpec {
        task_id: "bench-task".to_string(),
        runtime: TaskRuntime::Wasm,
        image: "https://mock-s3.local/test.wasm".to_string(), // In bench, we should mock the download
        input: serde_json::json!({"test": true}),
        memory_limit_mb: 64,
        cpu_fuel: Some(1_000_000),
        timeout_seconds: 5,
    };

    c.bench_function("wasm_cold_start", |b| {
        b.to_async(&rt).iter(|| bench_wasm_cold_start(&executor, &spec));
    });
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
