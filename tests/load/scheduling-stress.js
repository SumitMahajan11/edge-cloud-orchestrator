import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

// ── Custom Metrics ────────────────────────────────────────────────────────────

const taskSubmissions = new Counter("task_submissions_total");
const schedulingLatency = new Trend("scheduling_latency_ms", true);
const schedulingSuccessRate = new Rate("scheduling_success_rate");

// ── Test Config ───────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3090";
const API_KEY = __ENV.API_KEY || "test-key";

export const options = {
  scenarios: {
    // Scenario 1: 500 concurrent task submissions
    stress_test: {
      executor: "constant-vus",
      vus: 500,
      duration: "30s", // Run for 30s as a verification baseline
      startTime: "0s",
      gracefulStop: "10s",
    },
  },

  thresholds: {
    // 95% of task submissions must succeed
    scheduling_success_rate: ["rate>0.95"],

    // 95% of scheduling decisions must happen within 2 seconds
    scheduling_latency_ms: ["p(95)<2000"],

    // HTTP error rate must be below 5%
    http_req_failed: ["rate<0.05"],

    // All task submission responses under 5 seconds
    "http_req_duration{scenario:stress_test}": ["p(99)<5000"],
  },
};

// ── Test Data ─────────────────────────────────────────────────────────────────

const IMAGES = ["alpine:latest", "busybox:latest", "hello-world:latest"];

function randomImage() {
  return IMAGES[Math.floor(Math.random() * IMAGES.length)];
}

// ── Default Function (runs for each VU) ──────────────────────────────────────

export default function () {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };

  // Step 1: Submit a task
  const submitStart = Date.now();
  const submitRes = http.post(
    `${BASE_URL}/v2/tasks`,
    JSON.stringify({
      name: `stress-task-${__VU}-${__ITER}`,
      type: "DATA_PROCESSING",
      priority: "MEDIUM",
      target: "EDGE",
      runtime: "DOCKER",
      image: randomImage(),
      input: {
        command: ["echo", `load-test-${__VU}-${__ITER}`]
      },
      specs: {
        memoryMB: 128,
        cpuCores: 1
      },
      maxRetries: 1,
    }),
    { headers, timeout: "10s" },
  );

  taskSubmissions.add(1);

  const submitOk = check(submitRes, {
    "task submitted (201/202)": (r) => r.status === 201 || r.status === 202,
    "response has task id": (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.id === "string" && body.id.length > 0;
      } catch {
        return false;
      }
    },
  });

  if (!submitOk) {
    schedulingSuccessRate.add(0);
    return;
  }

  const taskId = JSON.parse(submitRes.body).id;

  // Step 2: Poll for scheduling (task should leave PENDING within 10s)
  let scheduled = false;
  const pollDeadline = Date.now() + 10_000;

  while (Date.now() < pollDeadline) {
    const pollRes = http.get(`${BASE_URL}/v2/tasks/${taskId}`, {
      headers,
      timeout: "3s",
    });

    if (pollRes.status === 200) {
      try {
        const body = JSON.parse(pollRes.body);
        if (body.status !== "PENDING") {
          scheduled = true;
          break;
        }
      } catch {
        // Ignore parse errors, keep polling
      }
    }

    sleep(0.5);
  }

  const latency = Date.now() - submitStart;
  schedulingLatency.add(latency);
  schedulingSuccessRate.add(scheduled ? 1 : 0);

  check(null, {
    "task scheduled within 10s": () => scheduled,
  });

  // Small think time between iterations
  sleep(Math.random() * 0.5);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

export function setup() {
  // Verify the API is reachable before starting the test
  const res = http.get(`${BASE_URL}/health`, { timeout: "5s" });
  if (res.status !== 200) {
    throw new Error(
      `API not ready (status ${res.status}). Aborting load test.`,
    );
  }
  console.log(`✅ API is ready at ${BASE_URL}`);
}

export function handleSummary(data) {
  return {
    stdout: generateTextSummary(data),
    "tests/load/results/stress-summary.json": JSON.stringify(data, null, 2),
  };
}

function generateTextSummary(data) {
  const metrics = data.metrics;
  const successRate = metrics["scheduling_success_rate"]?.values?.rate ?? 0;
  const p95Latency = metrics["scheduling_latency_ms"]?.values?.["p(95)"] ?? 0;
  const p99Latency = metrics["scheduling_latency_ms"]?.values?.["p(99)"] ?? 0;
  const httpFailed = metrics["http_req_failed"]?.values?.rate ?? 0;

  return `
  ═══════════════════════════════════════
    Edge-Cloud Orchestrator — Stress Test
  ═══════════════════════════════════════
    Scheduling success rate:  ${(successRate * 100).toFixed(1)}%  (threshold: >95%)
    Scheduling P95 latency:   ${p95Latency.toFixed(0)}ms  (threshold: <2000ms)
    Scheduling P99 latency:   ${p99Latency.toFixed(0)}ms
    HTTP error rate:          ${(httpFailed * 100).toFixed(2)}%  (threshold: <5%)
  ═══════════════════════════════════════
  `;
}
