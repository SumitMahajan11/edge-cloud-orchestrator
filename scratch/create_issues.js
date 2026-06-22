const repo = 'SumitMahajan11/edge-cloud-orchestrator';
const token = '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';

async function apiCall(path, method = 'GET', body = null) {
  const url = `https://api.github.com${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'node-fetch'
    }
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API call to ${path} failed (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

const issuesToCreate = [
  {
    title: 'feat: add GPU workload scheduling support',
    labels: ['enhancement'],
    milestone: true,
    body: `Currently the scheduler only considers CPU and memory when scoring nodes.
GPU-equipped edge nodes (NVIDIA Jetson, AMD Radeon RX) are not distinguished
from CPU-only nodes.

Acceptance criteria:
- EdgeNode model gains gpuModel, gpuMemoryMb fields
- Task model gains requiresGpu boolean field
- Scheduler scores GPU nodes higher for GPU tasks, lower for CPU tasks
- Agent reports GPU metrics via heartbeat if GPU is detected
- API docs updated`
  },
  {
    title: 'feat: gRPC streaming for agent heartbeats (replace HTTP polling)',
    labels: ['enhancement', 'performance'],
    milestone: true,
    body: `Currently agents send heartbeat metrics every 5 seconds via HTTP POST.
At 1000+ nodes this creates significant API load.

Proposal: migrate to gRPC bidirectional streaming for heartbeats.
Agents push metrics only when values change significantly (>5% CPU delta).
This would reduce API load by 10x and enable real-time placement decisions.

Requires: gRPC proxy in front of Fastify API, Rust agent gRPC client,
protobuf schema for heartbeat messages.`
  },
  {
    title: 'feat: WASM task runtime for sub-5ms cold start at edge',
    labels: ['enhancement', 'agent'],
    milestone: true,
    body: `Docker cold start at the edge is 100-500ms. For short-lived tasks
(sensor processing, inference, transforms) this is unacceptable.

Proposal: add runtime: "wasm" option to Task model. Rust agent executes
WASM modules using wasmtime with WASI interface for I/O.
Expected cold start: <5ms. Memory overhead: ~2MB per module.`
  },
  {
    title: 'improvement: add time-series partitioning to NodeMetric table',
    labels: ['enhancement', 'database', 'performance'],
    body: `At 100 nodes sending heartbeats every 5 seconds, NodeMetric
accumulates ~1.7M rows/day. Without partitioning, queries degrade
after ~30 days of production use.

Proposal:
1. Add Postgres range partitioning by week on NodeMetric.createdAt
2. Implement nightly TTL cleanup job (configurable retention, default 30 days)
3. Add @@index([tenantId, createdAt]) for efficient range queries`
  },
  {
    title: 'improvement: MLOps pipeline — automate retraining when drift fires',
    labels: ['enhancement', 'ml'],
    body: `The drift detector (packages/ml-scheduler/src/drift-detector.ts) detects
PSI drift and logs it, but does not trigger retraining automatically.
In production, model accuracy degrades silently over weeks.

Proposal:
1. Wire drift-detected event to automated retraining job
2. Implement shadow model validation before promotion
3. Add model checkpointing (keep last 3 versions for rollback)
4. Add GET /v2/ml/model-status endpoint`
  },
  {
    title: 'docs: add .env.example files for all apps',
    labels: ['good-first-issue', 'documentation'],
    body: `New contributors need to know which environment variables to set.
Currently no .env.example files exist in apps/api or apps/web.

Task: create apps/api/.env.example and apps/web/.env.example with
all required variables listed with descriptions and safe example values.
Sensitive values should use placeholder like: JWT_SECRET=`
  },
  {
    title: 'test: add unit tests for packages/circuit-breaker',
    labels: ['good-first-issue', 'testing'],
    body: `packages/circuit-breaker has implementation code but minimal unit tests.
The circuit breaker is a critical reliability component.

Task: add tests for:
- Circuit opens after N consecutive failures (configurable)
- Circuit enters HALF_OPEN state after timeout
- Circuit closes after M successful requests in HALF_OPEN
- Redis state is correctly persisted and read back`
  },
  {
    title: 'docs: write ADR for event-driven architecture decision',
    labels: ['good-first-issue', 'documentation'],
    body: `The project uses a transactional outbox pattern and event bus but
no Architecture Decision Record documents why this was chosen over
direct event publishing.

Task: create docs/decisions/ADR-007-event-driven-outbox.md following
the existing ADR format in docs/decisions/.`
  },
  {
    title: 'research: evaluate TimescaleDB vs Postgres partitioning for metrics',
    labels: ['research', 'database'],
    body: `The NodeMetric table is essentially time-series data. Two options:
1. Postgres native partitioning (current plan)
2. TimescaleDB extension (purpose-built for time-series)

Research question: at what node count does TimescaleDB become worth
the operational complexity? What are the migration paths?`
  },
  {
    title: 'research: federated learning feasibility across heterogeneous edge agents',
    labels: ['research', 'ml'],
    body: `Federated learning would allow each Rust agent to train a local
scheduling model and contribute weight updates to a global model
without sharing raw workload data.

Research question: is FedAvg feasible with Rust (tract-onnx) agents
communicating with a TF.js central aggregator? What are the
serialisation and versioning challenges?`
  },
  {
    title: 'feat: multi-region HA with Postgres streaming replication',
    labels: ['enhancement'],
    milestone: true,
    body: `To support high availability across different regions, the control plane needs to operate in a multi-region setup with database replication.

Acceptance criteria:
- Document architecture for Postgres streaming replication (primary-replica model).
- API routes must route write operations to primary and read operations to the nearest read replica.
- Implement health check endpoints to monitor replication lag and connection status.
- Add failover script to promote replica to primary in case of regional outages.`
  },
  {
    title: 'improvement: add pnpm audit to PR checks (block on critical CVEs)',
    labels: ['enhancement', 'testing'],
    body: `Currently, the PR verification pipeline does not perform dependency security auditing. We should prevent merging PRs that introduce critical CVEs.

Proposal:
1. Add \`pnpm audit\` execution to the GitHub Actions workflow for pull requests.
2. Configure the action to fail and block the PR merge if any critical vulnerabilities (CVEs) are found.
3. Establish a bypass or override process for known false positives or non-exploitable vulnerabilities (e.g., using an audit configuration file).`
  },
  {
    title: 'improvement: complete packages/analytics implementation or remove',
    labels: ['enhancement', 'refactoring'],
    body: `The \`packages/analytics\` folder contains partial analytics implementation with incomplete telemetry hooks, but is currently unused and causing build/maintenance overhead.

Task:
- Review the code in \`packages/analytics\`.
- If we want to keep it, complete the missing event track functions and wire them into the dashboard and API routes.
- Otherwise, remove the package completely, update root package configs, and cleanup dependency trees to keep the repository clean.`
  },
  {
    title: 'good-first-issue: add OpenTelemetry trace IDs to all log lines',
    labels: ['good-first-issue', 'enhancement', 'observability'],
    body: `It is currently difficult to correlate server logs with distributed trace spans. Adding OpenTelemetry trace IDs to all console and file log outputs would greatly improve debugging.

Task:
- Configure the application's logging library (e.g., pino or custom logger) to fetch the active span context from OpenTelemetry.
- Append \`trace_id\` and \`span_id\` automatically to all formatted log records.
- Add integration test to verify trace correlation works correctly.`
  },
  {
    title: 'feat: per-tenant carbon compliance CSV export (EU CSRD format)',
    labels: ['enhancement'],
    milestone: true,
    body: `To satisfy EU Corporate Sustainability Reporting Directive (CSRD) requirements, multi-tenant users need to export CSV reports showing the carbon footprint of their scheduled edge workloads.

Acceptance criteria:
- Create an API route \`GET /v1/tenants/:id/compliance/carbon-report\` to generate CSRD compliant CSVs.
- Read carbon score and energy consumption data from \`NodeMetric\` database records.
- Format CSV columns containing tenant details, timestamp range, total energy consumed (kWh), and carbon score distribution.
- Add "Export Carbon Compliance" button to the dashboard settings page.`
  }
];

