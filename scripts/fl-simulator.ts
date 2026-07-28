#!/usr/bin/env npx tsx
/**
 * FL Client Simulator — Empirical Federated Learning Trainer & Aggregator
 *
 * Usage:  npx tsx scripts/fl-simulator.ts [totalRounds]
 *
 * Each edge node holds local training data, trains a local model (gradient descent),
 * and computes real local performance metrics (MAE, accuracy, reward).
 * The FedAvg aggregator averages model parameters across nodes each round,
 * evaluating global convergence on a held-out validation set.
 */

import fs from 'fs';
import http from 'http';
import path from 'path';

const API_BASE = 'http://localhost:3090';
const ADMIN_EMAIL = 'admin@demo-org.com';
const ADMIN_PASSWORD = 'Admin123!';
const NUM_CLIENTS = 5;
const FEATURE_DIM = 12;
const NUM_ROUNDS = parseInt(process.argv[2] || '5', 10);

// Node UUIDs for FL simulation
const NODE_IDS = [
  '2e71adcd-3314-47ba-8aa9-6b19ad19ba25', // edge-node-001
  '605332d8-89a2-49f9-98cf-43efad1c21c3', // edge-node-002
  '77206f8b-4682-4454-bdcb-d2571ca19587', // edge-node-003
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // edge-node-004
  'f9e8d7c6-b5a4-3210-fedc-ba9876543210', // edge-node-005
];

interface Sample {
  features: number[];
  target: number;
}

interface NodeDataset {
  nodeId: string;
  train: Sample[];
  val: Sample[];
}

interface RoundResult {
  round: number;
  globalAccuracy: number;
  globalMAE: number;
  nodeMetrics: {
    nodeId: string;
    samplesCount: number;
    localAccuracy: number;
    localMAE: number;
    avgReward: number;
  }[];
}

// True underlying ground truth function for domain physics
const TRUE_WEIGHTS = [0.25, -0.15, -0.20, -0.10, 0.15, -0.05, 0.20, -0.10, 0.05, 0.10, -0.05, -0.10];
const TRUE_BIAS = 0.50;

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, val, idx) => sum + val * b[idx], 0);
}

function clamp(val: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, val));
}

function generateSample(): Sample {
  const features = [
    Math.random(), // cpu
    Math.random(), // memory
    Math.random(), // latency
    Math.random(), // cost
    Math.random(), // priority
    Math.random(), // task_count
    Math.random(), // success_rate
    Math.random(), // energy
    Math.random(), // network_bandwidth
    Math.random(), // node_capacity
    Math.random(), // temperature
    Math.random(), // queue_length
  ];
  const noise = (Math.random() - 0.5) * 0.05;
  const rawTarget = dot(features, TRUE_WEIGHTS) + TRUE_BIAS + noise;
  const target = clamp(rawTarget, 0, 1);
  return { features, target };
}

function generateDatasets(numNodes: number, trainPerNode = 150, valPerNode = 30): { nodeDatasets: NodeDataset[]; globalVal: Sample[] } {
  const nodeDatasets: NodeDataset[] = [];
  const globalVal: Sample[] = [];

  for (let i = 0; i < numNodes; i++) {
    const train: Sample[] = [];
    const val: Sample[] = [];
    for (let s = 0; s < trainPerNode; s++) train.push(generateSample());
    for (let s = 0; s < valPerNode; s++) {
      const sample = generateSample();
      val.push(sample);
      globalVal.push(sample);
    }
    nodeDatasets.push({
      nodeId: NODE_IDS[i] || `node-${i + 1}`,
      train,
      val,
    });
  }

  return { nodeDatasets, globalVal };
}

class LocalModel {
  weights: number[];
  bias: number;

  constructor(dim: number, initialWeights?: number[], initialBias?: number) {
    this.weights = initialWeights ? [...initialWeights] : new Array(dim).fill(0).map(() => (Math.random() - 0.5) * 0.1);
    this.bias = initialBias !== undefined ? initialBias : 0;
  }

  predict(features: number[]): number {
    return clamp(dot(features, this.weights) + this.bias, 0, 1);
  }

  trainSGD(dataset: Sample[], epochs = 12, lr = 0.08): void {
    for (let epoch = 0; epoch < epochs; epoch++) {
      for (const sample of dataset) {
        const pred = this.predict(sample.features);
        const err = pred - sample.target;
        for (let j = 0; j < this.weights.length; j++) {
          this.weights[j] -= lr * err * sample.features[j];
        }
        this.bias -= lr * err;
      }
    }
  }

