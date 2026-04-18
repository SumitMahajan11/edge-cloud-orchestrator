import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';

/**
 * Load test for node-service heartbeats.
 * Simulates 10,000 heartbeats and measures response time and batch processing.
 */

const BASE_URL = 'https://localhost:3002';
const NODE_COUNT = 10000;
const CONCURRENCY = 100; // Number of parallel requests

// mTLS Config
const httpsAgent = new https.Agent({
  cert: fs.readFileSync(path.join(__dirname, '../../../../infra/certs/api.crt')),
  key: fs.readFileSync(path.join(__dirname, '../../../../infra/certs/api.key')),
  ca: fs.readFileSync(path.join(__dirname, '../../../../infra/certs/ca.crt')),
  rejectUnauthorized: false, // For localhost testing
});

async function runLoadTest() {
  console.log(`Starting load test: ${NODE_COUNT} heartbeats...`);
  
  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;
  
  const nodeIds = Array.from({ length: NODE_COUNT }, (_, i) => `node-${i}`);
  
  const latencies: number[] = [];

  async function sendHeartbeat(nodeId: string) {
    const start = Date.now();
    try {
      await axios.post(`${BASE_URL}/nodes/${nodeId}/heartbeat`, {
        cpuUsage: Math.random() * 100,
        memoryUsage: Math.random() * 100,
        storageUsage: Math.random() * 100,
        latency: Math.random() * 50,
        tasksRunning: Math.floor(Math.random() * 10)
      }, { httpsAgent, timeout: 5000 });
      
      latencies.push(Date.now() - start);
      successCount++;
    } catch (err) {
      errorCount++;
    }
  }

  // Process in batches of concurrency
  for (let i = 0; i < nodeIds.length; i += CONCURRENCY) {
    const batch = nodeIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(id => sendHeartbeat(id)));
    
    if (i % 1000 === 0) {
      console.log(`Progress: ${i}/${NODE_COUNT}...`);
    }
  }

  const totalTime = Date.now() - startTime;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

  console.log('--- Results ---');
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Avg Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`P95 Latency: ${p95Latency.toFixed(2)}ms`);
  console.log(`Throughput: ${(successCount / (totalTime / 1000)).toFixed(2)} req/s`);

  if (p95Latency < 100) {
    console.log('SUCCESS: P95 Latency under 100ms');
  } else {
    console.error('FAILURE: P95 Latency exceeded 100ms');
    process.exit(1);
  }
}

runLoadTest().catch(err => {
  console.error('Load test failed:', err);
  process.exit(1);
});
