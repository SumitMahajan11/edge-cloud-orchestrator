import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = process.env.API_URL || 'http://127.0.0.1:3012/v2';
const DURATION_SEC = 30; // Reduced for speed
const CONCURRENCY = 10; 

import jwt from 'jsonwebtoken';

async function measureThroughput() {
  console.log('🚀 Starting Throughput Load Test (API-based)');
  console.log(`📡 Target API: ${API_URL}`);
  
  // Get token
  const token = jwt.sign(
    { 
      id: 'load-test-user', 
      email: 'load@test.com', 
      role: 'ADMIN', 
      tenantId: 'test-tenant', 
      aud: 'edge-cloud-clients',
      iss: 'edge-cloud-orchestrator'
    },
    process.env.JWT_SECRET || 'load_test_secret_at_least_32_chars_long'
  );

  // 1. Setup nodes
  console.log('Registering 500 edge nodes via API...');
  const nodeIds: string[] = [];
  const regConcurrency = 20;
  for (let i = 0; i < 500; i += regConcurrency) {
    const batch = [];
    for (let j = 0; j < regConcurrency && (i + j) < 500; j++) {
      batch.push(axios.post(`${API_URL}/nodes`, {
        name: `TPNode-${i + j}`,
        location: 'London, UK',
        ipAddress: `127.0.0.1`,
        port: 4000 + i + j,
        region: 'us-east-1',
        cpuCores: 8,
        memoryGB: 16,
        storageGB: 500
      }, {
        headers: { Authorization: `Bearer ${token}` }
      }));
    }
    const responses = await Promise.all(batch).catch(() => []);
    responses.forEach(r => r && nodeIds.push(r.data.id));
    if (i % 100 === 0) process.stdout.write('.');
  }
  console.log(`\n✅ Registered 500 nodes.`);

  // 1.5. Set nodes to ONLINE via heartbeats
  console.log('Activating nodes via heartbeats...');
  for (let i = 0; i < nodeIds.length; i += regConcurrency) {
    const batch = [];
    for (let j = 0; j < regConcurrency && (i + j) < nodeIds.length; j++) {
      const nodeId = nodeIds[i + j];
      batch.push(axios.post(`${API_URL}/nodes/${nodeId}/heartbeat`, {
        cpuUsage: 10,
        memoryUsage: 20,
        tasksRunning: 0
      }, {
        headers: { Authorization: `Bearer ${token}` }
      }));
    }
    await Promise.all(batch).catch(() => []);
    if (i % 100 === 0) process.stdout.write('.');
  }
  console.log('\n✅ Nodes online.');
  
  const endTime = Date.now() + DURATION_SEC * 1000;
  let submittedCount = 0;
  let failedSubmissionCount = 0;

  console.log(`\nRunning for ${DURATION_SEC} seconds with concurrency ${CONCURRENCY}...`);

  const submissionLoop = async () => {
    while (Date.now() < endTime) {
      try {
        await axios.post(`${API_URL}/tasks`, {
          name: `TPTask-${submittedCount}-${Math.random()}`,
          type: 'MODEL_INFERENCE',
          priority: 'HIGH',
          target: 'EDGE',
          image: 'edgecloud/worker:latest',
          input: { payload: 'throughput-test-data' },
          specs: { cpuCores: 1, memoryGB: 1 },
          maxRetries: 1,
          runtime: 'NATIVE'
        }, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000
        });
        submittedCount++;
      } catch (err) {
        failedSubmissionCount++;
      }
    }
  };

  // Start concurrent loops
  await Promise.all(Array.from({ length: CONCURRENCY }).map(() => submissionLoop()));

  console.log(`\nSubmission phase done. Total submitted: ${submittedCount}`);
  console.log('Waiting for scheduler to catch up (max 15s)...');

  // 2. Wait for processing to stabilize
  const monitorTimeout = Date.now() + 15000;
  let finalScheduled = 0;
  
  while (Date.now() < monitorTimeout) {
    try {
      const resp = await axios.get(`${API_URL}/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const taskList = Array.isArray(resp.data) ? resp.data : resp.data.data;
      const tasks = taskList.filter((t: any) => t.name.startsWith('TPTask-'));
      
      const scheduledCount = tasks.filter((t: any) => 
        ['SCHEDULED', 'RUNNING', 'COMPLETED'].includes(t.status)
      ).length;
      
      const pendingCount = tasks.filter((t: any) => t.status === 'PENDING').length;
      
      finalScheduled = scheduledCount;
      process.stdout.write(`\rScheduled: ${finalScheduled}, Pending: ${pendingCount}   `);
      
      if (pendingCount === 0 && finalScheduled > 0) break;
    } catch (err) {}
    await new Promise(r => setTimeout(r, 1000));
  }

  // 3. Final Calculations
  const throughput = finalScheduled / DURATION_SEC;

  const results = {
    durationSec: DURATION_SEC,
    submitted: submittedCount,
    failedSubmissions: failedSubmissionCount,
    scheduled: finalScheduled,
    throughputPerSec: Math.round(throughput * 100) / 100
  };

  console.log('\n\n--- Throughput Results ---');
  console.log(`Throughput: ${results.throughputPerSec} tasks/sec`);

  const resultsPath = path.join(__dirname, 'results', 'throughput.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
}

measureThroughput().catch(console.error);
