# ML Pipeline & MLOps Workflow

This document describes the automated Machine Learning lifecycle for the Edge-Cloud Orchestrator, covering training, validation, versioning, and deployment.

## Overview

The scheduling logic uses an XGBoost-based predictor to estimate task outcomes and node suitability. To prevent model staleness and handle feature drift, an automated retraining pipeline is implemented via GitHub Actions.

## Automated Retraining

### Triggers

1. **Scheduled**: The pipeline runs every Sunday at midnight UTC.
2. **Drift Detected**: Triggered by a `repository_dispatch` event (`ml_drift_alert`) emitted by the `DriftDetector` when prediction error spikes.
3. **Manual**: Can be triggered via the GitHub Actions UI ("Workflow Dispatch").

### Validation Gate

The `train_model.py` script includes a strict validation step:

- Evaluates the new model against a 20% holdout test set.
- Calculates the **P99 Scheduling Error**.
- **Threshold**: Must be **< 10ms**.
- If validation fails, the script exits with code 1, blocking the CI pipeline and preventing the deployment of a degraded model.

## Model Versioning

Models are versioned using **SemVer** (e.g., `1.2.0`).

- Metadata is stored in `packages/ml-scheduler/models/model_metadata.json`.
- The version is automatically incremented (patch version) by the training script based on the previous `latest.json`.

### Metadata Format

```json
{
  "version": "1.2.0",
  "algorithm": "XGBoost",
  "accuracy": 0.94,
  "mae": 1.2,
  "p99_error": 8.5,
  "trainedAt": "2024-04-28T21:00:00Z",
  "artifact_path": "packages/ml-scheduler/models/model_1.2.0.xgb.json"
}
```

## Enforcement & Security

The `SchedulingPredictor` enforces a minimum model version requirement:

- Set `MIN_MODEL_VERSION` environment variable (e.g., `1.1.0`).
- If the loaded model's version is lower than `MIN_MODEL_VERSION`, the service will throw an error on startup and refuse to process tasks.

## Rollback Procedure

To roll back to a previous model version:

1. Identify the desired version (e.g., `1.1.5`) from the `packages/ml-scheduler/models/` directory.
2. Revert the `latest.json` or `model_metadata.json` to point to the older artifact.
3. Alternatively, set `MIN_MODEL_VERSION` to the older version and update the deployment configuration to use the specific versioned artifact.
4. If using Git-based deployment, revert the commit that introduced the faulty model.

## Drift Detection

The `DriftDetector` (in `apps/api/src/services/task-scheduler.ts`) monitors live prediction errors. If the error exceeds a predefined threshold (e.g., 15ms MAE), it triggers the `ml-retrain.yml` workflow via the GitHub API.

```bash
# Example manual trigger for retraining
gh workflow run ml-retrain.yml
```
