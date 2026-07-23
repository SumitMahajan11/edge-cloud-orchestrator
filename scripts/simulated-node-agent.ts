import axios from 'axios';

/**
 * Simulated Device Node Script
 *
 * 1. Authenticates against the deployed API via POST /v2/auth/login (or fallback register).
 * 2. Registers a new simulated edge node via POST /v2/nodes/.
 * 3. Continuously streams resource usage heartbeats to POST /v2/nodes/:id/heartbeat.
 */

const API_BASE_URL = process.env.API_BASE_URL || 'https://edge-cloud-orchestrator-production.up.railway.app';
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '3000', 10);

const DEMO_CREDENTIALS = [
  { email: 'admin@demo-org.com', password: 'Admin123!' },
  { email: 'admin@edge-cloud.io', password: 'AdminPassword123!' },
];

async function getAuthToken(): Promise<string> {
  console.log(`🔐 Authenticating with API server at ${API_BASE_URL}...`);

  for (const cred of DEMO_CREDENTIALS) {
    try {
      const res = await axios.post(`${API_BASE_URL}/v2/auth/login`, cred);
      if (res.data?.token) {
        console.log(`✅ Authentication successful as ${cred.email}`);
        return res.data.token;
      }
    } catch {
      // Try next credential
    }
  }

  // Fallback: Register a fresh agent user
  const randomSuffix = Math.floor(Math.random() * 10000);
  const agentUser = {
    email: `agent${randomSuffix}@edge-cloud.io`,
    password: `AgentPassword123!`,
    name: `Simulated Agent`,
  };

  try {
    console.log(`🔑 Creating temporary agent user: ${agentUser.email}...`);
    const regRes = await axios.post(`${API_BASE_URL}/v2/auth/register`, agentUser);
    if (regRes.data?.token) {
      console.log(`✅ Registered & Authenticated as ${agentUser.email}`);
      return regRes.data.token;
    }
  } catch (err: any) {
    console.error('❌ Failed to authenticate or register user:');
    console.error('Error Details:', err.response?.data?.error || err.response?.data || err.message);
    process.exit(1);
  }

  throw new Error('Could not obtain auth token from API');
}

async function runSimulatedNodeAgent() {
  console.log('====================================================');
  console.log('🚀 Starting Real Deployed Simulated Edge Device Agent');
  console.log(`📡 API Base Target: ${API_BASE_URL}`);
  console.log('====================================================\n');

  const token = await getAuthToken();

  const authHeaders = {
    authorization: `Bearer ${token}`,
    'x-api-version': 'v2',
    'content-type': 'application/json',
  };

  const randomNodeId = Math.floor(Math.random() * 10000);
  const nodePayload = {
    name: `railway-sim-node-${randomNodeId}`,
    location: 'Frankfurt, DE',
    region: 'eu-central-1',
    ipAddress: '198.51.100.45', // RFC 5737 valid public IPv4 format
    port: 4001,
    cpuCores: 16,
    memoryGB: 32,
    storageGB: 1000,
    costPerHour: 0.15,
    maxTasks: 25,
  };

  let nodeId: string;

  try {
    console.log(`\n1️⃣ Registering node "${nodePayload.name}" via POST ${API_BASE_URL}/v2/nodes/ ...`);
    console.log('   Request Body:', JSON.stringify(nodePayload, null, 2));

    const regRes = await axios.post(`${API_BASE_URL}/v2/nodes/`, nodePayload, {
      headers: authHeaders,
    });

    console.log('\n📥 RAW UNEDITED JSON RESPONSE BODY:');
    console.log(JSON.stringify(regRes.data, null, 2));

    nodeId = regRes.data.id;
    console.log(`\n✅ Registration Verified on Railway Production! Node ID: ${nodeId}`);
  } catch (error: any) {
    console.error(`\n❌ Node registration failed on production server:`, error.response?.data || error.message);
    process.exit(1);
  }

  // 2. Continuous Heartbeat Stream
  console.log(`\n2️⃣ Streaming Live Heartbeats to ${API_BASE_URL}/v2/nodes/${nodeId}/heartbeat ...`);

  let heartbeatCount = 0;
  const heartbeatTimer = setInterval(async () => {
    heartbeatCount++;
    const cpuUsage = Math.round((15 + Math.random() * 50) * 10) / 10;
    const memoryUsage = Math.round((25 + Math.random() * 40) * 10) / 10;
    const activeTasks = Math.floor(Math.random() * 4);

    try {
      const hbRes = await axios.post(
        `${API_BASE_URL}/v2/nodes/${nodeId}/heartbeat`,
        {
          cpuUsage,
          memoryUsage,
          storageUsage: 12.5,
          latency: Math.floor(8 + Math.random() * 15),
          tasksRunning: activeTasks,
          networkIn: 1048576,
          networkOut: 2097152,
        },
        { headers: authHeaders }
      );

      console.log(
        `💓 [Heartbeat #${heartbeatCount}] Node ID: ${nodeId} | Railway Status: 200 OK (${JSON.stringify(hbRes.data)}) | CPU: ${cpuUsage}% | MEM: ${memoryUsage}% | Tasks: ${activeTasks}`
      );

      if (heartbeatCount >= 5) {
        console.log('\n✨ Successfully transmitted 5 live heartbeats to Railway backend! Stationing agent in active state.');
      }
    } catch (error: any) {
      console.error(`⚠️ Heartbeat #${heartbeatCount} failed:`, error.response?.data || error.message);
    }
  }, HEARTBEAT_INTERVAL_MS);

  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping simulated agent node loop...');
    clearInterval(heartbeatTimer);
    process.exit(0);
  });
}

runSimulatedNodeAgent().catch((err) => {
  console.error('Fatal error running simulated node agent:', err);
  process.exit(1);
});