  evaluate(valSet: Sample[]): { mae: number; accuracy: number; avgReward: number } {
    let totalError = 0;
    let correct = 0;
    for (const sample of valSet) {
      const pred = this.predict(sample.features);
      const absErr = Math.abs(pred - sample.target);
      totalError += absErr;
      if (absErr <= 0.15) correct++;
    }
    const mae = totalError / valSet.length;
    const accuracy = correct / valSet.length;
    const avgReward = clamp(1.0 - mae, 0, 1);
    return { mae, accuracy, avgReward };
  }

  serialize(): Buffer {
    const buf = Buffer.alloc((FEATURE_DIM + 1) * 4);
    for (let i = 0; i < FEATURE_DIM; i++) {
      buf.writeFloatLE(this.weights[i], i * 4);
    }
    buf.writeFloatLE(this.bias, FEATURE_DIM * 4);
    return buf;
  }
}

function fedAvg(models: LocalModel[], sampleCounts: number[]): LocalModel {
  const totalSamples = sampleCounts.reduce((a, b) => a + b, 0);
  const avgWeights = new Array(FEATURE_DIM).fill(0);
  let avgBias = 0;

  for (let i = 0; i < models.length; i++) {
    const weight = sampleCounts[i] / totalSamples;
    for (let j = 0; j < FEATURE_DIM; j++) {
      avgWeights[j] += models[i].weights[j] * weight;
    }
    avgBias += models[i].bias * weight;
  }

  return new LocalModel(FEATURE_DIM, avgWeights, avgBias);
}

