# Domain Glossary

This glossary defines the core domain-specific terms, algorithms, and architectural concepts used throughout the Edge-Cloud Orchestrator system.

---

### 🤖 Scheduling & Machine Learning

#### Contextual Bandit Scheduling
A machine learning policy approach that dynamically assigns incoming execution tasks to the most suitable edge nodes. It balances **exploration** (trying underutilized or new nodes to discover their capabilities) and **exploitation** (assigning tasks to nodes with known optimal latency/success rates). The policy uses historical features (e.g. node CPU load, network latency, carbon intensity) to optimize task assignment decisions.

#### Carbon-Shifting (Carbon-Intensity Scheduling)
An operational scheduling strategy that shifts compute workloads to different time frames or physical edge locations based on real-time grid carbon emissions data. This minimizes the collective carbon footprint of running workloads.

#### Federated Aggregation (Federated Learning)
A decentralized machine learning paradigm where edge agents train local models using local datasets and upload only the resulting model weights (or gradients) to the API control plane. The control plane then aggregates these weights (e.g. using FedAvg) to update a global model without raw telemetry or user data leaving the edge.

#### Leader Election
A distributed consensus coordination mechanism ensuring that only one API server acts as the active task scheduler at any time. It uses Redis locks to establish leadership, preventing double-allocation race conditions across distributed scheduler instances.

---

### 🛡️ Security & Transport

#### Mutual TLS (mTLS)
A cryptographic transport protocol where both the client (edge agent) and the server (API control plane) authenticate each other's certificates. This guarantees secure node bootstrapping, metrics ingestion, and control message routing.

#### Attribute-Based Access Control (ABAC)
A fine-grained authorization model that evaluates permissions by checking matching policies against attributes of the **Subject** (user/agent), **Resource** (task/node), **Action** (read/write/run), and **Environment** (time of day, network origin). Deny rules take immediate precedence.

#### WASM Sandboxing
Executing task execution payloads within a WebAssembly (WASM) virtual machine hosted inside the Rust agent daemon. This prevents guest workloads from executing arbitrary system commands or causing host memory/resource exhaustion.

---

### 📨 Messaging & Reliability

#### Dead-Letter Queue (DLQ)
A persistent storage outbox (PostgreSQL-backed and tracked via Redis) where events that fail to be processed by consumers are quarantined. It logs the raw payload, topic name, stack trace, and correlation ID for administrative auditing and manual republishing.

#### Heartbeat Ingestion
The process where active edge agents send periodic health payloads to the API control plane. These payloads contain metrics (available CPU, RAM, network latency, disk space) used by the scheduler to maintain an accurate view of cluster capacity.
