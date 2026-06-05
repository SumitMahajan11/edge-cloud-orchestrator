// ─────────────────────────────────────────────────────────────────────────────
// tests/smoke/staging.smoke.test.ts
//
// Smoke tests run after every staging deployment.
// They verify that the system is alive and critical paths are functional —
// not that every feature works (that's integration tests).
//
// Runs via: pnpm run test:smoke
// Required env: SMOKE_BASE_URL, SMOKE_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const API_KEY = process.env.SMOKE_API_KEY ?? "";
const TIMEOUT_MS = 10_000;
const RESULTS_DIR = join(process.cwd(), "tests/smoke/results");

// All services and their expected health endpoints
const SERVICES = [
  { name: "api", port: 3001, path: "/health/ready" },
  { name: "api-gateway", port: 80, path: "/health" },
  { name: "scheduler-service", port: 3002, path: "/health/ready" },
  { name: "task-service", port: 3003, path: "/health/ready" },
  { name: "node-service", port: 3004, path: "/health/ready" },
  { name: "websocket-gateway", port: 3005, path: "/health/ready" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

function authHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
}

// ── Test Results Collector ────────────────────────────────────────────────────

interface SmokeResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const results: SmokeResult[] = [];

function recordResult(
  name: string,
  passed: boolean,
  durationMs: number,
  error?: string,
) {
  results.push({ name, passed, durationMs, error });
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await mkdir(RESULTS_DIR, { recursive: true });
  console.log(`\n🔍 Smoke tests targeting: ${BASE_URL}\n`);
});

afterAll(async () => {
  // Write results JSON for CI artifact upload
  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };

  await writeFile(
    join(RESULTS_DIR, "smoke-results.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log(
    `\n📊 Smoke test summary: ${summary.passed}/${summary.total} passed`,
  );
  if (summary.failed > 0) {
    console.log("❌ Failed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`   - ${r.name}: ${r.error}`));
  }
});

// ── Health Checks ─────────────────────────────────────────────────────────────

describe("Health endpoints", () => {
  for (const service of SERVICES) {
    it(`${service.name} should return 200 on ${service.path}`, async () => {
      const start = Date.now();
      const url = apiUrl(`/services/${service.name}${service.path}`);

      try {
        const res = await fetchWithTimeout(url);
        const duration = Date.now() - start;
        recordResult(`health:${service.name}`, res.ok, duration);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toMatch(/^(ok|healthy|ready)$/i);
      } catch (err) {
        const duration = Date.now() - start;
        const error = err instanceof Error ? err.message : "unknown error";
        recordResult(`health:${service.name}`, false, duration, error);
        throw err;
      }
    });
  }
});

// ── Critical Path: Authentication ────────────────────────────────────────────

describe("Authentication", () => {
  it("rejects requests without credentials", async () => {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(apiUrl("/v1/tasks"));
      recordResult(
        "auth:reject-unauthenticated",
        res.status === 401,
        Date.now() - start,
      );
      expect(res.status).toBe(401);
    } catch (err) {
      recordResult(
        "auth:reject-unauthenticated",
        false,
        Date.now() - start,
        String(err),
      );
      throw err;
    }
  });

  it("accepts valid credentials and returns 200", async () => {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(apiUrl("/v1/tasks"), {
        headers: authHeaders(),
      });
      const ok = res.status === 200 || res.status === 204;
      recordResult("auth:valid-credentials", ok, Date.now() - start);
      expect(ok).toBe(true);
    } catch (err) {
      recordResult(
        "auth:valid-credentials",
        false,
        Date.now() - start,
        String(err),
      );
      throw err;
    }
  });
});

// ── Critical Path: Node Service Heartbeat ────────────────────────────────────

describe("Node Service — Heartbeat pipeline", () => {
  it("reports at least one online node within 15 seconds of startup", async () => {
    const start = Date.now();

    // Poll the node list until we see an online node or timeout
    const deadline = Date.now() + 15_000;
    let onlineCount = 0;

    while (Date.now() < deadline) {
      try {
        const res = await fetchWithTimeout(
          apiUrl("/v1/nodes?status=ONLINE"),
          { headers: authHeaders() },
          5_000,
        );

        if (res.ok) {
          const body = (await res.json()) as {
            nodes: unknown[];
            total: number;
          };
          onlineCount = body.total ?? body.nodes?.length ?? 0;
          if (onlineCount > 0) break;
        }
      } catch {
        // Retry on network errors
      }

      await new Promise((r) => setTimeout(r, 2_000));
    }

    const duration = Date.now() - start;
    recordResult(
      "nodes:heartbeat-pipeline",
      onlineCount > 0,
      duration,
      onlineCount === 0 ? "No online nodes detected within 15s" : undefined,
    );

    expect(onlineCount).toBeGreaterThan(0);
  });

  it("heartbeat data is fresh (last seen < 15 seconds ago)", async () => {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(
        apiUrl("/v1/nodes?status=ONLINE&limit=1"),
        { headers: authHeaders() },
      );

      expect(res.ok).toBe(true);
      const body = (await res.json()) as {
        nodes: Array<{ lastSeenAt: string }>;
      };

      if (body.nodes.length > 0) {
        const lastSeen = new Date(body.nodes[0].lastSeenAt).getTime();
        const staleness = Date.now() - lastSeen;
        recordResult(
          "nodes:heartbeat-freshness",
          staleness < 15_000,
          Date.now() - start,
          staleness >= 15_000
            ? `Last heartbeat was ${staleness}ms ago`
            : undefined,
        );

        expect(staleness).toBeLessThan(15_000);
      }
    } catch (err) {
      recordResult(
        "nodes:heartbeat-freshness",
        false,
        Date.now() - start,
        String(err),
      );
      throw err;
    }
  });
});