async function tryServerUpload(nodeId: string, roundId: string, weightsBuf: Buffer, sampleCount: number, avgReward: number): Promise<boolean> {
  // Simple check if API server is available
  try {
    const boundary = `----FlSimBoundary${Date.now().toString(16)}`;
    const parts: Buffer[] = [];
    const nl = Buffer.from('\r\n');
    const dd = Buffer.from(`--${boundary}\r\n`);
    const ddEnd = Buffer.from(`--${boundary}--\r\n`);

    parts.push(
      dd,
      Buffer.from(`Content-Disposition: form-data; name="weights"; filename="weights_${nodeId}.bin"\r\n`),
      Buffer.from('Content-Type: application/octet-stream\r\n'),
      nl,
      weightsBuf,
      nl,
    );

    for (const [name, value] of [
      ['roundId', roundId],
      ['nodeId', nodeId],
      ['sampleCount', String(sampleCount)],
      ['avgReward', String(avgReward)],
    ]) {
      parts.push(
        dd,
        Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n`),
        nl,
        Buffer.from(value),
        nl,
      );
    }
    parts.push(ddEnd);
    const body = Buffer.concat(parts);

    const result = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3090,
        path: '/v2/ml/federated/weights/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          'X-Node-ID': nodeId,
        },
        timeout: 1000,
      }, (res) => resolve(res.statusCode || 0));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    return result === 200 || result === 201;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  Empirical Federated Learning Simulation (${NUM_CLIENTS} nodes, ${NUM_ROUNDS} rounds) ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  const { nodeDatasets, globalVal } = generateDatasets(NUM_CLIENTS);
  let globalModel = new LocalModel(FEATURE_DIM);

  const initialGlobalEval = globalModel.evaluate(globalVal);
  console.log(`Initial Untrained Global Model:`);
  console.log(`  Global MAE:      ${initialGlobalEval.mae.toFixed(4)}`);
  console.log(`  Global Accuracy: ${(initialGlobalEval.accuracy * 100).toFixed(1)}%\n`);

  const results: RoundResult[] = [];

  for (let r = 1; r <= NUM_ROUNDS; r++) {
    console.log(`━━━ Round ${r}/${NUM_ROUNDS} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const localModels: LocalModel[] = [];
    const sampleCounts: number[] = [];
    const nodeMetrics: RoundResult['nodeMetrics'] = [];

    for (let i = 0; i < NUM_CLIENTS; i++) {
      const nodeData = nodeDatasets[i];
      // Clone global weights into local model
      const localModel = new LocalModel(FEATURE_DIM, globalModel.weights, globalModel.bias);

      // Perform local SGD training on local dataset
      localModel.trainSGD(nodeData.train, 12, 0.08);

      // Evaluate local model on node validation set
      const evalResult = localModel.evaluate(nodeData.val);

      localModels.push(localModel);
      sampleCounts.push(nodeData.train.length);

      nodeMetrics.push({
        nodeId: nodeData.nodeId,
        samplesCount: nodeData.train.length,
        localAccuracy: evalResult.accuracy,
        localMAE: evalResult.mae,
        avgReward: evalResult.avgReward,
      });

      // Attempt optional upload to local API server if running
      const weightsBuf = localModel.serialize();
      await tryServerUpload(nodeData.nodeId, `round-${r}`, weightsBuf, nodeData.train.length, evalResult.avgReward);

      console.log(
        `  Node ${i + 1} (${nodeData.nodeId.slice(0, 8)}...): ` +
        `MAE=${evalResult.mae.toFixed(4)} | ` +
        `Acc=${(evalResult.accuracy * 100).toFixed(1)}% | ` +
        `Reward=${evalResult.avgReward.toFixed(4)}`,
      );
    }

    // FedAvg Aggregation across local models
    globalModel = fedAvg(localModels, sampleCounts);

    // Evaluate new global model on global validation set
    const globalEval = globalModel.evaluate(globalVal);

    console.log(`  ➔ FedAvg Global Model: MAE=${globalEval.mae.toFixed(4)} | Accuracy=${(globalEval.accuracy * 100).toFixed(1)}%\n`);

    results.push({
      round: r,
      globalAccuracy: globalEval.accuracy,
      globalMAE: globalEval.mae,
      nodeMetrics,
    });
  }

  // Ensure data directory exists
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Write JSON output
  const jsonPath = path.join(dataDir, 'fl_simulation_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), numNodes: NUM_CLIENTS, rounds: results }, null, 2));
  console.log(`Saved full JSON results to: ${jsonPath}`);

  // Write Markdown summary file: ML-2-FL-SIMULATION-RESULTS.md
  let mdContent = `# Empirical Federated Learning Simulation Results\n\n`;
  mdContent += `**Executed at**: ${new Date().toISOString()}\n`;
  mdContent += `**Configuration**: ${NUM_CLIENTS} Edge Nodes, ${NUM_ROUNDS} FedAvg Aggregation Rounds\n\n`;
  mdContent += `## Global Convergence Summary\n\n`;
  mdContent += `| Round | Global MAE | Global Accuracy | Avg Node Local MAE | Avg Node Local Accuracy | Avg Reward |\n`;
  mdContent += `|---|---|---|---|---|---|\n`;

  for (const r of results) {
    const avgLocalMAE = r.nodeMetrics.reduce((s, n) => s + n.localMAE, 0) / r.nodeMetrics.length;
    const avgLocalAcc = r.nodeMetrics.reduce((s, n) => s + n.localAccuracy, 0) / r.nodeMetrics.length;
    const avgReward = r.nodeMetrics.reduce((s, n) => s + n.avgReward, 0) / r.nodeMetrics.length;

    mdContent += `| ${r.round} | ${r.globalMAE.toFixed(4)} | ${(r.globalAccuracy * 100).toFixed(1)}% | ${avgLocalMAE.toFixed(4)} | ${(avgLocalAcc * 100).toFixed(1)}% | ${avgReward.toFixed(4)} |\n`;
  }

  mdContent += `\n## Per-Node Performance Breakdown (Final Round ${NUM_ROUNDS})\n\n`;
  mdContent += `| Node ID | Samples | Local MAE | Local Accuracy | Local Reward |\n`;
  mdContent += `|---|---|---|---|---|\n`;
  const finalRound = results[results.length - 1];
  for (const nm of finalRound.nodeMetrics) {
    mdContent += `| ${nm.nodeId} | ${nm.samplesCount} | ${nm.localMAE.toFixed(4)} | ${(nm.localAccuracy * 100).toFixed(1)}% | ${nm.avgReward.toFixed(4)} |\n`;
  }

  mdContent += `\n## Reproducibility\n\n`;
  mdContent += `To reproduce these empirical results, execute:\n`;
  mdContent += `\`\`\`bash\nnpx tsx scripts/fl-simulator.ts ${NUM_ROUNDS}\n\`\`\`\n`;

  const mdPath = path.join(process.cwd(), 'ML-2-FL-SIMULATION-RESULTS.md');
  fs.writeFileSync(mdPath, mdContent);
  console.log(`Updated markdown report: ${mdPath}`);
}

main().catch((err) => {
  console.error('Fatal error in FL simulation:', err);
  process.exit(1);
});
