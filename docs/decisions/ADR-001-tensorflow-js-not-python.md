# ADR-001: Use TensorFlow.js for ML scheduler instead of Python
Date: 2026-06-11
Status: Accepted

## Context
The scheduling platform needed ML inference capabilities. Python is the dominant ML language but would require a separate service, cross-language IPC, and operational complexity. TF.js runs in Node.js process space alongside the API.

## Decision
TensorFlow.js with a 4-layer Keras-style model.

## Consequences
+ No separate ML service to deploy or scale
+ Same process as API — zero network overhead for inference
+ TypeScript type safety across ML layer
+ Model can be retrained and hot-reloaded without restart
- Python ecosystem has richer ML tooling (scikit-learn, PyTorch)
- TF.js performance ceiling lower than native TensorFlow
- Smaller community for production TF.js deployments
