# ML Model Training Guide

## Overview

The ML scheduler uses a **two-stage ML pipeline**:

1. **Training (Python)**: XGBoost model trained on historical node performance data
2. **Inference (Node.js)**: TensorFlow.js loads trained model for real-time scheduling predictions

The Python training script produces model artifacts that are loaded by the Node.js scheduler service at runtime.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Training Pipeline (Python - Offline)                       │
│  packages/ml-scheduler/src/training/train_model.py          │
│  ├─ Input: Historical scheduling data (JSON)                │
│  ├─ Algorithm: XGBoost (fallback: sklearn GradientBoosting) │
│  └─ Output: model_YYYYMMDDHHmmss.xgb.json + metadata        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Inference Engine (Node.js - Real-time)                     │
│  packages/ml-scheduler/src/predictor.ts                     │
│  ├─ Loads: model_{version}.json (metadata)                  │
│  ├─ Runtime: TensorFlow.js (or mock if unavailable)         │
│  └─ Fallback: Heuristic bin-packing when model unavailable  │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Python Training Environment

- **Python**: 3.9+
- **Required packages**: See `packages/ml-scheduler/src/training/requirements.txt`
  - `pandas` - Data manipulation
  - `numpy` - Numerical operations
  - `xgboost` - Primary ML algorithm (XGBoost regressor)
  - `scikit-learn` - Fallback algorithm + train/test split + metrics
  - `joblib` - Model serialization (for sklearn fallback)

### Node.js Runtime Environment

- **Node.js**: 18+
- **Package**: `@tensorflow/tfjs-node` (optional, falls back to mock predictor if unavailable)

## Training Steps

### Step 1: Collect Training Data

Training data should be historical scheduling decisions with outcomes:

```json
[
  {
    "cpu_usage_pct": 45.2,
    "ram_usage_pct": 62.1,
    "current_task_count": 3,
    "avg_latency_ms": 120.5,
    "historical_success_rate_7d": 0.95,
    "region_cost_rate": 0.05,
    "priority": 2,
    "estimated_duration_ms": 5000,
    "requires_gpu": 0,
    "image_size_mb": 150,
    "hour_of_day": 14,
    "day_of_week": 3,
    "scheduling_score": 0.82
  }
]
```

**Data sources**:

- Export from PostgreSQL: `task_executions` table + `edge_nodes` metrics
- Minimum samples: 50 (script enforces this)
- Recommended: 1000+ samples for reliable predictions

### Step 2: Run Training

```bash
cd packages/ml-scheduler/src/training

# Install dependencies
pip install -r requirements.txt

# Train model
python train_model.py <data_json_path> <output_dir>

# Example
python train_model.py \
  ../../../data/training/historical_data.json \
  ../../../models
```

### Step 3: Verify Output

Training produces:

```
packages/ml-scheduler/models/
├── model_20260425193045.xgb.json  # XGBoost model artifact
├── model_20260425193045.json      # Metadata (version, MAE, features)
└── latest.json                     # Symlink to current best model
```

**Metadata example** (`model_20260425193045.json`):

```json
{
  "version": "20260425193045",
  "algorithm": "XGBoost",
  "mae": 0.0423,
  "features": [
    "cpu_usage_pct",
    "ram_usage_pct",
    "current_task_count",
    "avg_latency_ms",
    "historical_success_rate_7d",
    "region_cost_rate",
    "priority",
    "estimated_duration_ms",
    "requires_gpu",
    "image_size_mb",
    "hour_of_day",
    "day_of_week"
  ],
  "created_at": "2026-04-25T19:30:45.123456",
  "artifact_path": "/path/to/model_20260425193045.xgb.json"
}
```

### Step 4: Deploy Model

Restart scheduler service to load new model:

```bash
# Docker
docker-compose restart scheduler-service

# Kubernetes
kubectl rollout restart deployment/scheduler-service
```

The scheduler automatically loads `latest.json` from the models directory.

## Model Versioning

### Git Ignore Rules

Trained models are **NOT committed to Git** (too large, environment-specific):

```gitignore
# packages/ml-scheduler/.gitignore
models/*.xgb.json
models/*.joblib
models/__pycache__/
training/__pycache__/
*.pyc
```

### Storage Recommendations

**Option 1: S3 Bucket** (Recommended for production)

```bash
aws s3 cp packages/ml-scheduler/models/ s3://edgecloud-ml-models/ \
  --recursive --exclude "*.json" --include "*.xgb.json"
```

**Option 2: Vault KV Store** (For security-sensitive deployments)

```bash
vault kv put secret/ml-scheduler/models \
  model_version=20260425193045 \
  model_artifact=@model_20260425193045.xgb.json
```

**Option 3: Shared Volume** (For single-node deployments)

```bash
# Mount NFS/EFS volume at /mnt/ml-models
cp packages/ml-scheduler/models/*.json /mnt/ml-models/
```

## Retraining Schedule

### When to Retrain

Retrain when **scheduling accuracy drops below threshold**:

