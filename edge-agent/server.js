const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const si = require('systeminformation');
const axios = require('axios');
const cron = require('node-cron');
const crypto = require('crypto');

const execPromise = util.promisify(exec);

// Configuration
const PORT = process.env.PORT || 4001;
const NODE_ID = process.env.NODE_ID || `edge-${Math.random().toString(36).substr(2, 9)}`;
const NODE_NAME = process.env.NODE_NAME || `Edge Node ${PORT}`;
const NODE_LOCATION = process.env.NODE_LOCATION || 'Local';
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const MAX_EXECUTION_TIME = 300000; // 5 minutes

// Security Configuration
const API_KEY = process.env.API_KEY;
const API_KEY_HEADER = 'x-api-key';
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === 'true' || !API_KEY;
const ENABLE_MTLS = process.env.ENABLE_MTLS === 'true';
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || './certs/server.crt';
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || './certs/server.key';
const TLS_CA_PATH = process.env.TLS_CA_PATH || './certs/ca.crt';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

// Rate limiting store
const rateLimitStore = new Map();

// Request signing for orchestrator communication
const REQUEST_SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || NODE_ID;

function generateSignature(payload, timestamp) {
  const message = `${JSON.stringify(payload)}${timestamp}`;
  return crypto
    .createHmac('sha256', REQUEST_SIGNATURE_SECRET)
    .update(message)
    .digest('hex');
}

function verifySignature(payload, timestamp, signature) {
  const expectedSignature = generateSignature(payload, timestamp);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

// API Key validation
function validateApiKey(req, res, next) {
  // Skip auth for health and metrics endpoints (read-only)
  const publicPaths = ['/health', '/ping'];
  if (publicPaths.includes(req.path)) {
    return next();
  }

  if (!REQUIRE_API_KEY) {
    return next();
  }

  const providedKey = req.headers[API_KEY_HEADER] || req.query.apiKey;

  if (!providedKey) {
    console.warn(`[Auth] Missing API key from ${req.ip} for ${req.path}`);
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'API key required',
      code: 'MISSING_API_KEY'
    });
  }

  if (providedKey !== API_KEY) {
    console.warn(`[Auth] Invalid API key from ${req.ip} for ${req.path}`);
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Invalid API key',
      code: 'INVALID_API_KEY'
    });
  }

  next();
}

// Rate limiting middleware
function rateLimiter(req, res, next) {
  const clientId = req.headers[API_KEY_HEADER] || req.ip;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Get or create client record
  let clientRecord = rateLimitStore.get(clientId);
  
  if (!clientRecord) {
    clientRecord = { requests: [] };
    rateLimitStore.set(clientId, clientRecord);
  }

  // Filter out old requests
  clientRecord.requests = clientRecord.requests.filter(time => time > windowStart);

  // Check limit
  if (clientRecord.requests.length >= RATE_LIMIT_MAX) {
    const resetTime = Math.ceil((clientRecord.requests[0] - windowStart) / 1000);
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', resetTime);
    
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${resetTime} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: resetTime
    });
  }

  // Record request
  clientRecord.requests.push(now);
  
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT_MAX - clientRecord.requests.length);

  next();
}

// Cleanup rate limit store periodically
setInterval(() => {
  const now = Date.now();
  for (const [clientId, record] of rateLimitStore.entries()) {
    if (record.requests.length === 0 || record.requests[record.requests.length - 1] < now - RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(clientId);
    }
  }
}, 60000);

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-signature', 'x-timestamp'],
}));

app.use(express.json({ limit: '10mb' }));

// Apply security middleware
app.use(rateLimiter);
app.use(validateApiKey);

// State
let nodeStats = {
  cpuUsage: 0,
  memoryUsage: 0,
  totalMemory: 0,
  tasksRunning: 0,
  tasksCompleted: 0,
  tasksFailed: 0,
  uptime: 0,
  startTime: Date.now(),
};

let runningTasks = new Map();

// Middleware to track requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    nodeId: NODE_ID,
    nodeName: NODE_NAME,
    timestamp: new Date().toISOString(),
  });
});

