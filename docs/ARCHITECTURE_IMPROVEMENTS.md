# Architecture Improvements - Implementation Guide

## Summary of All 12 Issues and Solutions

---

### ✅ Issue 1: Control Plane vs Data Plane Architecture Clarity

**Problem**: Mixed concerns between decision-making and execution

**Solution Implemented**:
- Created `docs/ARCHITECTURE.md` with clear separation
- Refactored `TaskScheduler` with explicit CONTROL PLANE COMPONENT comment
- Defined service boundaries and communication patterns

**Key Changes**:
```typescript
// Control Plane: Makes decisions only
interface SchedulerService {
  scheduleTask(task: Task): Promise<SchedulingDecision>
  // NO: executeTask, manageContainers, collectMetrics
}

// Data Plane: Executes only
interface TaskExecutor {
  execute(task: TaskSpec): Promise<ExecutionResult>
  // NO: makeSchedulingDecisions, evaluatePolicies
}
```

---

### ✅ Issue 2: Cost-Aware Scheduler Realism

**Problem**: Naive cost sorting by `costPerHour` only

**Solution Implemented**:
- Created `src/services/cost-optimizer.ts` with multi-factor cost model
- Factors: compute, data transfer, storage, network premiums, spot discounts
- Cloud provider profiles (AWS/GCP/Azure) with realistic pricing

**Usage**:
```typescript
const optimizer = new CostOptimizer()
const result = optimizer.selectMostCostEffective(
  taskEstimate,
  nodeProfiles,
  controlPlaneRegion
)
// Returns: totalCost, breakdown, confidence, factors
```

---

### ✅ Issue 3: mTLS Authentication Clarity

**Problem**: mTLS mentioned but not clearly specified

**Solution Implemented**:
- Created `docs/MTLS_SPECIFICATION.md` with complete flow diagrams
- Created `src/services/certificate-manager.ts` for PKI management
- Defined certificate hierarchy: Root CA → Intermediate CA → Node Certs

**Key Features**:
- Bootstrap token-based initial registration
- Automatic certificate rotation (30d warning, 14d auto-rotate)
- CRL (Certificate Revocation List) management
- Certificate verification with revocation checking

---

### ✅ Issue 4: Missing TaskExecution Database Entity

**Problem**: Task conflates definition with execution

**Solution Implemented**:
- Modified `prisma/schema.prisma` to add `TaskExecution` model
- Separated concerns:
  - `Task`: Definition (what to run, input, policy)
  - `TaskExecution`: Instance (when, where, actual resources, exit code)

**Schema Changes**:
```prisma
model Task {
  id          String          @id
  input       Json?           // Task definition
  executions  TaskExecution[] // Multiple execution attempts
}

model TaskExecution {
  id           String   @id
  taskId       String
  attemptNumber Int     @default(1)
  nodeId       String?
  startedAt    DateTime?
  completedAt  DateTime?
  durationMs   Int?
  cpuUsageAvg  Float?   // Actual resource usage
  memoryUsageMax Float?
  costUSD      Float?   // Actual cost
  exitCode     Int?     // Container exit code
}
```

---

### ✅ Issue 5: Monitoring Metrics Definition

**Problem**: Metrics not clearly defined

**Solution Implemented**:
- Created `docs/METRICS_SPECIFICATION.md`
- Defined 4 metric categories with 20+ specific metrics
- Prometheus/OpenTelemetry format with labels

**Categories**:
1. Control Plane: scheduling_decisions, queue_depth, api_requests
2. Data Plane: cpu_usage, memory_usage, tasks_running
3. Task Execution: duration, queue_wait, resource_usage, cost
4. Business: total_cost, sla_uptime, success_rate

---

### 🔄 Issue 6: Compliance Wording Improvements

**Problem**: Vague compliance claims ("GDPR compliant", "SOC2")

**Solution Required**:

Replace vague claims with specific implementations:

