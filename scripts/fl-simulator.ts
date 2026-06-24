#!/usr/bin/env npx tsx
/**
 * FL Client Simulator — End-to-End Federated Learning Round Driver
 *
 * Usage:  npx tsx scripts/fl-simulator.ts [totalRounds]
 * Note:   Uses Node.js http.request for multipart POSTs (reliable across Node versions)
 *         npx tsx scripts/fl-simulator.ts 3
 *
 * Simulates NUM_CLIENTS independent edge-node clients submitting weight payloads
 * for each FL round, driving the server-side FedAvg aggregation pipeline to
 * completion and recording per-round convergence metrics.
 *
 * CONTRACT FINDINGS (from apps/api/src/routes/ml.ts):
 * ─────────────────────────────────────────────────────────────────────────────
 * Round init:        GET  /api/v2/ml/federated/round
 *   → Returns { roundId, roundNumber, modelId, status, minParticipants, submissionsCount }
 *   → Creates a new RUNNING round if none exists; reuses existing RUNNING round
 *   → tenantId resolved via X-Node-ID header (non-prod) or JWT fallback
 *
 * Weight upload:     POST /api/v2/ml/federated/weights/upload   (multipart/form-data)
 *   Fields:
 *     weights     — binary file (application/octet-stream)
 *     roundId     — string UUID of the current round
 *     nodeId      — string (edge node identifier)
 *     sampleCount — integer (local training samples used)
 *     avgReward   — float  (optional, local average reward signal)
 *
 * Aggregation:       Fires AUTOMATICALLY (async) when submissionsCount >= minParticipants (3)
 *   → Calls FederatedAggregator.aggregate(roundId) from @edgecloud/ml-scheduler
 *   → Marks round status = 'COMPLETED'
 *   → Updates fl_models.weightsUrl with aggregated weights in MinIO
 *
 * Round advancement: After aggregation completes, GET /api/v2/ml/federated/round
 *   returns a new round (roundNumber + 1) because the previous one is COMPLETED.
 *
 * Weight format:     Binary float32 array — MODEL_PARAMS × 4 bytes = 50 KB
 *   avgReward improves each round to simulate local model improvement.
 *
 * Node identity:     X-Node-ID header (non-prod) — maps to node's tenantId
 *   Falls back to JWT Bearer token tenant if header absent.
 *
 * MinIO storage:     Weights stored under key `{roundId}_{nodeId}` in fl-weights bucket
 *   weightsUrl format: s3://fl-weights/{roundId}_{nodeId}
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import http from 'http';
import path from 'path';

const API_BASE = 'http://localhost:3090';
const ADMIN_EMAIL = 'admin@demo-org.com';
const ADMIN_PASSWORD = 'Admin123!';
const TENANT_ID = '4ea74167-3624-490c-8a99-a993f14eb574';
const NUM_CLIENTS = 3;
const MODEL_PARAMS = 12500; // float32 values → 50 KB binary

// Node UUIDs from edge_nodes table (tenantId: 4ea74167-3624-490c-8a99-a993f14eb574)
// These must match real edge_nodes.id values — FK constraint on federated_weight_submissions.nodeId
const NODE_IDS = [
  '2e71adcd-3314-47ba-8aa9-6b19ad19ba25', // edge-node-001
  '605332d8-89a2-49f9-98cf-43efad1c21c3', // edge-node-002
  '77206f8b-4682-4454-bdcb-d2571ca19587', // edge-node-003
];

interface RoundInfo {
  roundId: string;
  roundNumber: number;
  modelId: string;
  status: string;
  minParticipants: number;
  submissionsCount: number;
}

interface RoundResult {
  round: number;
  roundId: string;
  clients: ClientResult[];
  aggregationTriggered: boolean;
  roundCompleted: boolean;
}

interface ClientResult {
  nodeId: string;
  sampleCount: number;
  avgReward: number;
  httpStatus: number;
  success: boolean;
  response?: unknown;
  error?: string;
}

/**
 * Generate a mock weight buffer — small random perturbation around a base
 * weight vector, with avgReward signal improving slightly each round to
 * simulate real local training producing converging models over time.
 */
