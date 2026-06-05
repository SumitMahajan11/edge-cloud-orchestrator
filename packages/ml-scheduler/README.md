# @edgecloud/ml-scheduler

## Purpose

ML-driven node scoring and drift detection for intelligent task placement. Uses TensorFlow.js to score candidate edge nodes based on historical performance, current resource utilization, and task requirements. Includes drift detection to retrain models when node behavior changes.

## Installation

```sh
pnpm add @edgecloud/ml-scheduler
```

## Exports

| Export          | Type  | Description                                 |
| --------------- | ----- | ------------------------------------------- |
| `MLScheduler`   | class | Multi-objective ML node scorer              |
| `DriftDetector` | class | Statistical drift detection with retraining |
| `NodeScorer`    | class | Feature extraction and score normalization  |

## Usage

```typescript
import { MLScheduler } from "@edgecloud/ml-scheduler";

const scheduler = new MLScheduler({ modelPath: "./models/node-scorer" });
await scheduler.initialize();
const ranked = await scheduler.rankNodes(candidateNodes, task);
```

## Build

```sh
pnpm build   # tsc → dist/
pnpm test
```