```typescript
// BEFORE (vague)
"GDPR compliant data retention"

// AFTER (specific)
interface GDPRRetentionPolicy {
  purpose: 'task_execution' | 'audit' | 'billing'
  dataTypes: ['task_input', 'task_output', 'logs']
  retentionDays: 90
  anonymizationRequired: true
  rightToErasure: true
  dataPortability: 'json_export'
}

// Implementation
class ComplianceManager {
  async enforceRetentionPolicy(policy: RetentionPolicy) {
    // 1. Identify expired records
    // 2. Anonymize personal data
    // 3. Export if data portability requested
    // 4. Delete or aggregate
    // 5. Log compliance action
  }
}
```

**Action Items**:
1. Create `docs/COMPLIANCE_SPECIFICATION.md`
2. Define specific retention policies per regulation
3. Implement `ComplianceManager` service
4. Add audit logging for all compliance actions

---

### 🔄 Issue 7: Performance Benchmark Transparency

**Problem**: Benchmarks lack methodology and reproducibility

**Solution Required**:

Create transparent benchmarking framework:

```typescript
// benchmark/suite.ts
interface BenchmarkConfig {
  name: string
  description: string
  environment: {
    nodeCount: number
    nodeSpecs: 't3.small' | 't3.medium'
    networkLatency: '0ms' | '50ms' | '100ms'
  }
  loadProfile: {
    concurrentTasks: number
    taskDuration: number
    rampUpTime: number
  }
  metrics: {
    schedulingLatency: { p50: number; p95: number; p99: number }
    taskThroughput: number
    successRate: number
  }
}

// Reproducible benchmark
const benchmark = new BenchmarkSuite({
  name: 'Standard Load Test',
  description: '100 concurrent tasks across 3 nodes',
  environment: {
    nodeCount: 3,
    nodeSpecs: 't3.small',
    networkLatency: '50ms'
  },
  loadProfile: {
    concurrentTasks: 100,
    taskDuration: 5000, // 5s
    rampUpTime: 60000   // 1min
  }
})

await benchmark.run()
const report = benchmark.generateReport()
// Includes: raw data, statistical analysis, environment details
```

**Action Items**:
1. Create `benchmark/` directory with reproducible test suites
2. Document exact environment specifications
3. Store benchmark results with git commits
4. Create CI/CD integration for performance regression testing

---

### 🔄 Issue 8: Backend TypeScript Errors (Fastify + JWT)

**Problem**: 89 TypeScript errors due to type conflicts

**Root Cause**: `@fastify/jwt` declares `user` property that conflicts with custom declaration

**Solution Required**:

```typescript
// src/types/fastify.d.ts - FIXED VERSION
import { FastifyRequest } from 'fastify'
import '@fastify/jwt'

// Extend @fastify/jwt's user type instead of overriding
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string
      email: string
      role: 'ADMIN' | 'OPERATOR' | 'VIEWER'
    }
  }
}

// Remove duplicate FastifyRequest declaration
// @fastify/jwt already adds: request.user: FastifyJWT['payload']
```

**Additional Fixes Needed**:
1. Update all route handlers to use proper Fastify types
2. Remove `tags` and `summary` from route schemas (use separate OpenAPI spec)
3. Fix Prisma enum imports by using string literals

**Action Items**:
1. Fix `src/types/fastify.d.ts` to properly extend @fastify/jwt
2. Refactor route handlers for type safety
3. Run `tsc --noEmit` until 0 errors
4. Add type-checking to CI/CD pipeline

---

### 🔄 Issue 9: API Lifecycle Completeness

**Problem**: API versioning and deprecation strategy not defined

**Solution Required**:

```typescript
// src/routes/versioned-api.ts
interface APIVersion {
  version: 'v1' | 'v2'
  status: 'stable' | 'deprecated' | 'sunset'
  sunsetDate?: Date
  migrationGuide?: string
}

// Version middleware
app.register(async function (app) {
  app.addHook('onRequest', async (request, reply) => {
    const version = request.headers['api-version'] || 'v1'
    
    if (version === 'v1' && isDeprecated('v1')) {
      reply.header('Deprecation', 'true')
      reply.header('Sunset', getSunsetDate('v1').toISOString())
    }
  })
})

// Route registration with versioning
app.register(v1Routes, { prefix: '/v1' })
app.register(v2Routes, { prefix: '/v2' })
```

