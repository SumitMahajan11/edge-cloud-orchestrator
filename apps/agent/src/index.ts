import { 
  initTelemetry,
  createLogger,
  createExpressLoggingMiddleware
} from '@edgecloud/shared-kernel';
initTelemetry('edge-agent');

const logger = createLogger('edge-agent');

import express from 'express';
import cors from 'cors';
import https from 'https';
import http from 'http';
import fs from 'fs';
import 'express-async-errors';
import si from 'systeminformation';
import { 
  CertManager, 
  verifySignature, 
  validateTaskPayload 
} from './security';
import { DockerSandbox } from './sandbox';
import { AgentConfig, NodeStats, TaskPayload } from './types';

const app = express();

let secretManager: any;
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
  const { SecretManagerFactory, validateRequiredSecrets } = await import('@edgecloud/shared-kernel');
  secretManager = SecretManagerFactory.create();
  
  const required = ['NODE_ID', 'ORCHESTRATOR_URL', 'REQUEST_SIGNATURE_SECRET'];
  await validateRequiredSecrets(secretManager, required, 'edge-agent');
  
  config = {
    PORT: parseInt(await secretManager.getSecret('PORT') || '4001', 10),
    NODE_ID: (await secretManager.getSecret('NODE_ID'))!,
    NODE_NAME: await secretManager.getSecret('NODE_NAME') || 'Edge Node',
    NODE_LOCATION: await secretManager.getSecret('NODE_LOCATION') || 'Local',
    ORCHESTRATOR_URL: (await secretManager.getSecret('ORCHESTRATOR_URL'))!,
    API_KEY: await secretManager.getSecret('API_KEY'),
    REQUIRE_API_KEY: (await secretManager.getSecret('REQUIRE_API_KEY')) === 'true',
    ENABLE_MTLS: (await secretManager.getSecret('ENABLE_MTLS')) === 'true',
    TLS_CERT_PATH: await secretManager.getSecret('TLS_CERT_PATH') || './certs/server.crt',
    TLS_KEY_PATH: await secretManager.getSecret('TLS_KEY_PATH') || './certs/server.key',
    TLS_CA_PATH: await secretManager.getSecret('TLS_CA_PATH') || './certs/ca.crt',
    RATE_LIMIT_WINDOW_MS: parseInt(await secretManager.getSecret('RATE_LIMIT_WINDOW_MS') || '60000', 10),
    RATE_LIMIT_MAX: parseInt(await secretManager.getSecret('RATE_LIMIT_MAX') || '100', 10),
    REQUEST_SIGNATURE_SECRET: (await secretManager.getSecret('REQUEST_SIGNATURE_SECRET'))!,
    CORS_ORIGINS: (await secretManager.getSecret('CORS_ORIGINS') || 'http://localhost:5173,http://localhost:3000').split(','),
    IMAGE_ALLOWLIST_REGEX: await secretManager.getSecret('IMAGE_ALLOWLIST_REGEX') || '^[^:]+(?::(?!latest)[a-zA-Z0-9._-]+)?$',
    DOCKER_HOST: await secretManager.getSecret('DOCKER_HOST'),
  };

  sandbox = new DockerSandbox(config);
  certManager = new CertManager(config);
}

// Standardized Logging & Correlation
app.use(createExpressLoggingMiddleware(logger));

// Security Middleware
app.use(express.json({ limit: '1MB' })); // Payload size limit
app.use((req, res, next) => {
  const signature = req.headers['x-signature'] as string;
  if (req.method === 'POST' && req.path === '/run-task') {
    if (!verifySignature(req.body, signature, config.REQUEST_SIGNATURE_SECRET)) {
      logger.warn(`Invalid signature on /run-task from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }
  }
  next();
});

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', nodeId: config.NODE_ID, timestamp: new Date().toISOString() });
});

app.get('/metrics', async (req, res) => {
  const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
  nodeStats.cpuUsage = Math.round(cpu.currentLoad);
  nodeStats.memoryUsage = Math.round((mem.used / mem.total) * 100);
  nodeStats.totalMemory = Math.round(mem.total / 1024 / 1024 / 1024);
  nodeStats.uptime = Math.floor((Date.now() - nodeStats.startTime) / 1000);
  res.json({ ...nodeStats, nodeId: config.NODE_ID });
});

app.post('/run-task', async (req, res) => {
  const payload = req.body as TaskPayload;
  
  const validation = validateTaskPayload(payload, config);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  nodeStats.tasksRunning++;
  logger.info(`Starting task ${payload.taskId} - Image: ${payload.image}`);
  
  const result = await sandbox.runTask(payload);
  
  nodeStats.tasksRunning--;
  if (result.status === 'completed') nodeStats.tasksCompleted++; else nodeStats.tasksFailed++;
  
  res.json(result);
});

let server: http.Server | https.Server;

app.post('/admin/rotate-cert', async (req, res) => {
  const { cert, key, ca } = req.body;
  if (!cert || !key) return res.status(400).json({ error: 'Missing cert or key' });

  try {
    certManager.updateCerts(cert, key, ca);
    
    if (config.ENABLE_MTLS && server instanceof https.Server) {
      const options = certManager.getSecureContextOptions();
      if (options) {
        server.setSecureContext(options);
        logger.info('HTTPS Secure Context hot-swapped successfully');
      }
    }
    
    res.json({ status: 'success', message: 'Certificates updated and hot-swapped.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  await initConfig();

  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));

  if (config.ENABLE_MTLS) {
    const options = certManager.getSecureContextOptions();
    if (!options) throw new Error('mTLS enabled but no options generated');
    
    server = https.createServer(options, app);
    logger.info(`Agent ${config.NODE_ID} starting HTTPS (mTLS) server on port ${config.PORT}`);
  } else {
    server = http.createServer(app);
    logger.info(`Agent ${config.NODE_ID} starting HTTP server on port ${config.PORT}`);
  }

  server.listen(config.PORT, '0.0.0.0', () => {
    logger.info(`Agent ${config.NODE_ID} is ready using ${secretManager.constructor.name}`);
  });
}

start().catch(err => {
  logger.fatal('Failed to start agent:', err);
  process.exit(1);
});
