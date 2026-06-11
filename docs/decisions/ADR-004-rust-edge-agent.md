# ADR-004: Implement edge agent in Rust instead of Go or Node.js
Date: 2026-06-11
Status: Accepted

## Context
The edge agent runs on resource-constrained hardware (Raspberry Pi, industrial controllers, cheap VPS). It must have minimal memory footprint, no runtime dependencies, and safe concurrent metric collection.

## Decision
Rust with Tokio async runtime, compiled to a single static binary.

## Consequences
+ Single static binary under 10MB — no runtime required on edge node
+ Memory safety guarantees without GC pauses
+ Near-zero idle memory footprint (~5MB RSS)
+ First-class WASM toolchain (wasm-pack) for future WASM runtime
+ mTLS with rustls — no OpenSSL dependency
- Longer initial development time vs Go or Node.js
- Smaller contributor pool than Go
- Compilation times slower than Go (mitigated by incremental builds)