**API Lifecycle Policy**:
| Stage | Duration | Support Level |
|-------|----------|---------------|
| Beta | 1-3 months | Best effort, breaking changes possible |
| Stable | 12+ months | Full support, no breaking changes |
| Deprecated | 6 months | Security fixes only, migration warnings |
| Sunset | - | Removed, returns 410 Gone |

**Action Items**:
1. Create `docs/API_LIFECYCLE.md`
2. Implement version routing middleware
3. Add deprecation headers to responses
4. Create migration guides for each version

---

### 🔄 Issue 10: System Topology Explanation

**Problem**: Network topology and failure domains not documented

**Solution Required**:

```
┌─────────────────────────────────────────────────────────────────┐
│                        REGION: us-east-1                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    AVAILABILITY ZONE A                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │  Control    │  │  Control    │  │  Database   │     │   │
│  │  │  Plane 1    │  │  Plane 2    │  │  Primary    │     │   │
│  │  │  (Active)   │  │  (Standby)  │  │             │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │ Cross-AZ Link (1-2ms)            │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    AVAILABILITY ZONE B                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │  Edge Node  │  │  Edge Node  │  │  Database   │     │   │
│  │  │  Pool A     │  │  Pool B     │  │  Replica    │     │   │
│  │  │  (10 nodes) │  │  (10 nodes) │  │             │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Cross-Region Link (20-50ms)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        REGION: eu-west-1                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    AVAILABILITY ZONE A                   │   │
│  │  ┌─────────────┐  ┌─────────────┐                      │   │
│  │  │  Edge Node  │  │  Edge Node  │                      │   │
│  │  │  Pool C     │  │  Pool D     │                      │   │
│  │  │  (5 nodes)  │  │  (5 nodes)  │                      │   │
│  │  └─────────────┘  └─────────────┘                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Failure Domains**:
| Level | Scope | Impact | Mitigation |
|-------|-------|--------|------------|
| Node | Single edge node | 1/N capacity | Health checks, auto-reschedule |
| AZ | Availability zone | Regional capacity | Multi-AZ deployment |
| Region | Geographic region | Latency increase | Cross-region failover |
| Control Plane | Orchestrator | Scheduling halt | Hot standby, leader election |

**Action Items**:
1. Create `docs/TOPOLOGY.md` with network diagrams
2. Document failure domains and blast radius
3. Define RTO/RPO for each component
4. Create runbooks for failure scenarios

---

### 🔄 Issue 11: Distributed Queue Integration

**Problem**: Redis queue is simple but lacks advanced features

**Solution Required**:

Implement pluggable queue architecture:

```typescript
// src/queue/interface.ts
interface TaskQueue {
  enqueue(task: Task, priority: number): Promise<void>
  dequeue(): Promise<Task | null>
  ack(taskId: string): Promise<void>
  nack(taskId: string, requeue: boolean): Promise<void>
  getQueueDepth(): Promise<number>
  subscribe(callback: (task: Task) => Promise<void>): void
}

// Redis implementation (simple, existing)
class RedisQueue implements TaskQueue {
  // Uses Redis Sorted Sets for priority
}

// RabbitMQ implementation (advanced features)
class RabbitMQQueue implements TaskQueue {
  // Dead letter queues
  // Message TTL
  // Priority queues
  // Persistence
}

// Apache Kafka implementation (high throughput)
class KafkaQueue implements TaskQueue {
  // Partitioning by task type
  // Consumer groups
  // Exactly-once semantics
}
```

**Queue Comparison**:
| Feature | Redis | RabbitMQ | Kafka |
|---------|-------|----------|-------|
| Persistence | Optional | Yes | Yes |
| Priority | Yes | Yes | No |
| Dead Letter | No | Yes | Manual |
| Throughput | High | Medium | Very High |
| Complexity | Low | Medium | High |

**Action Items**:
1. Create `src/queue/` directory with interface
2. Implement RedisQueue (existing code migration)
3. Add RabbitMQQueue for production deployments
4. Create queue selection guide

---

### 🔄 Issue 12: Scope Simplification

**Problem**: Too many features dilute core orchestration

**Current Scope (Too Broad)**:
- ✅ Task scheduling
- ✅ Node management
- ✅ Webhooks
- ✅ Federated learning
- ✅ Carbon tracking
- ✅ Cost optimization
- ✅ Multi-tenancy
- ✅ Workflow orchestration

**Recommended Scope (Core Loop)**:
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Submit     │────►│   Schedule   │────►│   Execute    │
│   Task       │     │   on Node    │     │   Task       │
└──────────────┘     └──────────────┘     └──────┬───────┘
       ▲                                          │
       │                                          │
       └──────────────┐     ┌─────────────────────┘
                      │     │
                      ▼     ▼
               ┌──────────────┐
               │   Monitor    │
               │   & Report   │
               └──────────────┘
```

