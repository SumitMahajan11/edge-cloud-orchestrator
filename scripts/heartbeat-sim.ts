/**
 * ============================================================================
 * SIMULATED EDGE NODE HEARTBEAT GENERATOR
 * Description: Registers 3 simulated edge nodes (sim-edge-01..03) and streams
 *              periodic telemetry heartbeats every 10s to keep them ONLINE.
 * Target: Production / Staging Edge-Cloud Orchestrator API
 * ============================================================================
 */
import * as fs from 'fs';
import * as path from 'path';

interface SimulatedNodeConfig {
  name: string;
  location: string;
  region: string;
  ipAddress: string;
  port: number;
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
}

const SIMULATED_NODES: SimulatedNodeConfig[] = [
  {
    name: 'sim-edge-01 (Simulated)',
    location: 'Frankfurt, Germany (Simulated)',
    region: 'eu-central-1',
    ipAddress: '52.28.1.1',
    port: 8080,
    cpuCores: 8,
    memoryGB: 16,
    storageGB: 256,
  },
  {
    name: 'sim-edge-02 (Simulated)',
    location: 'London, UK (Simulated)',
    region: 'eu-west-2',
    ipAddress: '52.28.1.2',
    port: 8080,
    cpuCores: 16,
    memoryGB: 32,
    storageGB: 512,
  },
  {
    name: 'sim-edge-03 (Simulated)',
    location: 'Singapore (Simulated)',
    region: 'ap-southeast-1',
    ipAddress: '52.28.1.3',
    port: 8080,
    cpuCores: 4,
    memoryGB: 8,
    storageGB: 128,
  },
];

async function getCredentials(): Promise<{ email: string; pass: string; baseUrl: string }> {
  const baseUrl = process.env.API_BASE_URL || 'https://edge-cloud-orchestrator.onrender.com';
  let email = process.env.SMOKE_EMAIL || process.env.ADMIN_EMAIL;
  let pass = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD;

  if (!email || !pass) {
    const secretsPath = path.resolve(process.cwd(), 'secrets.local.txt');
    if (fs.existsSync(secretsPath)) {
      const content = fs.readFileSync(secretsPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.startsWith('admin@demo-org.com=')) {
          email = 'admin@demo-org.com';
          pass = line.split('=')[1].trim();
          break;
        }
      }
    }
  }

  if (!email || !pass) {
    throw new Error('Missing authentication credentials in environment (SMOKE_EMAIL/SMOKE_PASSWORD or secrets.local.txt).');
  }

  return { email, pass, baseUrl };
}

async function login(baseUrl: string, email: string, pass: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed with HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  const token = data.accessToken || data.token;
  if (!token) {
    throw new Error('Login response missing access token');
  }
  return token;
}

async function registerOrGetNode(baseUrl: string, token: string, config: SimulatedNodeConfig): Promise<string> {
  // Try registering
  const regRes = await fetch(`${baseUrl}/v2/nodes/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(config),
  });

  if (regRes.status === 201) {
    const body = await regRes.json();
    console.log(`[Registered] Node created: ${config.name} (ID: ${body.id})`);
    return body.id;
  }

  if (regRes.status === 409) {
    // Already registered, lookup ID
    const listRes = await fetch(`${baseUrl}/v2/nodes/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    const nodes = listData.data || listData;
    const match = nodes.find((n: any) => n.name === config.name);
    if (match) {
      console.log(`[Found Existing] Node: ${config.name} (ID: ${match.id})`);
      return match.id;
    }
  }

  const errText = await regRes.text();
  throw new Error(`Failed to register node ${config.name}: HTTP ${regRes.status} - ${errText}`);
}

async function sendHeartbeat(baseUrl: string, token: string, nodeId: string, nodeName: string) {
  const cpuUsage = Math.round((20 + Math.random() * 45) * 10) / 10;
  const memoryUsage = Math.round((35 + Math.random() * 35) * 10) / 10;
  const latency = Math.round(15 + Math.random() * 40);
  const tasksRunning = Math.floor(Math.random() * 4);

  const payload = {
    cpuUsage,
    memoryUsage,
    storageUsage: 42.5,
    latency,
    tasksRunning,
    networkIn: Math.round(100 + Math.random() * 300),
    networkOut: Math.round(50 + Math.random() * 150),
  };

  const res = await fetch(`${baseUrl}/v2/nodes/${nodeId}/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`[Heartbeat Error] Node ${nodeName} (HTTP ${res.status})`);
  } else {
    console.log(`[Heartbeat Sent] ${nodeName} -> CPU: ${cpuUsage}%, Mem: ${memoryUsage}%, Latency: ${latency}ms, Tasks: ${tasksRunning}`);
  }
}

async function run() {
  const { email, pass, baseUrl } = await getCredentials();
  console.log(`\nStarting Heartbeat Simulator against ${baseUrl}...`);
  const token = await login(baseUrl, email, pass);
  console.log('Authentication successful.');

  const registeredNodes: { id: string; name: string }[] = [];
  for (const nodeCfg of SIMULATED_NODES) {
    const id = await registerOrGetNode(baseUrl, token, nodeCfg);
    registeredNodes.push({ id, name: nodeCfg.name });
  }

  const totalDurationSec = 90;
  const intervalSec = 10;
  const iterations = Math.floor(totalDurationSec / intervalSec);

  console.log(`\nStreaming heartbeats for ${totalDurationSec}s (${iterations} iterations every ${intervalSec}s)...\n`);

  for (let i = 1; i <= iterations; i++) {
    console.log(`--- Iteration ${i}/${iterations} (${new Date().toISOString()}) ---`);
    for (const node of registeredNodes) {
      await sendHeartbeat(baseUrl, token, node.id, node.name);
    }
    if (i < iterations) {
      await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
    }
  }

  console.log('\nSimulation run completed successfully.');
}

run().catch((err) => {
  console.error('Fatal simulator error:', err);
  process.exit(1);
});
