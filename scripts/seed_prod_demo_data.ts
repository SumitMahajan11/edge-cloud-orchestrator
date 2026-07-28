const API_BASE_URL = process.env.API_BASE_URL || 'https://edge-cloud-orchestrator-production.up.railway.app';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Error: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD environment variables are required.');
  process.exit(1);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 15,
  delayMs = 6000,
): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const res = await fetch(url, options);
      if (res.status === 503 || res.status === 500) {
        const text = await res.text();
        if (text.includes('database') || text.includes('starting up') || text.includes('DATABASE_ERROR')) {
          console.warn(`[Attempt ${attempt}/${maxRetries}] DB warming up (${res.status}), retrying in ${delayMs / 1000}s...`);
          await sleep(delayMs);
          continue;
        }
        // If not a DB warmup 500/503, construct a response copy to return
        return new Response(text, { status: res.status, headers: res.headers });
      }
      return res;
    } catch (err: any) {
      console.warn(`[Attempt ${attempt}/${maxRetries}] Network error: ${err.message}, retrying in ${delayMs / 1000}s...`);
      await sleep(delayMs);
    }
  }
  throw new Error(`Max retries reached for ${url}`);
}

async function run() {
  console.log('=== Step 1: Login to Production API ===');
  const loginRes = await fetchWithRetry(`${API_BASE_URL}/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  if (!loginRes.ok) {
    console.error('Login failed:', loginRes.status, await loginRes.text());
    process.exit(1);
  }

  const loginData = (await loginRes.json()) as any;
  const token = loginData.token || loginData.accessToken;
  console.log('Login successful! Auth Token obtained.');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 1. Seed Nodes
  console.log('\n=== Step 2: Seed Edge Nodes ===');
  const nodeDefs = [
    {
      name: 'demo-edge-us-east-01',
      location: 'Ashburn, VA, USA',
      region: 'us-east-1',
      ipAddress: '198.51.100.10',
      port: 8080,
      cpuCores: 16,
      memoryGB: 64,
      storageGB: 500,
      costPerHour: 0.45,
      targetStatus: 'ONLINE',
    },
    {
      name: 'demo-edge-us-west-02',
      location: 'Hillsboro, OR, USA',
      region: 'us-west-2',
      ipAddress: '198.51.100.11',
      port: 8080,
      cpuCores: 32,
      memoryGB: 128,
      storageGB: 1000,
      costPerHour: 0.85,
      targetStatus: 'ONLINE',
    },
    {
      name: 'demo-edge-eu-west-01',
      location: 'Dublin, Ireland',
      region: 'eu-west-1',
      ipAddress: '203.0.113.1',
      port: 8080,
      cpuCores: 8,
      memoryGB: 32,
      storageGB: 256,
      costPerHour: 0.30,
      targetStatus: 'ONLINE',
    },
    {
      name: 'demo-edge-ap-south-01',
      location: 'Singapore',
      region: 'ap-southeast-1',
      ipAddress: '203.0.113.2',
      port: 8080,
      cpuCores: 16,
      memoryGB: 64,
      storageGB: 500,
      costPerHour: 0.50,
      targetStatus: 'ONLINE',
    },
    {
      name: 'demo-edge-sa-east-01',
      location: 'São Paulo, Brazil',
      region: 'sa-east-1',
      ipAddress: '198.51.100.12',
      port: 8080,
      cpuCores: 8,
      memoryGB: 16,
      storageGB: 128,
      costPerHour: 0.25,
      targetStatus: 'DEGRADED',
    },
    {
      name: 'demo-edge-eu-central-01',
      location: 'Frankfurt, Germany',
      region: 'eu-central-1',
      ipAddress: '198.51.100.13',
      port: 8080,
      cpuCores: 16,
      memoryGB: 64,
      storageGB: 500,
      costPerHour: 0.48,
      targetStatus: 'MAINTENANCE',
    },
    {
      name: 'demo-edge-ap-northeast-01',
      location: 'Tokyo, Japan',
      region: 'ap-northeast-1',
      ipAddress: '203.0.113.3',
      port: 8080,
      cpuCores: 32,
      memoryGB: 128,
      storageGB: 1000,
      costPerHour: 0.90,
      targetStatus: 'OFFLINE',
    },
  ];

  const createdNodes: any[] = [];

  for (const def of nodeDefs) {
    const { targetStatus, ...createPayload } = def;
    console.log(`Creating node: ${def.name} (${def.region})...`);
    const res = await fetchWithRetry(`${API_BASE_URL}/v2/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify(createPayload),
    });

    if (!res.ok) {
      console.error(`Failed to create node ${def.name}:`, res.status, await res.text());
      continue;
    }

    const node = (await res.json()) as any;
    console.log(`Created node ${node.id} (${node.name})`);
    createdNodes.push({ ...node, targetStatus });

    // Send initial heartbeat with metrics
    console.log(`Sending heartbeat for ${node.name}...`);
    const hbRes = await fetchWithRetry(`${API_BASE_URL}/v2/nodes/${node.id}/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        cpuUsage: Math.floor(Math.random() * 40) + 15,
        memoryUsage: Math.floor(Math.random() * 50) + 30,
        storageUsage: Math.floor(Math.random() * 30) + 20,
        latency: Math.floor(Math.random() * 25) + 10,
        tasksRunning: Math.floor(Math.random() * 5),
        networkIn: Math.floor(Math.random() * 100) + 50,
        networkOut: Math.floor(Math.random() * 100) + 50,
      }),
    });
    if (!hbRes.ok) {
      console.error(`Heartbeat error for ${node.id}:`, hbRes.status, await hbRes.text());
    }

    // Apply target status
    if (targetStatus === 'MAINTENANCE') {
      console.log(`Setting maintenance mode for ${node.name}...`);
      await fetchWithRetry(`${API_BASE_URL}/v2/nodes/${node.id}/maintenance`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled: true }),
      });
    } else if (targetStatus === 'OFFLINE') {
      console.log(`Setting offline status for ${node.name}...`);
      await fetchWithRetry(`${API_BASE_URL}/v2/nodes/${node.id}/offline`, {
        method: 'POST',
        headers,
      });
    } else if (targetStatus === 'DEGRADED') {
      console.log(`Setting degraded status for ${node.name}...`);
      await fetchWithRetry(`${API_BASE_URL}/v2/nodes/${node.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'DEGRADED' }),
      });
    }
  }

  // 2. Seed Alerts
  console.log('\n=== Step 3: Seed Alerts ===');
  const alertDefs = [
    {
      severity: 'CRITICAL' as const,
      title: 'High CPU Temperature Threshold Exceeded',
      description: 'Node demo-edge-sa-east-01 reported CPU core temperature reaching 92°C under sustained inference workload.',
    },
    {
      severity: 'CRITICAL' as const,
      title: 'Edge Gateway Connection Timeout',
      description: 'Node demo-edge-ap-northeast-01 failed 5 consecutive heartbeat checks over 15 minutes.',
    },
    {
      severity: 'HIGH' as const,
      title: 'Memory Utilization Warning (>85%)',
      description: 'Node demo-edge-us-west-02 memory consumption has sustained above 88% for 30 minutes.',
    },
    {
      severity: 'HIGH' as const,
      title: 'Network Packet Loss Spike',
      description: 'Increased packet loss (4.2%) detected on link between us-east-1 and ap-southeast-1 regions.',
    },
    {
      severity: 'MEDIUM' as const,
      title: 'Storage Capacity Threshold (>75%)',
      description: 'Node demo-edge-eu-west-01 volume /data is approaching capacity (78% used).',
    },
    {
      severity: 'MEDIUM' as const,
      title: 'Scheduled Maintenance Active',
      description: 'Node demo-edge-eu-central-01 entered scheduled maintenance window for firmware updates.',
    },
    {
      severity: 'LOW' as const,
      title: 'Certificate Renewal Reminder',
      description: 'TLS certificate for node demo-edge-us-east-01 will expire in 14 days.',
    },
    {
      severity: 'LOW' as const,
      title: 'Automated Model Synchronization Complete',
      description: 'Inference model v2.4 successfully synced to 5 active edge nodes.',
    },
  ];

  for (const alert of alertDefs) {
    console.log(`Sending alert: ${alert.title}...`);
    const res = await fetchWithRetry(`${API_BASE_URL}/v2/alerts/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify(alert),
    });
    if (!res.ok) {
      console.error(`Alert creation failed:`, res.status, await res.text());
    }
  }

  // 3. Seed Workflows
  console.log('\n=== Step 4: Seed Workflows ===');
  const workflowDefs = [
    {
      name: 'demo-workflow-video-analytics-pipeline',
      version: '1.0.0',
      nodes: [
        {
          id: 'ingest',
          name: 'RTSP Stream Ingest',
          type: 'task',
          config: { sourceType: 'RTSP', maxFps: 30 },
          inputs: [],
          outputs: ['frames'],
        },
        {
          id: 'inference',
          name: 'YOLOv8 Object Detection',
          type: 'task',
          config: { model: 'yolov8n.pt', confidence: 0.75 },
          inputs: ['frames'],
          outputs: ['detections'],
        },
        {
          id: 'aggregate',
          name: 'Telemetry Aggregator',
          type: 'task',
          config: { batchWindowMs: 5000 },
          inputs: ['detections'],
          outputs: ['metrics'],
        },
      ],
      edges: [
        { id: 'e1', from: 'ingest', to: 'inference' },
        { id: 'e2', from: 'inference', to: 'aggregate' },
      ],
    },
    {
      name: 'demo-workflow-iot-anomaly-detection',
      version: '1.1.0',
      nodes: [
        {
          id: 'sensor-read',
          name: 'MQTT Telemetry Collector',
          type: 'task',
          config: { topic: 'sensors/v1/#' },
          inputs: [],
          outputs: ['readings'],
        },
        {
          id: 'filter-outliers',
          name: 'Isolation Forest Anomaly Filter',
          type: 'task',
          config: { contamination: 0.05 },
          inputs: ['readings'],
          outputs: ['anomalies'],
        },
      ],
      edges: [{ id: 'e1', from: 'sensor-read', to: 'filter-outliers' }],
    },
    {
      name: 'demo-workflow-edge-log-etl',
      version: '2.0.0',
      nodes: [
        {
          id: 'collect',
          name: 'Vector Log Collector',
          type: 'task',
          config: { source: 'systemd' },
          inputs: [],
          outputs: ['logs'],
        },
        {
          id: 'compress',
          name: 'Gzip Compression',
          type: 'task',
          config: { level: 6 },
          inputs: ['logs'],
          outputs: ['compressed'],
        },
        {
          id: 'upload',
          name: 'S3 Batch Uploader',
          type: 'task',
          config: { bucket: 'edge-orchestrator-logs' },
          inputs: ['compressed'],
          outputs: [],
        },
      ],
      edges: [
        { id: 'e1', from: 'collect', to: 'compress' },
        { id: 'e2', from: 'compress', to: 'upload' },
      ],
    },
  ];

  for (const wf of workflowDefs) {
    console.log(`Creating workflow: ${wf.name}...`);
    const res = await fetchWithRetry(`${API_BASE_URL}/v2/workflows`, {
      method: 'POST',
      headers,
      body: JSON.stringify(wf),
    });
    if (!res.ok) {
      console.error(`Workflow creation failed:`, res.status, await res.text());
      continue;
    }
    const createdWf = (await res.json()) as any;
    console.log(`Created workflow ${createdWf.id} (${createdWf.name})`);

    // Execute workflow to create executions
    console.log(`Executing workflow ${createdWf.name}...`);
    const execRes = await fetchWithRetry(`${API_BASE_URL}/v2/workflows/${createdWf.id}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: { demoBatchId: 'batch-001' } }),
    });
    if (!execRes.ok) {
      console.error(`Workflow execution failed:`, execRes.status, await execRes.text());
    }
  }

  // 4. Seed Tasks
  console.log('\n=== Step 5: Seed Tasks ===');
  const taskDefs = [
    {
      name: 'demo-task-model-inference-retail-01',
      type: 'MODEL_INFERENCE',
      priority: 'HIGH',
      target: 'EDGE',
    },
    {
      name: 'demo-task-video-processing-traffic-02',
      type: 'VIDEO_PROCESSING',
      priority: 'CRITICAL',
      target: 'EDGE',
    },
    {
      name: 'demo-task-log-analysis-nightly-03',
      type: 'LOG_ANALYSIS',
      priority: 'LOW',
      target: 'CLOUD',
    },
    {
      name: 'demo-task-sensor-fusion-agri-04',
      type: 'SENSOR_FUSION',
      priority: 'MEDIUM',
      target: 'HYBRID',
    },
  ];

  for (const t of taskDefs) {
    const targetNode = createdNodes.find((n) => n.targetStatus === 'ONLINE');
    console.log(`Creating task: ${t.name}...`);
    const res = await fetchWithRetry(`${API_BASE_URL}/v2/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...t,
        nodeId: targetNode?.id,
        input: { demoMode: true },
      }),
    });
    if (!res.ok) {
      console.error(`Task creation failed:`, res.status, await res.text());
    } else {
      const task = (await res.json()) as any;
      console.log(`Created task ${task.id} (${task.name})`);
    }
  }

  console.log('\n=== Data Seeding Completed Successfully! ===');
}

run().catch((err) => {
  console.error('Fatal error in seeding script:', err);
  process.exit(1);
});
