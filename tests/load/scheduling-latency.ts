import axios from "axios";
import fs from "fs";
import path from "path";

const API_URL = "http://127.0.0.1:3000/v2";
const TASK_COUNT = 1000;
const REQ_PER_SEC = 100;

import jwt from "jsonwebtoken";

async function measureLatency() {
  console.log("🚀 Starting Scheduling Latency Load Test");

  // 0. Get token (mock or real)
  const token = jwt.sign(
    {
      id: "load-test-user",
      email: "load@test.com",
      role: "ADMIN",
      tenantId: "test-tenant",
    },
    process.env.JWT_SECRET || "load_test_secret_at_least_32_chars_long",
  );

  // 1. Setup nodes
  console.log("Registering 100 edge nodes via API...");
  const nodeIds: string[] = [];
  const regConcurrency = 10;
  for (let i = 0; i < 100; i += regConcurrency) {
    const batch = Array.from({ length: regConcurrency }).map((_, j) =>
      axios.post(
        `${API_URL}/nodes`,
        {
          name: `LatNode-${i + j}`,
          location: "New York, US",
          ipAddress: `127.0.0.1`,
          port: 3000 + i + j,
          region: "us-east-1",
          cpuCores: 4,
          memoryGB: 8,
          storageGB: 100,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );
    const responses = await Promise.all(batch);
    responses.forEach((r) => nodeIds.push(r.data.id));
  }
  console.log(`✅ Registered 100 nodes. Example ID: ${nodeIds[0]}`);

  // 2. Prepare tasks
  const tasks = Array.from({ length: TASK_COUNT }).map((_, i) => ({
    name: `LatTask-${i}`,
    type: "MODEL_INFERENCE",
    priority: "MEDIUM",
    target: "EDGE",
    input: { data: "test" },
    specs: { cpuCores: 1, memoryGB: 1 },
    maxRetries: 3,
    runtime: "NATIVE",
  }));

  console.log(`Firing ${TASK_COUNT} tasks at ${REQ_PER_SEC} req/sec...`);

  const startTimes = new Map<string, number>();
  const latencies: number[] = [];
  let submitted = 0;

  const interval = 1000 / REQ_PER_SEC;

  for (const task of tasks) {
    const startTime = Date.now();
    try {
      const resp = await axios.post(`${API_URL}/tasks`, task, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const taskId = resp.data.id;
      startTimes.set(taskId, startTime);
      submitted++;
    } catch (err: any) {
      console.error(`Failed to submit task: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  console.log(`Submitted ${submitted} tasks. Monitoring scheduling...`);

  // 3. Monitor scheduling
  const completedTasks = new Set<string>();
  const timeout = Date.now() + 60000; // 1 minute timeout

  while (completedTasks.size < submitted && Date.now() < timeout) {
    try {
      const resp = await axios.get(`${API_URL}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const taskList = Array.isArray(resp.data) ? resp.data : resp.data.data;
      const scheduledTasks = taskList.filter(
        (t: any) => t.status === "SCHEDULED" && startTimes.has(t.id),
      );

      for (const task of scheduledTasks) {
        if (!completedTasks.has(task.id)) {
          // In mock mode, we use the current time as endTime if scheduledAt is missing
          const endTime = task.scheduledAt
            ? new Date(task.scheduledAt).getTime()
            : Date.now();
          const startTime = startTimes.get(task.id)!;
          latencies.push(endTime - startTime);
          if (completedTasks.size % 100 === 0)
            console.log(`Scheduled ${completedTasks.size}/${submitted}...`);
          completedTasks.add(task.id);
        }
      }
    } catch (err: any) {
      console.error(`Failed to poll tasks: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 200)); // Poll every 200ms
  }

  // 4. Calculate Statistics
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  const results = {
    totalTasks: submitted,
    scheduledTasks: completedTasks.size,
    avgMs: Math.round(avg),
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    latencies: latencies.slice(0, 100), // Keep some samples
  };

  console.log("\n--- Latency Results ---");
  console.log(`Average: ${results.avgMs}ms`);
  console.log(`P50: ${results.p50Ms}ms`);
  console.log(`P99: ${results.p99Ms}ms`);

  const resultsPath = path.join(
    __dirname,
    "results",
    "scheduling-latency.json",
  );
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  // Assertions
  if (p50 > 20)
    console.error(`❌ P50 Latency too high: ${p50}ms (Limit: 20ms)`);
  else console.log("✅ P50 Latency within limits");

  if (p99 > 50)
    console.error(`❌ P99 Latency too high: ${p99}ms (Limit: 50ms)`);
  else console.log("✅ P99 Latency within limits");
}

measureLatency().catch(console.error);