1. **Monitor MAE (Mean Absolute Error)**:
   - Good: MAE < 0.05 (5% average prediction error)
   - Acceptable: MAE 0.05-0.10
   - Retrain: MAE > 0.10

2. **Monitor scheduling decisions**:
   - Task completion rate drops below 90%
   - Node resource utilization becomes unbalanced (>80% variance)
   - Cold-start period exceeds 50 heartbeats per node

3. **Scheduled retraining**:
   - **Weekly**: If task volume > 10,000 tasks/week
   - **Monthly**: If task volume < 10,000 tasks/week
   - **On-demand**: After major infrastructure changes (new node types, regions)

### Retraining Automation (Future)

```bash
# Example cron job (weekly retraining)
0 2 * * 0 /usr/bin/python3 /opt/edgecloud/ml-scheduler/training/train_model.py \
  /opt/edgecloud/data/training/weekly_export.json \
  /opt/edgecloud/ml-scheduler/models

# Restart scheduler after training
0 3 * * 0 docker-compose restart scheduler-service
```

## Fallback Behavior

When **no model files found** or **TensorFlow.js unavailable**:

### Fallback Chain

```
1. Try loading XGBoost model from models/model_{version}.json
   ↓ (if fails)
2. Try loading TensorFlow.js model
   ↓ (if fails)
3. Use heuristic bin-packing algorithm (predictor.ts:180-188)
```

### Heuristic Bin-Packing Algorithm

The fallback uses a weighted scoring system:

```typescript
// From packages/ml-scheduler/src/predictor.ts:180
private heuristicPrediction(task: Task, node: EdgeNode): number {
  let score = 1.0;
  score *= 1 - (node.cpuUsage / 100) * 0.4;      // 40% weight on CPU
  score *= 1 - (node.memoryUsage / 100) * 0.3;   // 30% weight on memory
  score *= 1 - Math.min(1, node.latency / 500) * 0.2; // 20% weight on latency
  if (node.status !== 'ONLINE') score *= 0.1;    // Penalize offline nodes
  if (node.tasksRunning >= node.maxTasks) score *= 0.05; // Penalize overloaded
  return score;
}
```

**Characteristics**:

- ✅ Always available (no dependencies)
- ✅ Fast (~1ms per prediction)
- ⚠️ Less accurate than ML model (doesn't learn from historical data)
- ⚠️ Doesn't account for time-based patterns (hour of day, day of week)

### Cold-Start Period

New nodes require **~50 heartbeats** before model predictions are reliable:

- **Heartbeat 1-10**: Node excluded from scheduling (insufficient data)
- **Heartbeat 10-50**: Heuristic predictions only (model confidence low)
- **Heartbeat 50+**: Full ML predictions active

## Troubleshooting

### Training Fails: "Empty dataset"

```bash
# Check data file
cat data/training/historical_data.json | jq length
# Should be > 50

# Export fresh data from PostgreSQL
psql -c "COPY (
  SELECT cpu_usage_pct, ram_usage_pct, ..., scheduling_score
  FROM task_executions te
  JOIN edge_nodes en ON te.nodeId = en.id
  WHERE te.completedAt > NOW() - INTERVAL '30 days'
) TO '/tmp/training_data.json' WITH (FORMAT json);"
```

### Training Fails: "Target column not found"

Ensure your JSON includes `scheduling_score` column. Calculate it as:

```
scheduling_score = (task_completed_successfully ? 1 : 0) *
                   (1 - resource_wastage_ratio)
```

### Model Not Loading in Scheduler

```bash
# Check models directory
ls -la packages/ml-scheduler/models/

# Verify latest.json exists
cat packages/ml-scheduler/models/latest.json

# Check scheduler logs
docker logs scheduler-service | grep -i "model"
# Expected: "Model version 20260425193045 loaded and active"
```

### TensorFlow.js Native Addon Missing

```bash
# Install tfjs-node with native bindings
cd packages/ml-scheduler
npm install @tensorflow/tfjs-node

# If build fails, fallback to mock predictor (acceptable for development)
# Mock predictor uses heuristic bin-packing
```

## Performance Benchmarks

| Metric                | XGBoost Model       | TensorFlow.js           | Heuristic Fallback |
| --------------------- | ------------------- | ----------------------- | ------------------ |
| **Training Time**     | 5-30 seconds        | N/A (trained in Python) | N/A                |
| **Inference Latency** | ~2ms                | ~5ms                    | ~1ms               |
| **Accuracy (MAE)**    | 0.03-0.08           | 0.04-0.10               | 0.15-0.25          |
| **Memory Usage**      | 50-200 MB           | 100-300 MB              | <10 MB             |
| **Cold Start**        | Requires model file | Requires model file     | Always available   |

## References

- XGBoost Documentation: https://xgboost.readthedocs.io/
- TensorFlow.js: https://www.tensorflow.org/js
- Training Script: `packages/ml-scheduler/src/training/train_model.py`
- Predictor Implementation: `packages/ml-scheduler/src/predictor.ts`
- Scoring Logic: `packages/ml-scheduler/src/scoring.ts`
