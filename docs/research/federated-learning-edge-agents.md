# Federated learning feasibility across heterogeneous edge agents

**Issue:** #36 / #21  
**Status:** Recommendation  
**Author:** Manus AI  
**Date:** 2026-09-20

## Conclusion

Federated learning is **feasible as a staged research project**, but the exact proposal—Rust agents using `tract-onnx` while a TypeScript service aggregates TensorFlow.js weights—is not a drop-in FedAvg implementation. The current Rust dependency is primarily an ONNX inference runtime. It does not provide the local training loop, optimizer, gradient computation, or model-update contract required by FedAvg.

The recommended path is to keep the first pilot narrow. The central service should own the canonical model schema and aggregation policy. Edge agents should initially submit versioned, authenticated update artifacts produced by a training-capable client runtime. If the Rust agent must train locally, the project needs a separate training-capable Rust stack or a constrained numerical training implementation. `tract-onnx` alone is insufficient.

The pilot should start with a small dense scheduling model whose tensor shapes are fixed and whose features already match the scheduler’s twelve-feature model. Use weighted FedAvg as a baseline, then compare FedProx when device or data heterogeneity causes unstable convergence. Add secure transport, update signing, minimum sample thresholds, and validation gates before any federated model can become active.

## Repository fit

The repository already contains several useful building blocks:

- The scheduler uses TensorFlow.js through `@tensorflow/tfjs-node` and stores model artifacts through the model registry and model-storage services.
- The API has federated-round and federated-weight-submission data models and exposes a weight-submission route.
- `packages/ml-scheduler/src/federated-aggregator.ts` already performs sample-count-weighted delta aggregation and promotes a new model version.
- The Rust agent currently depends on `tract-onnx`, `serde`, `serde_json`, `reqwest`, and related runtime libraries. No training framework or optimizer is present in its Cargo manifest.
- The current central model is represented as TensorFlow.js model JSON plus binary or object-storage artifacts. This is not the same interchange format as an ONNX graph with ONNX tensor initializers.

This means the issue is not starting from zero. The missing work is a stable cross-runtime contract and a trustworthy local-training path, not merely an averaging loop.

## Why plain FedAvg is insufficient

FedAvg aggregates client model updates weighted by the number of local samples. It is attractive because it reduces communication compared with sending raw data. However, the edge setting has two kinds of heterogeneity.

**System heterogeneity** includes CPU architecture, memory, battery or power limits, network quality, and clients that disconnect before completing a round. **Statistical heterogeneity** means that different nodes observe different workloads, task mixes, regions, and traffic patterns. FedProx was designed to address both kinds of heterogeneity by allowing variable local work and adding a proximal term. Its authors report more stable behavior than FedAvg in highly heterogeneous settings [1].

SCAFFOLD addresses a different failure mode: local model updates drift because clients train on non-identically distributed data. It uses control variates to correct that drift and can reduce the number of communication rounds [2]. It should be considered a second experiment, not a requirement for the first protocol.

The project should therefore implement FedAvg as a baseline, but define an explicit upgrade path to FedProx. The aggregator should record client completion time, sample count, local steps, model version, feature schema version, and update norm so that instability can be diagnosed rather than hidden inside an average.

## Cross-runtime model and serialization design

The central service and Rust agent should not exchange an opaque TensorFlow.js directory or an untyped byte array. Every update should carry a signed manifest with at least the following fields:

| Field                            | Purpose                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `modelId`                        | Identifies the model family being trained                 |
| `baseVersion`                    | Prevents applying an update to the wrong global model     |
| `featureSchemaVersion`           | Prevents incompatible feature ordering or scaling         |
| `tensorSchema`                   | Ordered tensor names, shapes, dtype, and byte order       |
| `sampleCount`                    | Provides the FedAvg weight, subject to server-side limits |
| `localSteps`                     | Makes system heterogeneity observable                     |
| `createdAt` and `expiresAt`      | Prevents stale replayed updates                           |
| `artifactDigest`                 | Verifies the uploaded update bytes                        |
| `signatureKeyId` and `signature` | Authenticates the submitting agent                        |

For a small dense model, the update artifact can be a deterministic sequence of little-endian `float32` tensors described by the manifest. This is straightforward for Rust and Node.js, but it is an application protocol rather than a standard model format. The protocol must reject tensors whose names, shapes, count, dtype, or byte length do not match the registered model.

