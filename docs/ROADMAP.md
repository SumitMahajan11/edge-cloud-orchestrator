# Edge-Cloud Orchestrator Roadmap

This document outlines the future development path for the Edge-Cloud Orchestrator. The current production release (v4.0.0) is stable for pilot use, and we are now focusing on global scale, hardware-level isolation, and advanced AI capabilities.

## Q3 2026: Scale & Reliability

- [ ] **Multi-Region Control Plane**: Global task distribution with local persistence and low-latency synchronization.
- [ ] **MicroVM Support**: Firecracker integration for hardware-level isolation on multi-tenant edge nodes.
- [ ] **Custom Scheduler Plugins**: Expose a gRPC API for third-party placement logic and domain-specific heuristics.

## Q4 2026: AI & Automation

- [ ] **Auto-scaling Edge Groups**: Dynamically spin up or decommission nodes based on predictive demand and grid carbon intensity.
- [ ] **Federated Learning**: Train placement models directly on edge nodes without sensitive data egress, preserving privacy.
- [ ] **Natural Language Query**: "Where is my task running?" via built-in LLM interface and RAG-driven knowledge base.

## Future ML Backends

### Future: XGBoost Backend
XGBoost integration is planned as an optional alternative ML backend for environments where a dedicated Python inference microservice is available. While the current TensorFlow.js neural network provides excellent sub-millisecond inference within the Node.js process, XGBoost may offer superior accuracy for specific long-tail performance distributions.

**Planned integration path:**
1. **Sidecar Inference**: Run the existing Python XGBoost models in a lightweight FastAPI sidecar.
2. **GRPC Bridge**: The `ml-scheduler` package will detect XGBoost metadata and route scoring requests to the sidecar via gRPC.
3. **Hybrid Mode**: Allow the scheduler to use TFJS for standard tasks and XGBoost for high-precision, high-latency sensitive workloads.

---
*Last Updated: May 2026*