const targetMilestoneTitle = 'v4.3.0';

const colors = {
  enhancement: 'a2eeef',
  bug: 'd73a4a',
  'good-first-issue': '7057ff',
  'help-wanted': '008672',
  research: 'd4c5f9',
  performance: '5319e7',
  agent: 'fbca04',
  database: 'bfd4f2',
  ml: '1d76db',
  observability: '0e8a16',
  refactoring: 'f9d0c4',
  testing: '006b75',
  documentation: '0075ca'
};

async function main() {
  try {
    console.log('Fetching existing milestones...');
    const milestones = await apiCall(`/repos/${repo}/milestones?state=all`);
    let milestone = milestones.find(m => m.title === targetMilestoneTitle);
    let milestoneNumber;
    
    if (!milestone) {
      console.log(`Milestone ${targetMilestoneTitle} not found. Creating it...`);
      milestone = await apiCall(`/repos/${repo}/milestones`, 'POST', {
        title: targetMilestoneTitle,
        description: 'Features and roadmap items for the v4.3.0 release.'
      });
      milestoneNumber = milestone.number;
      console.log(`Milestone created: #${milestoneNumber}`);
    } else {
      milestoneNumber = milestone.number;
      console.log(`Found existing milestone ${targetMilestoneTitle}: #${milestoneNumber}`);
    }

    console.log('Fetching existing labels...');
    const existingLabelsRes = await apiCall(`/repos/${repo}/labels`);
    const existingLabelNames = new Set(existingLabelsRes.map(l => l.name));

    for (const labelName of Object.keys(colors)) {
      if (!existingLabelNames.has(labelName)) {
        console.log(`Creating label: ${labelName}`);
        await apiCall(`/repos/${repo}/labels`, 'POST', {
          name: labelName,
          color: colors[labelName],
          description: `Custom label for ${labelName}`
        });
      } else {
        console.log(`Label ${labelName} already exists`);
      }
    }

    console.log('Creating issues...');
    const createdIssues = [];
    for (const issue of issuesToCreate) {
      const issueBody = {
        title: issue.title,
        body: issue.body,
        labels: issue.labels
      };
      if (issue.milestone) {
        issueBody.milestone = milestoneNumber;
      }
      
      console.log(`Creating issue: ${issue.title}...`);
      const created = await apiCall(`/repos/${repo}/issues`, 'POST', issueBody);
      console.log(`Successfully created issue #${created.number}: ${created.html_url}`);
      createdIssues.push(created);
      
      // Delay to avoid hitting rate limits or triggers
      await new Promise(r => setTimeout(r, 1000));
    }
    
    console.log('\nAll issues successfully created!');
    console.log('Created Issue Summary:');
    createdIssues.forEach(i => {
      console.log(`- #${i.number} [${i.title}] (${i.html_url})`);
    });
  } catch (error) {
    console.error('Error in main execution:', error);
    process.exit(1);
  }
}

main();
