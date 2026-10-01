import { env } from "./config/env";
import {
  initTelemetry,
  createLogger,
  createExpressLoggingMiddleware,
  withExtractedContext,
  tracer,
  SpanKind,
  SpanStatusCode,
} from "@edgecloud/shared-kernel";
import type { Span } from "@opentelemetry/api";
initTelemetry("edge-agent");

const logger = createLogger("edge-agent");

import express from "express";
import cors from "cors";
import https from "https";
import http from "http";
import "express-async-errors";
import si from "systeminformation";
import { CertManager, verifySignature, validateTaskPayload } from "./security";
import { DockerSandbox } from "./sandbox";
import type { AgentConfig, NodeStats, TaskPayload } from "./types";

const app = express();

let config: AgentConfig;
let sandbox: DockerSandbox;
let certManager: CertManager;

const nodeStats: NodeStats = {
  cpuUsage: 0,
  memoryUsage: 0,
  totalMemory: 0,
  tasksRunning: 0,
  tasksCompleted: 0,
  tasksFailed: 0,
  uptime: 0,
  startTime: Date.now(),
};

async function initConfig() {
  config = {
    PORT: env.PORT,
    NODE_ID: env.NODE_ID,
    NODE_NAME: env.NODE_NAME,
    NODE_LOCATION: env.NODE_LOCATION,
    ORCHESTRATOR_URL: env.ORCHESTRATOR_URL,
    API_KEY: env.API_KEY,
    REQUIRE_API_KEY: env.REQUIRE_API_KEY,
    ENABLE_MTLS: env.ENABLE_MTLS,
    TLS_CERT_PATH: env.TLS_CERT_PATH,
    TLS_KEY_PATH: env.TLS_KEY_PATH,
    TLS_CA_PATH: env.TLS_CA_PATH,
    RATE_LIMIT_WINDOW_MS: env.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX: env.RATE_LIMIT_MAX,
    REQUEST_SIGNATURE_SECRET: env.REQUEST_SIGNATURE_SECRET,
    CORS_ORIGINS: env.CORS_ORIGINS.split(","),
    IMAGE_ALLOWLIST_REGEX: env.IMAGE_ALLOWLIST_REGEX,
    DOCKER_HOST: env.DOCKER_HOST,
  };

  sandbox = new DockerSandbox(config);
  certManager = new CertManager(config);
}

// Standardized Logging & Correlation
app.use(createExpressLoggingMiddleware(logger));

// Security Middleware
app.use(express.json({ limit: "1MB" })); // Payload size limit
app.use((req, res, next) => {
  const signature = req.headers["x-signature"] as string;
  if (req.method === "POST" && req.path === "/run-task") {
    if (
      !verifySignature(req.body, signature, config.REQUEST_SIGNATURE_SECRET)
    ) {
      logger.warn(`Invalid signature on /run-task from ${req.ip}`);
      res.status(401).json({ error: "Invalid HMAC signature" });
      return;
    }
  }
  next();
});

// Routes
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    nodeId: config.NODE_ID,
    timestamp: new Date().toISOString(),
  });
});

app.get("/metrics", async (_req, res) => {
  const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
  nodeStats.cpuUsage = Math.round(cpu.currentLoad);
  nodeStats.memoryUsage = Math.round((mem.used / mem.total) * 100);
  nodeStats.totalMemory = Math.round(mem.total / 1024 / 1024 / 1024);
  nodeStats.uptime = Math.floor((Date.now() - nodeStats.startTime) / 1000);
  res.json({ ...nodeStats, nodeId: config.NODE_ID });
});

app.post("/run-task", async (req, res) => {
  await withExtractedContext(req.headers, async () => {
    const payload = req.body as TaskPayload;

    const validation = validateTaskPayload(payload, config);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    nodeStats.tasksRunning++;
    logger.info(`Starting task ${payload.taskId} - Image: ${payload.image}`);

    const result = await tracer.startActiveSpan(
      "agent:run_task",
      {
        kind: SpanKind.SERVER,
        attributes: {
          "task.id": payload.taskId,
          "task.image": payload.image,
          "node.id": config.NODE_ID,
        },
      },
      async (span: Span) => {
        try {
          const res = await sandbox.runTask(payload);
          span.setStatus({ code: SpanStatusCode.OK });
          return res;
        } catch (err: any) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );

    nodeStats.tasksRunning--;
    if (result.status === "completed") {nodeStats.tasksCompleted++;}
    else {nodeStats.tasksFailed++;}

    res.json(result);
  });
});

let server: http.Server | https.Server;

app.post("/admin/rotate-cert", async (req, res) => {
  const { cert, key, ca } = req.body;
  if (!cert || !key) {
    res.status(400).json({ error: "Missing cert or key" });
    return;
  }

  try {
    certManager.updateCerts(cert, key, ca);

    if (config.ENABLE_MTLS && server instanceof https.Server) {
      const options = certManager.getSecureContextOptions();
      if (options) {
        server.setSecureContext(options);
        logger.info("HTTPS Secure Context hot-swapped successfully");
      }
    }

    res.json({
      status: "success",
      message: "Certificates updated and hot-swapped.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export async function startAgent() {
  await initConfig();

  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));

  if (config.ENABLE_MTLS) {
    const options = certManager.getSecureContextOptions();
    if (!options) {throw new Error("mTLS enabled but no options generated");}

    server = https.createServer(options, app);
    logger.info(
      `Agent ${config.NODE_ID} starting HTTPS (mTLS) server on port ${config.PORT}`,
    );
  } else {
    server = http.createServer(app);
    logger.info(
      `Agent ${config.NODE_ID} starting HTTP server on port ${config.PORT}`,
    );
  }

  await new Promise<void>((resolve) => {
    server.listen(config.PORT, "0.0.0.0", () => {
      logger.info(`Agent ${config.NODE_ID} is ready`);
      resolve();
    });
  });

  return { server, sandbox, config };
}

if (env.NODE_ENV !== "test" && !env.VITEST) {
  startAgent().catch((err) => {
    logger.fatal("Failed to start agent:", err);
    process.exit(1);
  });
}
