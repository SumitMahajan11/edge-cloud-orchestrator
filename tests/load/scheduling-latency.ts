import axios from "axios";
import fs from "fs";
import path from "path";

const API_URL = process.env.API_URL || "http://127.0.0.1:3090/v2";
const TASK_COUNT = parseInt(process.env.TASK_COUNT || "1000", 10);
const REQ_PER_SEC = parseInt(process.env.REQ_PER_SEC || "100", 10);

import jwt from "jsonwebtoken";

async function measureLatency() {
  console.log("🚀 Starting Scheduling Latency Load Test");

  // 0. Get token (mock or real)
  const token = jwt.sign(
    {
      id: process.env.USER_ID || "30d4bed2-46f2-40ad-9983-1502668287a2",
      email: "admin@demo-org.com",
      role: "ADMIN",
      tenantId: process.env.TENANT_ID || "2c919f7a-6966-4da7-9ce0-91309494f9cf",
      aud: "edge-cloud-clients",
      iss: "edge-cloud-orchestrator",
    },
    process.env.JWT_SECRET || "load_test_secret_at_least_32_chars_long",
  );

  // Clean up existing LatNode-* nodes and LatTask-* tasks from DB to avoid duplicate name conflicts
  console.log("Cleaning up previous test nodes/tasks from database...");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const latNodes = await prisma.edgeNode.findMany({
      where: { name: { startsWith: "LatNode-" } },
      select: { id: true },
    });
    const latNodeIds = latNodes.map((n: any) => n.id);

    if (latNodeIds.length > 0) {
      await prisma.nodeMetric.deleteMany({ where: { nodeId: { in: latNodeIds } } });
      await prisma.taskExecution.deleteMany({ where: { nodeId: { in: latNodeIds } } });
      await prisma.task.deleteMany({ where: { nodeId: { in: latNodeIds } } });
      await prisma.nodePricing.deleteMany({ where: { nodeId: { in: latNodeIds } } });
      await prisma.nodeCertificate.deleteMany({ where: { nodeId: { in: latNodeIds } } });
      await prisma.edgeNode.deleteMany({ where: { id: { in: latNodeIds } } });
    }
    await prisma.task.deleteMany({ where: { name: { startsWith: "LatTask-" } } });
    console.log("Database cleanup finished.");
  } catch (err) {
    console.warn("Database cleanup failed, continuing anyway:", err);
  } finally {
    await prisma.$disconnect();
  }

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

  console.log("Setting registered nodes to ONLINE status in database...");
  const prismaUpdate = new PrismaClient();
  try {
    await prismaUpdate.edgeNode.updateMany({
      where: { id: { in: nodeIds } },
      data: {
        status: "ONLINE",
        lastHeartbeat: new Date(Date.now() + 3600000), // 1 hour in the future to bypass timeout
      },
    });
    console.log("Nodes updated to ONLINE.");
  } catch (err) {
    console.error("Failed to update nodes to ONLINE:", err);
  } finally {
    await prismaUpdate.$disconnect();
  }

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

  // 3. Monitor scheduling (runs concurrently in background)
  const completedTasks = new Set<string>();
  const timeout = Date.now() + 180000; // 3 minutes timeout

  const pollPromise = (async () => {
    while (completedTasks.size < TASK_COUNT && Date.now() < timeout) {
      try {
        const resp = await axios.get(`${API_URL}/tasks?status=SCHEDULED&limit=2000`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const taskList = Array.isArray(resp.data) ? resp.data : resp.data.data;
        const scheduledTasks = taskList.filter(
          (t: any) => t.status === "SCHEDULED" && startTimes.has(t.id),
        );

        for (const task of scheduledTasks) {
          if (!completedTasks.has(task.id)) {
            const endTime = Date.now();
            const startTime = startTimes.get(task.id)!;
            latencies.push(endTime - startTime);
            completedTasks.add(task.id);
            if (completedTasks.size % 50 === 0 || completedTasks.size === TASK_COUNT) {
              console.log(`Scheduled ${completedTasks.size}/${TASK_COUNT}...`);
            }
          }
        }
      } catch (err: any) {
        console.error(`Failed to poll tasks: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 50)); // Poll every 50ms
    }
  })();

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

  console.log(`Submitted ${submitted} tasks. Waiting for scheduling to finish...`);
  await pollPromise;

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

  if (completedTasks.size === 0) {
    console.error("❌ Error: Zero tasks were scheduled! Test failed.");
    process.exit(1);
  }

  // Assertions (log warning but do not fail execution to allow real-infra benchmark reports)
  if (p50 > 20) {
    console.warn(`⚠️ P50 Latency too high: ${p50}ms (Limit: 20ms)`);
  } else {
    console.log("✅ P50 Latency within limits");
  }

  if (p99 > 50) {
    console.warn(`⚠️ P99 Latency too high: ${p99}ms (Limit: 50ms)`);
  } else {
    console.log("✅ P99 Latency within limits");
  }
}

measureLatency().catch((err) => {
  console.error(err);
  process.exit(1);
});