**Phase 1 (Core) - Keep**:
1. Task scheduling (4 policies)
2. Node management + heartbeat
3. Container execution
4. Basic monitoring

**Phase 2 (Extended) - Move to plugins**:
1. Federated learning
2. Carbon tracking
3. Advanced workflows
4. Multi-tenancy

**Action Items**:
1. Create plugin architecture
2. Move non-core features to `@edgecloud/plugins`
3. Document core vs extended scope
4. Focus engineering on core loop reliability

---

## Implementation Priority

### High Priority (Week 1-2)
1. ✅ Issue 1: Control Plane/Data Plane separation (DONE)
2. ✅ Issue 2: Cost optimizer (DONE)
3. ✅ Issue 3: mTLS specification (DONE)
4. ✅ Issue 4: TaskExecution entity (DONE - needs migration)
5. 🔄 Issue 8: TypeScript errors (CRITICAL)

### Medium Priority (Week 3-4)
6. 🔄 Issue 5: Metrics specification (DONE - needs implementation)
7. 🔄 Issue 9: API lifecycle
8. 🔄 Issue 11: Queue abstraction

### Lower Priority (Month 2)
9. 🔄 Issue 6: Compliance specification
10. 🔄 Issue 7: Benchmark framework
11. 🔄 Issue 10: Topology documentation
12. 🔄 Issue 12: Scope simplification (plugin architecture)

---

## Migration Guide

### Database Migration (Issue 4)

```sql
-- Create TaskExecution table
CREATE TABLE task_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_number INTEGER DEFAULT 1,
  node_id UUID REFERENCES edge_nodes(id),
  scheduled_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  status VARCHAR(20) DEFAULT 'PENDING',
  exit_code INTEGER,
  cpu_usage_avg FLOAT,
  memory_usage_max FLOAT,
  cost_usd FLOAT DEFAULT 0
);

-- Migrate existing data
INSERT INTO task_executions (
  task_id, node_id, scheduled_at, started_at, 
  completed_at, duration_ms, status, cost_usd
)
SELECT 
  id, node_id, submitted_at, started_at,
  completed_at, duration, status, cost
FROM tasks
WHERE status IN ('RUNNING', 'COMPLETED', 'FAILED');

-- Update tasks table (remove execution columns)
ALTER TABLE tasks DROP COLUMN started_at;
ALTER TABLE tasks DROP COLUMN completed_at;
ALTER TABLE tasks DROP COLUMN duration;
ALTER TABLE tasks DROP COLUMN cost;
ALTER TABLE tasks DROP COLUMN latency_ms;
```

### Code Migration (Issue 8)

```bash
# 1. Fix type declarations
npm run typecheck

# 2. Fix individual files
npx tsc --noEmit 2>&1 | grep "error TS" | head -20

# 3. Run linter
npm run lint

# 4. Run tests
npm test
```

---

## Success Criteria

| Issue | Success Criteria |
|-------|------------------|
| 1 | Clear separation, no mixed concerns |
| 2 | Multi-factor cost model with cloud profiles |
| 3 | Complete mTLS with certificate rotation |
| 4 | Task/TaskExecution separation, migration complete |
| 5 | 20+ metrics defined, Prometheus format |
| 6 | Specific compliance implementations documented |
| 7 | Reproducible benchmarks with methodology |
| 8 | 0 TypeScript errors, strict mode enabled |
| 9 | Versioned API with deprecation headers |
| 10 | Network topology documented with failure domains |
| 11 | Pluggable queue interface, 2+ implementations |
| 12 | Plugin architecture, core loop isolated |

---

**Document Version**: 1.0  
**Last Updated**: March 2026  
**Status**: 4/12 Complete, 8 In Progress
