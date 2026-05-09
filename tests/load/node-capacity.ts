import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function measureCapacity() {
  const results: any[] = [];
  const levels = [1000, 5000, 10000]; // Reduced from 50k for speed in mock mode
  
  console.log('🚀 Starting Node Capacity Load Test (API-based)');
  
  // Get token
  const token = jwt.sign(
    { id: 'load-test-user', email: 'load@test.com', role: 'ADMIN', tenantId: 'test-tenant' },
    process.env.JWT_SECRET || 'load_test_secret_at_least_32_chars_long'
  );

  const API_URL = 'http://127.0.0.1:3000/v2';

  const nodeIds: string[] = [];

  for (const level of levels) {
    // 1. Register nodes to reach level
    const currentCount = nodeIds.length;
    const toAdd = level - currentCount;
    
    if (toAdd > 0) {
      console.log(`\n--- Testing ${level} nodes (Adding ${toAdd}) ---`);
      
      const startReg = Date.now();
      const concurrency = 20;
      for (let i = 0; i < toAdd; i += concurrency) {
        const batch = [];
        for (let j = 0; j < concurrency && (i + j) < toAdd; j++) {
          batch.push(axios.post(`${API_URL}/nodes`, {
            name: `CapNode-${currentCount + i + j}`,
            location: 'Washington, DC',
            ipAddress: `127.0.0.${Math.floor((currentCount + i + j) / 254) + 1}`,
            port: (currentCount + i + j) % 60000 + 1024,
            region: 'us-east-1',
            cpuCores: 4,
            memoryGB: 8,
            storageGB: 100
          }, {
            headers: { Authorization: `Bearer ${token}` }
          }));
        }
        const responses = await Promise.all(batch);
        responses.forEach(r => nodeIds.push(r.data.id));
        if (i % 500 === 0) process.stdout.write('.');
      }
      console.log(`\n✅ Registered in ${Date.now() - startReg}ms`);
    }

    // 2. Measure Heartbeat Processing Time
    const startHeartbeat = Date.now();
    for (let i = 0; i < 100; i++) {
      const nodeId = nodeIds[Math.floor(Math.random() * nodeIds.length)];
      await axios.post(`${API_URL}/nodes/${nodeId}/heartbeat`, {
        cpuUsage: Math.random() * 100,
        memoryUsage: Math.random() * 100,
        tasksRunning: Math.floor(Math.random() * 5)
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }
    const heartbeatDuration = (Date.now() - startHeartbeat) / 100;
    
    // 3. Measure List Query Time
    const startQuery = Date.now();
    await axios.get(`${API_URL}/nodes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const queryDuration = Date.now() - startQuery;
    
    // 4. Memory Usage
    const memory = process.memoryUsage();
    
    const result = {
      level,
      heartbeatMs: Math.round(heartbeatDuration),
      queryMs: queryDuration,
      memoryMB: Math.round(memory.heapUsed / 1024 / 1024),
    };
    
    results.push(result);
    console.log(`Result: ${JSON.stringify(result, null, 2)}`);
  }
  
  const resultsPath = path.join(__dirname, 'results', 'node-capacity.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Results saved to ${resultsPath}`);
}

measureCapacity().catch(console.error);
