import axios from "axios";
import { v4 as uuidv4 } from "uuid";

/**
 * Mock Edge Agent
 *
 * Simulates a real edge agent for local development.
 * - Registers with the API
 * - Polls for tasks
 * - Reports execution progress and completion
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3090";
const NODE_NAME = process.env.NODE_NAME || `mock-agent-${uuidv4().slice(0, 8)}`;
const POLL_INTERVAL_MS = 2000;
const FAILURE_RATE = 0.1; // 10% chance of failure

async function main() {
  console.log(`🚀 Mock Agent [${NODE_NAME}] starting...`);
  console.log(`📡 Connecting to API at ${API_BASE_URL}`);

  let nodeId: string | null = null;

  // 1. Registration
  try {
    const regResponse = await axios.post(`${API_BASE_URL}/v2/agents/register`, {
      name: NODE_NAME,
      location: "Local Developer Machine",
      region: "dev-local",
      ipAddress: "127.0.0.1",
      port: 0, // Mock
      cpuCores: 4,
      memoryGB: 16,
      storageGB: 100,
    });
    nodeId = regResponse.data.id;
    console.log(`✅ Registered successfully. Node ID: ${nodeId}`);
  } catch (error: any) {
    console.error(`❌ Registration failed: ${error.message}`);
    process.exit(1);
  }

  // 2. Polling Loop
  setInterval(async () => {
    try {
      // Send Heartbeat & Get Tasks
      const heartbeatResponse = await axios.post(
        `${API_BASE_URL}/v2/agents/${nodeId}/heartbeat`,
        {
          cpuUsage: Math.random() * 50,
          memoryUsage: Math.random() * 40,
          storageUsage: 10,
          tasksRunning: 0, // Simplified
        },
      );

      const tasks = heartbeatResponse.data.pendingTasks || [];
      if (tasks.length > 0) {
        console.log(`📥 Received ${tasks.length} new tasks`);
        for (const task of tasks) {
          void executeTask(task);
        }
      }
    } catch (error: any) {
      console.error(`⚠️ Polling error: ${error.message}`);
    }
  }, POLL_INTERVAL_MS);
}

async function executeTask(task: any) {
  console.log(`⚙️ Executing Task [${task.id}]: ${task.name}...`);

  // Transition to RUNNING
  try {
    await axios.patch(`${API_BASE_URL}/v2/tasks/${task.id}/status`, {
      status: "RUNNING",
      startedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      `Failed to update task ${task.id} to RUNNING: ${error.message}`,
    );
    return;
  }

  // Simulate work (500ms to 2000ms)
  const duration = Math.floor(Math.random() * 1500) + 500;
  await new Promise((resolve) => setTimeout(resolve, duration));

  // Determine outcome
  const isFailed = Math.random() < FAILURE_RATE;

  try {
    if (isFailed) {
      console.error(`❌ Task [${task.id}] FAILED simulation`);
      await axios.patch(`${API_BASE_URL}/v2/tasks/${task.id}/status`, {
        status: "FAILED",
        error: "Simulated random failure for retry testing",
        completedAt: new Date().toISOString(),
      });
    } else {
      console.log(
        `✨ Task [${task.id}] COMPLETED successfully in ${duration}ms`,
      );
      await axios.patch(`${API_BASE_URL}/v2/tasks/${task.id}/status`, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        output: {
          result: "Mock success",
          durationMs: duration,
          processedItems: Math.floor(Math.random() * 100),
        },
      });
    }
  } catch (error: any) {
    console.error(
      `Failed to report result for task ${task.id}: ${error.message}`,
    );
  }
}

main().catch((err) => {
  console.error("Fatal agent error:", err);
  process.exit(1);
});