// Get node metrics
app.get('/metrics', async (req, res) => {
  try {
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]);

    nodeStats.cpuUsage = Math.round(cpu.currentLoad);
    nodeStats.memoryUsage = Math.round((mem.used / mem.total) * 100);
    nodeStats.totalMemory = Math.round(mem.total / 1024 / 1024 / 1024); // GB
    nodeStats.uptime = Math.floor((Date.now() - nodeStats.startTime) / 1000);

    res.json({
      nodeId: NODE_ID,
      nodeName: NODE_NAME,
      cpuUsage: nodeStats.cpuUsage,
      memoryUsage: nodeStats.memoryUsage,
      totalMemory: nodeStats.totalMemory,
      tasksRunning: nodeStats.tasksRunning,
      tasksCompleted: nodeStats.tasksCompleted,
      tasksFailed: nodeStats.tasksFailed,
      uptime: nodeStats.uptime,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting metrics:', error);
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Execute task endpoint
app.post('/run-task', async (req, res) => {
  const { taskId, taskName, image, command, env, resources } = req.body;

  if (!taskId || !image) {
    return res.status(400).json({ error: 'Missing required fields: taskId, image' });
  }

  // Validate taskId format (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
    return res.status(400).json({ error: 'Invalid taskId format' });
  }

  // Validate image format (docker image reference)
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[a-zA-Z0-9._-]+)?$/.test(image)) {
    return res.status(400).json({ error: 'Invalid image format' });
  }

  console.log(`[Task ${taskId}] Starting execution: ${taskName || image}`);

  const startTime = Date.now();
  nodeStats.tasksRunning++;

  try {
    // Build docker args array to prevent command injection
    const dockerArgs = ['run', '--rm'];
    
    // Add resource limits
    if (resources?.memory && /^\d+[mgMG]$/.test(resources.memory)) {
      dockerArgs.push('--memory', resources.memory);
    } else {
      dockerArgs.push('--memory', '256m');
    }
    
    if (resources?.cpu && /^\d+(\.\d+)?$/.test(String(resources.cpu))) {
      dockerArgs.push('--cpus', String(resources.cpu));
    } else {
      dockerArgs.push('--cpus', '0.5');
    }

    // Add timeout
    dockerArgs.push('--stop-timeout', String(Math.min(MAX_EXECUTION_TIME / 1000, 300)));

    // Add environment variables
    if (env && typeof env === 'object') {
      Object.entries(env).forEach(([key, value]) => {
        // Validate env var name (alphanumeric and underscore only)
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          dockerArgs.push('-e', `${key}=${String(value)}`);
        }
      });
    }

    // Add labels for tracking
    dockerArgs.push('--label', `task.id=${taskId}`);
    dockerArgs.push('--label', `task.name=${taskName || ''}`);
    dockerArgs.push('--label', `node.id=${NODE_ID}`);

    // Add image
    dockerArgs.push(image);
    
    // Add command as array elements (not string concatenation)
    if (command) {
      if (Array.isArray(command)) {
        dockerArgs.push(...command);
      } else {
        dockerArgs.push(command);
      }
    }

    console.log(`[Task ${taskId}] Executing: docker ${dockerArgs.join(' ')}`);

    // Store task info
    runningTasks.set(taskId, {
      startTime,
      command: dockerCmd,
      timeout: setTimeout(() => {
        console.log(`[Task ${taskId}] Timeout reached, killing container`);
        exec(`docker stop $(docker ps -q --filter "label=task.id=${taskId}")`).catch(() => {});
      }, MAX_EXECUTION_TIME),
    });

    // Execute container using spawn for safety (array-based args)
    const { spawn } = require('child_process');
    const child = spawn('docker', dockerArgs, {
      timeout: MAX_EXECUTION_TIME,
      maxBuffer: 10 * 1024 * 1024,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data;
    });

    child.stderr.on('data', (data) => {
      stderr += data;
    });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
      child.on('error', reject);
    });

    // Clear timeout
    const taskInfo = runningTasks.get(taskId);
    if (taskInfo?.timeout) {
      clearTimeout(taskInfo.timeout);
    }
    runningTasks.delete(taskId);

    const executionTime = Date.now() - startTime;
    nodeStats.tasksRunning--;
    nodeStats.tasksCompleted++;

    console.log(`[Task ${taskId}] Completed in ${executionTime}ms`);

    res.json({
      taskId,
      status: 'completed',
      exitCode: 0,
      stdout: stdout.substring(0, 10000), // Limit output size
      stderr: stderr.substring(0, 5000),
      executionTime,
      nodeId: NODE_ID,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    // Clear timeout
    const taskInfo = runningTasks.get(taskId);
    if (taskInfo?.timeout) {
      clearTimeout(taskInfo.timeout);
    }
    runningTasks.delete(taskId);

    const executionTime = Date.now() - startTime;
    nodeStats.tasksRunning--;
    nodeStats.tasksFailed++;

    console.error(`[Task ${taskId}] Failed:`, error.message);

    res.json({
      taskId,
      status: 'failed',
      exitCode: error.code || 1,
      error: error.message,
      stderr: error.stderr?.substring(0, 5000),
      executionTime,
      nodeId: NODE_ID,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get running tasks
app.get('/tasks', (req, res) => {
  const tasks = Array.from(runningTasks.entries()).map(([id, info]) => ({
    taskId: id,
    startTime: info.startTime,
    runningFor: Date.now() - info.startTime,
  }));

  res.json({
    nodeId: NODE_ID,
    tasks,
    count: tasks.length,
  });
});

// Kill running task
app.post('/kill-task/:taskId', async (req, res) => {
  const { taskId } = req.params;
  
  try {
    await exec(`docker stop $(docker ps -q --filter "label=task.id=${taskId}")`);
    
    const taskInfo = runningTasks.get(taskId);
    if (taskInfo?.timeout) {
      clearTimeout(taskInfo.timeout);
    }
    runningTasks.delete(taskId);
    nodeStats.tasksRunning--;

    res.json({ status: 'killed', taskId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to kill task', details: error.message });
  }
});

// Heartbeat endpoint (called by orchestrator to check node)
app.get('/heartbeat', async (req, res) => {
  try {
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]);

    res.json({
      nodeId: NODE_ID,
      nodeName: NODE_NAME,
      status: 'online',
      cpuUsage: Math.round(cpu.currentLoad),
      memoryUsage: Math.round((mem.used / mem.total) * 100),
      tasksRunning: nodeStats.tasksRunning,
      uptime: Math.floor((Date.now() - nodeStats.startTime) / 1000),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

// Measure latency endpoint
app.get('/ping', (req, res) => {
  res.json({ 
    pong: true, 
    timestamp: Date.now(),
    nodeId: NODE_ID,
  });
});

// Start server with optional mTLS
function startServer() {
  if (ENABLE_MTLS) {
    // Check if certificates exist
    if (!fs.existsSync(TLS_CERT_PATH) || !fs.existsSync(TLS_KEY_PATH)) {
      console.error('Error: mTLS enabled but certificates not found.');
      console.error(`Expected cert at: ${TLS_CERT_PATH}`);
      console.error(`Expected key at: ${TLS_KEY_PATH}`);
      process.exit(1);
    }

    const options = {
      key: fs.readFileSync(TLS_KEY_PATH),
      cert: fs.readFileSync(TLS_CERT_PATH),
      ca: fs.existsSync(TLS_CA_PATH) ? fs.readFileSync(TLS_CA_PATH) : undefined,
      requestCert: true,
      rejectUnauthorized: true,
    };

    const server = https.createServer(options, app);
    
    server.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════╗
║         Edge Cloud Agent - Node ${NODE_ID}            ║
╠════════════════════════════════════════════════════════╣
║  Name:     ${NODE_NAME.padEnd(40)} ║
║  Port:     ${PORT.toString().padEnd(40)} ║
║  Location: ${NODE_LOCATION.padEnd(40)} ║
║  Security: mTLS ENABLED                                ║
╚════════════════════════════════════════════════════════╝
      `);
      console.log(`Agent running on https://localhost:${PORT}`);
      console.log(`Health: https://localhost:${PORT}/health`);
      console.log(`Metrics: https://localhost:${PORT}/metrics`);
      console.log('');
    });
  } else {
    // HTTP server (for development or when behind TLS terminator)
    const server = http.createServer(app);
    
    server.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════╗
║         Edge Cloud Agent - Node ${NODE_ID}            ║
╠════════════════════════════════════════════════════════╣
║  Name:     ${NODE_NAME.padEnd(40)} ║
║  Port:     ${PORT.toString().padEnd(40)} ║
║  Location: ${NODE_LOCATION.padEnd(40)} ║
║  Security: API Key ${API_KEY ? 'ENABLED' : 'DISABLED (Development Mode)'.padEnd(14)} ║
╚════════════════════════════════════════════════════════╝
      `);
      console.log(`Agent running on http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
      console.log(`Metrics: http://localhost:${PORT}/metrics`);
      console.log('');
      
      if (!API_KEY) {
        console.warn('⚠️  WARNING: No API_KEY set. Running in development mode without authentication.');
        console.warn('⚠️  Set API_KEY environment variable for production.');
      }
    });
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  // Kill all running containers
  runningTasks.forEach((info, taskId) => {
    exec(`docker stop $(docker ps -q --filter "label=task.id=${taskId}")`).catch(() => {});
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  runningTasks.forEach((info, taskId) => {
    exec(`docker stop $(docker ps -q --filter "label=task.id=${taskId}")`).catch(() => {});
  });
  process.exit(0);
});