// ── Critical Path: Task Submission ───────────────────────────────────────────

describe("Task submission — end-to-end", () => {
  let createdTaskId: string | null = null;

  it("accepts a valid task submission", async () => {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(apiUrl("/v1/tasks"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          image: "alpine:latest",
          command: ["echo", "smoke-test"],
          priority: "NORMAL",
          maxRetries: 1,
          memoryMb: 128,
        }),
      });

      const ok = res.status === 201 || res.status === 202;
      const body = (await res.json()) as { id: string; status: string };
      if (ok) createdTaskId = body.id;

      recordResult(
        "tasks:submit",
        ok,
        Date.now() - start,
        !ok ? `Expected 201/202, got ${res.status}` : undefined,
      );

      expect(ok).toBe(true);
      expect(body.id).toBeTruthy();
      expect(body.status).toBe("PENDING");
    } catch (err) {
      recordResult("tasks:submit", false, Date.now() - start, String(err));
      throw err;
    }
  });

  it("task transitions from PENDING to SCHEDULED within 10 seconds", async () => {
    if (!createdTaskId) {
      console.warn("Skipping — task was not created in previous test");
      return;
    }

    const start = Date.now();
    const deadline = Date.now() + 10_000;
    let finalStatus = "PENDING";

    while (Date.now() < deadline) {
      try {
        const res = await fetchWithTimeout(
          apiUrl(`/v1/tasks/${createdTaskId}`),
          { headers: authHeaders() },
          3_000,
        );

        if (res.ok) {
          const body = (await res.json()) as { status: string };
          finalStatus = body.status;
          if (finalStatus !== "PENDING") break;
        }
      } catch {
        // Retry
      }

      await new Promise((r) => setTimeout(r, 1_000));
    }

    const scheduled = finalStatus === "SCHEDULED" || finalStatus === "RUNNING";
    recordResult(
      "tasks:scheduling",
      scheduled,
      Date.now() - start,
      !scheduled ? `Task stuck in ${finalStatus} after 10s` : undefined,
    );

    expect(scheduled).toBe(true);
  });
});

// ── Critical Path: WebSocket Gateway ─────────────────────────────────────────

describe("WebSocket Gateway", () => {
  it("accepts a WebSocket upgrade request", async () => {
    const start = Date.now();
    try {
      // Test the upgrade endpoint — if it returns 101 or 400 (bad handshake
      // without proper WS headers from fetch), the gateway is alive
      const wsUrl = BASE_URL.replace("https://", "wss://").replace(
        "http://",
        "ws://",
      );
      const res = await fetchWithTimeout(
        `${wsUrl}/ws`,
        {
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            Authorization: `Bearer ${API_KEY}`,
          },
        },
        5_000,
      );

      // 101 = successful upgrade, 400/401 = gateway is alive but rejected (expected from fetch)
      const alive = [101, 400, 401, 426].includes(res.status);
      recordResult(
        "ws:gateway-alive",
        alive,
        Date.now() - start,
        !alive ? `Unexpected status ${res.status}` : undefined,
      );

      expect(alive).toBe(true);
    } catch (err) {
      // ECONNREFUSED = gateway is down; other errors (e.g. protocol mismatch) = alive
      const error = err instanceof Error ? err.message : String(err);
      const isDown =
        error.includes("ECONNREFUSED") || error.includes("ENOTFOUND");
      recordResult(
        "ws:gateway-alive",
        !isDown,
        Date.now() - start,
        isDown ? error : undefined,
      );

      if (isDown) throw err;
      // Protocol errors from fetch trying to do WS are expected — test passes
    }
  });
});

// ── Response Time Assertions ──────────────────────────────────────────────────

describe("Response times", () => {
  const SLA_MS = 2_000;

  it(`GET /v1/tasks responds within ${SLA_MS}ms`, async () => {
    const start = Date.now();
    const res = await fetchWithTimeout(apiUrl("/v1/tasks?limit=10"), {
      headers: authHeaders(),
    });
    const duration = Date.now() - start;
    recordResult(
      "perf:task-list-latency",
      duration < SLA_MS,
      duration,
      duration >= SLA_MS ? `${duration}ms exceeds ${SLA_MS}ms SLA` : undefined,
    );

    expect(res.ok).toBe(true);
    expect(duration).toBeLessThan(SLA_MS);
  });

  it(`GET /v1/nodes responds within ${SLA_MS}ms`, async () => {
    const start = Date.now();
    const res = await fetchWithTimeout(apiUrl("/v1/nodes?limit=10"), {
      headers: authHeaders(),
    });
    const duration = Date.now() - start;
    recordResult(
      "perf:node-list-latency",
      duration < SLA_MS,
      duration,
      duration >= SLA_MS ? `${duration}ms exceeds ${SLA_MS}ms SLA` : undefined,
    );

    expect(res.ok).toBe(true);
    expect(duration).toBeLessThan(SLA_MS);
  });
});