ONNX is useful for distributing an inference graph to `tract-onnx`, but it does not by itself solve local training. A viable design is to distribute a versioned inference model in ONNX for prediction, while defining a separate training/update representation for the limited tensors that the client is permitted to change. The central TensorFlow.js model must have a deterministic mapping between its trainable tensors and that update representation. Any conversion from TensorFlow.js to ONNX should be tested for numerical parity on a fixed corpus before a client is admitted to a round.

TensorFlow Federated is valuable for simulation and algorithm experimentation, and its documentation presents weighted FedAvg workflows over decentralized data [3]. It should not be embedded into the Rust agent. A Python or TypeScript simulation can validate aggregation behavior before the production API and Rust protocol are implemented.

## Privacy and security requirements

Federated learning does not guarantee privacy merely because raw data remains on the edge. NIST documents attacks that can extract information from model updates and from trained models [4]. The project must therefore treat an update as sensitive data.

The first pilot should require mutual TLS or an equivalent authenticated channel, agent identity authorization, signed manifests, replay protection, bounded sample counts, and per-tenant round isolation. The aggregator should clip update norms and reject non-finite values before averaging. It should retain an audit record of the model version, agent identity, digest, sample count, validation result, and promotion decision.

For a stronger privacy posture, the roadmap should add secure aggregation so the server cannot inspect each individual update, followed by differential privacy if the threat model requires formal guarantees. These protections change the protocol and should not be implied by the initial FedAvg pilot.

The aggregator also needs poisoning defenses. A single compromised agent should not be able to move the global scheduler model arbitrarily. Candidate defenses include per-client update-norm limits, robust aggregation experiments, minimum participation thresholds, shadow evaluation against a held-out server dataset, and automatic rollback when production metrics regress.

## Recommended staged implementation

**Stage 0: simulation.** Build a deterministic simulator using the existing scheduler feature schema. Generate clients with different sample counts, local compute budgets, and non-IID workload distributions. Compare FedAvg, FedProx, and a centralized baseline. Define success using prediction error, convergence stability, round duration, and bytes transferred.

**Stage 1: central protocol.** Add a versioned update manifest and validation layer around the existing federated aggregator. Reject stale base versions, malformed tensors, unsupported schema versions, non-finite values, and excessive update norms. Keep model promotion behind the existing shadow-evaluation and rollback path.

**Stage 2: one training-capable edge client.** Do not start with every Rust agent. Implement one reference client that can train the selected small model locally and produce the manifest plus update artifact. This can be a controlled Rust prototype or a separate supported runtime while the Rust training choice is evaluated.

**Stage 3: heterogeneous canary.** Enroll a small group of agents with different CPU and network profiles. Use FedAvg first, then enable FedProx if local steps and data distributions produce instability. Record dropout, update size, convergence, and resource overhead.

**Stage 4: production controls.** Add secure aggregation, stronger privacy protections if required, key rotation, audit retention, tenant quotas, and explicit operator approval for model promotion. Only then should federated training influence the default scheduler model.

## Decision

Proceed with a **research prototype**, not a production rollout. The current architecture can support a central federated aggregator, but Rust `tract-onnx` agents cannot train and emit FedAvg updates without an additional training runtime and a new versioned serialization contract. Use the current TensorFlow.js scheduler model for central evaluation, define a small cross-runtime tensor protocol, and benchmark FedAvg before selecting FedProx or SCAFFOLD for heterogeneous clients.

## References

[1]: https://proceedings.mlsys.org/paper/2020/hash/1f5fe83998a09396ebe6477d9475ba0c-Abstract.html "Federated Optimization in Heterogeneous Networks — MLSys 2020"
[2]: https://proceedings.mlr.press/v119/karimireddy20a.html "SCAFFOLD: Stochastic Controlled Averaging for Federated Learning — PMLR 119"
[3]: https://www.tensorflow.org/federated "TensorFlow Federated: Machine Learning on Decentralized Data"
[4]: https://www.nist.gov/blogs/cybersecurity-insights/privacy-attacks-federated-learning "NIST: Privacy Attacks in Federated Learning"
[5]: https://flower.ai/docs/examples/embedded-devices.html "Flower: Federated AI with Embedded Devices"