function generateMockWeights(roundNumber: number, clientIndex: number): Buffer {
  const numBytes = MODEL_PARAMS * 4; // float32 = 4 bytes each
  const buf = Buffer.alloc(numBytes);
  for (let i = 0; i < MODEL_PARAMS; i++) {
    // Base weight converges toward 0.5 as rounds progress (simulates learning)
    const convergenceBase = 0.5 - (roundNumber * 0.04) + (clientIndex * 0.005);
    const noise = (Math.random() - 0.5) * 0.08 * (1 / roundNumber); // noise shrinks each round
    const val = convergenceBase + noise;
    buf.writeFloatLE(Math.max(-1, Math.min(1, val)), i * 4);
  }
  return buf;
}

async function auth(): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function getCurrentRound(token: string): Promise<RoundInfo> {
  // Use X-Node-ID header so tenantId resolves correctly in non-prod
  // Routes registered at: /v2/ml/federated/round (from v2-manifest + ml.ts prefix)
  const res = await fetch(`${API_BASE}/v2/ml/federated/round`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Node-ID': NODE_IDS[0], // UUID of edge-node-001 — for tenant resolution
    },
  });
  if (!res.ok) throw new Error(`Get round failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RoundInfo;
}

/**
 * Upload weights using a raw http.request multipart/form-data POST.
 * This avoids the Node 22 native fetch + form-data stream incompatibility.
 */
async function submitWeights(
  token: string,
  roundId: string,
  nodeId: string,
  weights: Buffer,
  sampleCount: number,
  avgReward: number,
  tmpPath: string,
): Promise<ClientResult> {
  fs.writeFileSync(tmpPath, weights);

  const boundary = `----FlSimBoundary${Date.now().toString(16)}`;

  // Build the multipart body as a Buffer
  const parts: Buffer[] = [];
  const nl = Buffer.from('\r\n');
  const dd = Buffer.from(`--${boundary}\r\n`);
  const ddEnd = Buffer.from(`--${boundary}--\r\n`);

  // File field: 'weights'
  parts.push(
    dd,
    Buffer.from(`Content-Disposition: form-data; name="weights"; filename="weights_${nodeId}.bin"\r\n`),
    Buffer.from('Content-Type: application/octet-stream\r\n'),
    nl,
    weights,
    nl,
  );

  // Text fields
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

  try {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL(`${API_BASE}/v2/ml/federated/weights/upload`);
      const req = http.request(
        {
          hostname: url.hostname,
          port: Number(url.port) || 3090,
          path: url.pathname,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Node-ID': nodeId,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    let parsedBody: unknown;
    try { parsedBody = JSON.parse(result.body); } catch { parsedBody = result.body; }

    return {
      nodeId,
      sampleCount,
      avgReward,
      httpStatus: result.status,
      success: result.status === 200 || result.status === 201,
      response: parsedBody,
    };
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

async function pollRoundCompletion(
  token: string,
  roundId: string,
  maxAttempts = 10,
  intervalMs = 3000,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      // Query round status via the federated/round endpoint — it returns
      // a new round once the previous one is COMPLETED, so we check the DB
      // directly via the current round info. If roundNumber increased, aggregation ran.
      const info = await getCurrentRound(token);
      if (info.roundNumber > 1 && attempt === 1) {
        // If we're already on a later round, previous completed
        return true;
      }
      console.log(
        `    Poll ${attempt}/${maxAttempts}: submissionsCount=${info.submissionsCount} status=${info.status}`,
      );
      if (info.status === 'COMPLETED' || info.roundId !== roundId) {
        console.log(`    Round aggregation detected (status=${info.status})`);
        return true;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`    Poll ${attempt} error: ${message}`);
    }
  }
  return false;
}

async function main() {
  const totalRounds = parseInt(process.argv[2] || '3', 10);
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  FL Client Simulator — ${NUM_CLIENTS} clients, ${totalRounds} rounds`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  // Authenticate
  console.log('Phase 0: Authenticating...');
  const token = await auth();
  console.log(`  Token acquired: ${token.slice(0, 20)}...`);

  const allResults: RoundResult[] = [];
  const tmpDir = path.join(process.cwd(), 'tmp_fl_weights');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (let round = 1; round <= totalRounds; round++) {
    console.log(`\n━━━ Round ${round}/${totalRounds} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Get or create the current round
    console.log('  Fetching current round from server...');
    let roundInfo: RoundInfo;
    try {
      roundInfo = await getCurrentRound(token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  HARD STOP: Cannot get round info: ${message}`);
      break;
    }
    console.log(
      `  Round: id=${roundInfo.roundId.slice(0, 8)}... number=${roundInfo.roundNumber} ` +
      `status=${roundInfo.status} minParticipants=${roundInfo.minParticipants} ` +
      `submissions=${roundInfo.submissionsCount}`,
    );

    if (roundInfo.status !== 'RUNNING') {
      console.warn(`  Round is not RUNNING (status=${roundInfo.status}), skipping`);
      continue;
    }

    const roundResults: ClientResult[] = [];
    let submissionSuccesses = 0;

    // All NUM_CLIENTS submit weights for this round
    for (let clientIdx = 0; clientIdx < NUM_CLIENTS; clientIdx++) {
      const nodeId = NODE_IDS[clientIdx];
      const weights = generateMockWeights(round, clientIdx);
      const sampleCount = Math.floor(Math.random() * 400) + 100; // 100–500
      // avgReward improves each round to simulate learning convergence
      const avgReward = parseFloat((0.4 + round * 0.08 + (Math.random() * 0.06)).toFixed(4));
      const tmpPath = path.join(tmpDir, `weights_r${round}_c${clientIdx}.bin`);

      console.log(
        `  Submitting: client=${clientIdx + 1}/${NUM_CLIENTS} nodeId=${nodeId} ` +
        `sampleCount=${sampleCount} avgReward=${avgReward}`,
      );

      try {
        const result = await submitWeights(
          token,
          roundInfo.roundId,
          nodeId,
          weights,
          sampleCount,
          avgReward,
          tmpPath,
        );
        const statusIcon = result.success ? '✓' : '✗';
        console.log(`    ${statusIcon} HTTP ${result.httpStatus}: ${JSON.stringify(result.response)}`);
        roundResults.push(result);
        if (result.success) submissionSuccesses++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`    ✗ Client ${clientIdx + 1} threw: ${message}`);
        roundResults.push({
          nodeId,
          sampleCount,
          avgReward,
          httpStatus: 0,
          success: false,
          error: message,
        });
      }

      // Small delay between clients
      if (clientIdx < NUM_CLIENTS - 1) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    const aggregationTriggered = submissionSuccesses >= roundInfo.minParticipants;
    console.log(
      `\n  Submissions: ${submissionSuccesses}/${NUM_CLIENTS} succeeded. ` +
      `Aggregation triggered: ${aggregationTriggered}`,
    );

    // Poll for round advancement (aggregation runs async on server side)
    let roundCompleted = false;
    if (aggregationTriggered) {
      console.log(`  Polling for aggregation completion (10 × 3s)...`);
      roundCompleted = await pollRoundCompletion(token, roundInfo.roundId);
      console.log(`  Round completed: ${roundCompleted}`);
    }

    allResults.push({
      round,
      roundId: roundInfo.roundId,
      clients: roundResults,
      aggregationTriggered,
      roundCompleted,
    });

    // Brief pause before next round
    if (round < totalRounds) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Cleanup tmp dir
  if (fs.existsSync(tmpDir)) {
    try { fs.rmdirSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }

  // Write results
  const outputPath = path.join(process.cwd(), 'fl-simulator-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Simulation Complete`);
  console.log(`╚══════════════════════════════════════════════════╝`);
  console.log(`Results written to: fl-simulator-results.json\n`);

  // Print summary table
  console.log('Per-round summary:');
  for (const r of allResults) {
    const successes = r.clients.filter((c) => c.success).length;
    const avgReward =
      r.clients
        .filter((c) => c.avgReward !== undefined)
        .reduce((sum, c) => sum + c.avgReward, 0) / Math.max(r.clients.length, 1);
    console.log(
      `  Round ${r.round}: ${successes}/${NUM_CLIENTS} submitted | ` +
      `avgReward=${avgReward.toFixed(4)} | ` +
      `aggregated=${r.aggregationTriggered} | completed=${r.roundCompleted}`,
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
