# Realistic Cost-Aware Scheduling Model

## Overview

This document defines a production-grade cost-aware scheduling model that works with or without cloud billing APIs. The model uses **declared pricing** from node registration combined with **actual resource measurements** to calculate accurate execution costs.

## 1. Cost Model Architecture

### 1.1 Cost Components

```
Total Task Cost = Compute Cost + Data Transfer Cost + Storage Cost + Premiums

┌─────────────────────────────────────────────────────────────────┐
│                      COST CALCULATION                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │   Compute   │ + │    Data     │ + │  Storage    │           │
│  │    Cost     │   │  Transfer   │   │    Cost     │           │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘           │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Base Cost                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            +                                    │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │   Cross-    │ + │    Spot     │ + │   Priority  │           │
│  │   Region    │   │   Discount  │   │   Premium   │           │
│  │   Premium   │   │             │   │             │           │
│  └─────────────┘   └─────────────┘   └─────────────┘           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Adjusted Cost                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Cost Categories

| Category | Description | Calculation |
|----------|-------------|-------------|
| **Compute** | CPU/memory usage over time | Rate × Duration × Resources |
| **Data Transfer** | Network I/O | Ingress + Egress × Rate |
| **Storage** | Temporary disk usage | GB × Duration × Rate |
| **Cross-Region** | Data crossing regions | Data × Multiplier |
| **Spot Discount** | Preemptible capacity | Base × Discount % |
| **Priority Premium** | High-priority scheduling | Base × Premium % |

## 2. Node Cost Calculation

### 2.1 Node Pricing Model

Each node declares its pricing during registration:

```typescript
interface NodePricing {
  // Compute pricing (declared at registration)
  compute: {
    baseHourlyRate: number       // $/hour for base instance
    cpuCoreRate: number          // $/hour per CPU core
    memoryGBRate: number         // $/hour per GB RAM
    gpuHourlyRate?: number       // $/hour per GPU (if applicable)
  }
  
  // Data transfer pricing
  dataTransfer: {
    ingressRate: number          // $/GB (usually 0)
    egressRate: number           // $/GB (typically $0.05-$0.12)
    crossRegionMultiplier: number // 1.0-3.0x for cross-region
  }
  
  // Storage pricing
  storage: {
    ephemeralGBRate: number      // $/GB/hour for temp storage
    persistentGBRate: number     // $/GB/hour for persistent
  }
  
  // Discount/premium factors
  modifiers: {
    spotDiscount?: number        // 0.0-0.9 (e.g., 0.7 = 70% off)
    priorityPremium?: number     // 0.0-1.0 (e.g., 0.2 = 20% extra)
    reservedDiscount?: number    // 0.0-0.5 for reserved capacity
  }
  
  // Currency and region
  currency: string               // 'USD', 'EUR', etc.
  region: string                 // 'us-east-1', 'eu-west-1', etc.
  availabilityZone: string       // 'us-east-1a', etc.
}
```

### 2.2 Default Pricing Templates

```typescript
// AWS-like pricing template
const AWS_PRICING_TEMPLATE: NodePricing = {
  compute: {
    baseHourlyRate: 0.0464,      // t3.small on-demand
    cpuCoreRate: 0.02,           // ~$0.02/hr per vCPU
    memoryGBRate: 0.005,         // ~$0.005/hr per GB
    gpuHourlyRate: 0.90,         // V100 spot ~$0.90/hr
  },
  dataTransfer: {
    ingressRate: 0.0,            // Free
    egressRate: 0.09,            // $0.09/GB first 100TB
    crossRegionMultiplier: 2.0,  // 2x for cross-region
  },
  storage: {
    ephemeralGBRate: 0.0001,     // EBS gp3 ~$0.08/GB/month
    persistentGBRate: 0.0001,
  },
  modifiers: {
    spotDiscount: 0.0,           // Set per node
    priorityPremium: 0.0,
    reservedDiscount: 0.0,
  },
  currency: 'USD',
  region: 'us-east-1',
  availabilityZone: 'us-east-1a',
}

// GCP-like pricing template
const GCP_PRICING_TEMPLATE: NodePricing = {
  compute: {
    baseHourlyRate: 0.0408,      // e2-small
    cpuCoreRate: 0.018,
    memoryGBRate: 0.004,
  },
  dataTransfer: {
    ingressRate: 0.0,
    egressRate: 0.12,            // $0.12/GB
    crossRegionMultiplier: 2.0,
  },
  storage: {
    ephemeralGBRate: 0.00008,    // pd-standard
  },
  modifiers: {
    spotDiscount: 0.0,
    priorityPremium: 0.0,
  },
  currency: 'USD',
  region: 'us-central1',
  availabilityZone: 'us-central1-a',
}

// On-premises/edge pricing (self-declared)
const ON_PREM_PRICING_TEMPLATE: NodePricing = {
  compute: {
    baseHourlyRate: 0.02,        // Lower cost for owned hardware
    cpuCoreRate: 0.01,
    memoryGBRate: 0.002,
  },
  dataTransfer: {
    ingressRate: 0.0,
    egressRate: 0.0,             // No egress cost on-prem
    crossRegionMultiplier: 1.0,  // No cross-region premium
  },
  storage: {
    ephemeralGBRate: 0.00005,    // Cheaper local storage
  },
  modifiers: {
    spotDiscount: 0.0,
    priorityPremium: 0.0,
  },
  currency: 'USD',
  region: 'local',
  availabilityZone: 'local',
}
```

### 2.3 Cost Calculation Function

```typescript
function calculateTaskCost(
  task: TaskSpec,
  node: NodeWithPricing,
  controlPlaneRegion: string
): CostEstimate {
  const pricing = node.pricing
  const durationHours = task.estimatedDurationMinutes / 60
  
  // 1. Compute Cost
  const baseCompute = pricing.compute.baseHourlyRate * durationHours
  const cpuCost = pricing.compute.cpuCoreRate * task.cpuCores * durationHours
  const memoryCost = pricing.compute.memoryGBRate * task.memoryGB * durationHours
  const gpuCost = task.requiresGPU 
    ? (pricing.compute.gpuHourlyRate || 0) * task.gpuCount * durationHours 
    : 0
  const rawComputeCost = baseCompute + cpuCost + memoryCost + gpuCost
  
  // 2. Data Transfer Cost
  const ingressCost = task.inputDataGB * pricing.dataTransfer.ingressRate
  const egressCost = task.outputDataGB * pricing.dataTransfer.egressRate
  const baseDataCost = ingressCost + egressCost
  
  // 3. Cross-Region Premium
  const isCrossRegion = pricing.region !== controlPlaneRegion
  const crossRegionPremium = isCrossRegion
    ? (task.inputDataGB + task.outputDataGB) * 
      pricing.dataTransfer.egressRate * 
      (pricing.dataTransfer.crossRegionMultiplier - 1)
    : 0
  
  // 4. Storage Cost
  const storageCost = task.storageGB * 
    pricing.storage.ephemeralGBRate * 
    durationHours
  
  // 5. Apply Modifiers
  let totalCost = rawComputeCost + baseDataCost + crossRegionPremium + storageCost
  
  // Spot discount
  if (pricing.modifiers.spotDiscount) {
    totalCost *= (1 - pricing.modifiers.spotDiscount)
  }
  
  // Reserved discount
  if (pricing.modifiers.reservedDiscount) {
    totalCost *= (1 - pricing.modifiers.reservedDiscount)
  }
  
  // Priority premium (if this is a high-priority task)
  if (task.priority === 'CRITICAL' && pricing.modifiers.priorityPremium) {
    totalCost *= (1 + pricing.modifiers.priorityPremium)
  }
  
  return {
    totalCost: Math.round(totalCost * 10000) / 10000, // 4 decimal places
    breakdown: {
      compute: Math.round(rawComputeCost * 10000) / 10000,
      dataTransfer: Math.round(baseDataCost * 10000) / 10000,
      crossRegion: Math.round(crossRegionPremium * 10000) / 10000,
      storage: Math.round(storageCost * 10000) / 10000,
    },
    appliedDiscounts: {
      spot: pricing.modifiers.spotDiscount || 0,
      reserved: pricing.modifiers.reservedDiscount || 0,
    },
    confidence: calculateConfidence(task, node),
  }
}
```

## 3. Database Schema for Cost Metrics

### 3.1 Node Pricing Table

```sql
-- Add to prisma/schema.prisma

model NodePricing {
  id                  String   @id @default(uuid())
  nodeId              String   @unique
  
  // Compute pricing
  baseHourlyRate      Float    @default(0.05)
  cpuCoreRate         Float    @default(0.02)
  memoryGBRate        Float    @default(0.005)
  gpuHourlyRate       Float?
  
  // Data transfer pricing
  ingressRate         Float    @default(0)
  egressRate          Float    @default(0.09)
  crossRegionMultiplier Float  @default(2.0)
  
  // Storage pricing
  ephemeralGBRate     Float    @default(0.0001)
  persistentGBRate    Float    @default(0.0001)
  
  // Modifiers
  spotDiscount        Float    @default(0)
  reservedDiscount    Float    @default(0)
  priorityPremium     Float    @default(0)
  
  // Metadata
  currency            String   @default("USD")
  region              String
  availabilityZone    String?
  pricingSource       String   @default("declared") // declared, aws, gcp, azure
  lastUpdated         DateTime @default(now())
  
  // Relations
  node                EdgeNode @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  
  @@map("node_pricing")
}
```

### 3.2 Task Cost Estimates Table

```sql
model TaskCostEstimate {
  id                  String   @id @default(uuid())
  taskId              String
  nodeId              String
  
  // Estimated costs (before execution)
  estimatedCompute    Float
  estimatedData       Float
  estimatedStorage    Float
  estimatedTotal      Float
  estimatedDuration   Int      // minutes
  
  // Actual costs (after execution)
  actualCompute       Float?
  actualData          Float?
  actualStorage       Float?
  actualTotal         Float?
  actualDuration      Int?     // milliseconds
  
  // Variance tracking
  costVariance        Float?   // (actual - estimated) / estimated
  durationVariance    Float?
  
  // Metadata
  pricingSnapshot     Json     // Pricing at time of estimate
  confidence          Float    // 0.0-1.0
  estimatedAt         DateTime @default(now())
  actualizedAt        DateTime?
  
  @@index([taskId])
  @@index([nodeId])
  @@map("task_cost_estimates")
}
```

### 3.3 Cost History Table (for learning)

```sql
model CostHistory {
  id                  String   @id @default(uuid())
  nodeId              String
  taskType            String
  
  // Aggregated metrics
  avgDurationMs       Float
  avgComputeCost      Float
  avgDataCost         Float
  avgTotalCost        Float
  
  // Sample statistics
  sampleCount         Int
  stdDeviation        Float
  minCost             Float
  maxCost             Float
  
  // Time window
  periodStart         DateTime
  periodEnd           DateTime
  
  @@index([nodeId, taskType])
  @@map("cost_history")
}
```

## 4. Multi-Factor Scoring Formula

### 4.1 Scoring Algorithm

The scheduler combines multiple factors into a single score for node selection:

```
Score = w₁×CostScore + w₂×LatencyScore + w₃×LoadScore + w₄×ReliabilityScore

Where:
- CostScore = 1 - (NodeCost / MaxCost)        [0-1, higher is better]
- LatencyScore = 1 - (Latency / MaxLatency)   [0-1, higher is better]
- LoadScore = 1 - (CurrentLoad / MaxCapacity) [0-1, higher is better]
- ReliabilityScore = SuccessRate              [0-1, higher is better]
```

### 4.2 Weight Configuration

```typescript
interface SchedulingWeights {
  cost: number        // 0.0-1.0
  latency: number     // 0.0-1.0
  load: number        // 0.0-1.0
  reliability: number // 0.0-1.0
}

// Preset configurations
const POLICY_WEIGHTS: Record<SchedulingPolicy, SchedulingWeights> = {
  'cost-aware': {
    cost: 0.6,
    latency: 0.2,
    load: 0.1,
    reliability: 0.1,
  },
  'latency-aware': {
    cost: 0.2,
    latency: 0.5,
    load: 0.2,
    reliability: 0.1,
  },
  'load-balanced': {
    cost: 0.1,
    latency: 0.2,
    load: 0.5,
    reliability: 0.2,
  },
  'round-robin': {
    cost: 0.25,
    latency: 0.25,
    load: 0.25,
    reliability: 0.25,
  },
}
```

### 4.3 Complete Scoring Function

```typescript
function scoreNode(
  node: Node,
  task: TaskSpec,
  weights: SchedulingWeights,
  context: SchedulingContext
): NodeScore {
  // 1. Calculate cost estimate
  const costEstimate = calculateTaskCost(task, node.pricing, context.controlPlaneRegion)
  
  // 2. Normalize cost (lower is better, so invert)
  const maxCost = context.maxNodeCost || 1.0
  const costScore = Math.max(0, 1 - (costEstimate.totalCost / maxCost))
  
  // 3. Normalize latency (lower is better, so invert)
  const maxLatency = context.maxLatencyMs || 1000
  const latencyScore = Math.max(0, 1 - (node.currentLatencyMs / maxLatency))
  
  // 4. Calculate load score (lower utilization is better)
  const cpuLoad = node.cpuUsagePercent / 100
  const memoryLoad = node.memoryUsagePercent / 100
  const taskLoad = node.tasksRunning / node.maxTasks
  const avgLoad = (cpuLoad + memoryLoad + taskLoad) / 3
  const loadScore = Math.max(0, 1 - avgLoad)
  
  // 5. Calculate reliability score
  const reliabilityScore = node.successRate || 0.95 // Default 95% success
  
  // 6. Apply weights
  const weightedScore = 
    weights.cost * costScore +
    weights.latency * latencyScore +
    weights.load * loadScore +
    weights.reliability * reliabilityScore
  
  // 7. Apply penalties
  let penalty = 0
  if (node.circuitBreakerOpen) penalty += 0.5
  if (node.lastErrorTime && Date.now() - node.lastErrorTime < 60000) penalty += 0.2
  if (node.isMaintenanceMode) penalty = 1.0 // Disqualify
  
  const finalScore = Math.max(0, weightedScore - penalty)
  
  return {
    nodeId: node.id,
    score: finalScore,
    breakdown: {
      cost: costScore,
      latency: latencyScore,
      load: loadScore,
      reliability: reliabilityScore,
    },
    costEstimate,
    penalty,
  }
}
```

## 5. Scheduler Pseudocode

### 5.1 Main Scheduling Loop

```typescript
async function scheduleNextTask(): Promise<SchedulingDecision | null> {
  // 1. Get next task from priority queue
  const taskId = await redis.zpopmax('task:queue')
  if (!taskId) return null
  
  const task = await db.task.findUnique({ 
    where: { id: taskId },
    include: { 
      typeConfig: true,
      costHistory: { take: 10, orderBy: { createdAt: 'desc' } }
    }
  })
  
  if (!task || task.status !== 'PENDING') {
    return null
  }
  
  // 2. Get eligible nodes
  const nodes = await db.edgeNode.findMany({
    where: {
      status: 'ONLINE',
      isMaintenanceMode: false,
      tasksRunning: { lt: db.edgeNode.fields.maxTasks },
    },
    include: { pricing: true, metrics: { take: 1, orderBy: { timestamp: 'desc' } } }
  })
  
  if (nodes.length === 0) {
    // Re-queue task
    await redis.zadd('task:queue', task.priority, task.id)
    return null
  }
  
  // 3. Get scheduling context
  const context = await buildSchedulingContext(nodes)
  
  // 4. Get weights based on policy
  const weights = POLICY_WEIGHTS[task.policy] || POLICY_WEIGHTS['load-balanced']
  
  // 5. Score all nodes
  const scores = nodes.map(node => 
    scoreNode(node, task, weights, context)
  )
  
  // 6. Sort by score (descending)
  scores.sort((a, b) => b.score - a.score)
  
  // 7. Select best node
  const selectedNode = nodes.find(n => n.id === scores[0].nodeId)
  
  if (!selectedNode || scores[0].score < MIN_ACCEPTABLE_SCORE) {
    // No suitable node found, re-queue
    await redis.zadd('task:queue', task.priority, task.id)
    return null
  }
  
  // 8. Create cost estimate record
  await db.taskCostEstimate.create({
    data: {
      taskId: task.id,
      nodeId: selectedNode.id,
      estimatedCompute: scores[0].costEstimate.breakdown.compute,
      estimatedData: scores[0].costEstimate.breakdown.dataTransfer,
      estimatedStorage: scores[0].costEstimate.breakdown.storage,
      estimatedTotal: scores[0].costEstimate.totalCost,
      estimatedDuration: task.estimatedDurationMinutes,
      confidence: scores[0].costEstimate.confidence,
      pricingSnapshot: selectedNode.pricing,
    }
  })
  
  // 9. Return scheduling decision
  return {
    taskId: task.id,
    nodeId: selectedNode.id,
    nodeUrl: selectedNode.url,
    score: scores[0].score,
    scoreBreakdown: scores[0].breakdown,
    estimatedCost: scores[0].costEstimate.totalCost,
    policy: task.policy,
    reason: `Selected ${selectedNode.name} with score ${scores[0].score.toFixed(3)} ` +
            `(cost: $${scores[0].costEstimate.totalCost.toFixed(4)})`,
  }
}
```

### 5.2 Task Resource Estimation

```typescript
function estimateTaskResources(task: Task, history: CostHistory[]): TaskSpec {
  // Use historical data if available
  if (history.length > 0) {
    const avgDuration = history.reduce((s, h) => s + h.avgDurationMs, 0) / history.length
    const avgCpu = history.reduce((s, h) => s + h.avgCpuUsage, 0) / history.length
    const avgMemory = history.reduce((s, h) => s + h.avgMemoryUsage, 0) / history.length
    
    return {
      estimatedDurationMinutes: Math.ceil(avgDuration / 60000),
      cpuCores: Math.ceil(avgCpu),
      memoryGB: Math.ceil(avgMemory),
      storageGB: task.storageGB || 10,
      inputDataGB: task.inputDataGB || 0.1,
      outputDataGB: task.outputDataGB || 0.1,
      requiresGPU: task.requiresGPU || false,
    }
  }
  
  // Default estimates by task type
  const DEFAULT_ESTIMATES: Record<TaskType, TaskSpec> = {
    'IMAGE_CLASSIFICATION': {
      estimatedDurationMinutes: 2,
      cpuCores: 2,
      memoryGB: 4,
      storageGB: 5,
      inputDataGB: 0.5,
      outputDataGB: 0.01,
      requiresGPU: false,
    },
    'DATA_AGGREGATION': {
      estimatedDurationMinutes: 5,
      cpuCores: 1,
      memoryGB: 2,
      storageGB: 10,
      inputDataGB: 1.0,
      outputDataGB: 0.1,
      requiresGPU: false,
    },
    'MODEL_INFERENCE': {
      estimatedDurationMinutes: 1,
      cpuCores: 4,
      memoryGB: 8,
      storageGB: 20,
      inputDataGB: 0.1,
      outputDataGB: 0.01,
      requiresGPU: true,
    },
    // ... other types
  }
  
  return DEFAULT_ESTIMATES[task.type] || DEFAULT_ESTIMATES['DATA_AGGREGATION']
}
```

### 5.3 Actual Cost Recording

```typescript
async function recordActualCost(
  executionId: string,
  metrics: ExecutionMetrics
): Promise<void> {
  const execution = await db.taskExecution.findUnique({
    where: { id: executionId },
    include: { task: true, node: { include: { pricing: true } } }
  })
  
  if (!execution) return
  
  const pricing = execution.node.pricing
  const durationHours = metrics.durationMs / (1000 * 60 * 60)
  
  // Calculate actual costs
  const actualCompute = 
    pricing.baseHourlyRate * durationHours +
    pricing.cpuCoreRate * metrics.avgCpuCores * durationHours +
    pricing.memoryGBRate * metrics.peakMemoryGB * durationHours
  
  const actualData = 
    metrics.networkIngressGB * pricing.ingressRate +
    metrics.networkEgressGB * pricing.egressRate
  
  const actualStorage = 
    metrics.storageUsedGB * pricing.ephemeralGBRate * durationHours
  
  const actualTotal = actualCompute + actualData + actualStorage
  
  // Update cost estimate record
  await db.taskCostEstimate.updateMany({
    where: { taskId: execution.taskId },
    data: {
      actualCompute,
      actualData,
      actualStorage,
      actualTotal,
      actualDuration: metrics.durationMs,
      costVariance: (actualTotal - execution.estimatedCost) / execution.estimatedCost,
      durationVariance: (metrics.durationMs - execution.estimatedDuration * 60000) / 
                        (execution.estimatedDuration * 60000),
      actualizedAt: new Date(),
    }
  })
  
  // Update cost history for learning
  await updateCostHistory(execution.nodeId, execution.task.type, {
    durationMs: metrics.durationMs,
    computeCost: actualCompute,
    dataCost: actualData,
    totalCost: actualTotal,
  })
}
```

## 6. Dashboard Representation

### 6.1 Cost Dashboard Components

```typescript
// Dashboard data structure
interface CostDashboard {
  // Current period summary
  summary: {
    totalSpend: number
    projectedMonthly: number
    costTrend: 'increasing' | 'stable' | 'decreasing'
    savingsFromSpot: number
    savingsFromReserved: number
  }
  
  // Cost by dimension
  byRegion: Array<{ region: string; cost: number; percentage: number }>
  byTaskType: Array<{ type: string; cost: number; count: number; avgCost: number }>
  byNode: Array<{ nodeId: string; nodeName: string; cost: number; efficiency: number }>
  
  // Cost over time
  timeSeries: Array<{ timestamp: Date; cost: number; taskCount: number }>
  
  // Optimization recommendations
  recommendations: Array<{
    type: 'spot' | 'reserved' | 'region' | 'rightsize'
    description: string
    potentialSavings: number
    impact: 'low' | 'medium' | 'high'
  }>
}
```

### 6.2 Node Cost Card Component

```tsx
function NodeCostCard({ node }: { node: NodeWithCosts }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{node.name}</CardTitle>
        <CardDescription>{node.region}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Hourly rate breakdown */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base Rate</span>
            <span>${node.pricing.baseHourlyRate.toFixed(4)}/hr</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">CPU Rate</span>
            <span>${node.pricing.cpuCoreRate.toFixed(4)}/core/hr</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Memory Rate</span>
            <span>${node.pricing.memoryGBRate.toFixed(4)}/GB/hr</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Egress Rate</span>
            <span>${node.pricing.egressRate.toFixed(2)}/GB</span>
          </div>
        </div>
        
        {/* Discounts */}
        {node.pricing.spotDiscount > 0 && (
          <div className="mt-4 p-2 bg-green-100 rounded">
            <span className="text-green-700">
              {(node.pricing.spotDiscount * 100).toFixed(0)}% Spot Discount
            </span>
          </div>
        )}
        
        {/* Today's cost */}
        <div className="mt-4 pt-4 border-t">
          <div className="flex justify-between font-semibold">
            <span>Today's Cost</span>
            <span>${node.todayCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Tasks Executed</span>
            <span>{node.todayTasks}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

### 6.3 Task Cost Breakdown Component

```tsx
function TaskCostBreakdown({ task }: { task: TaskWithCosts }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Cost Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Estimated vs Actual */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-sm text-muted-foreground">Estimated</p>
            <p className="text-2xl font-bold">${task.costEstimate.estimatedTotal.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Actual</p>
            <p className={`text-2xl font-bold ${
              task.costEstimate.actualTotal > task.costEstimate.estimatedTotal 
                ? 'text-red-500' 
                : 'text-green-500'
            }`}>
              ${task.costEstimate.actualTotal?.toFixed(4) || '—'}
            </p>
          </div>
        </div>
        
        {/* Breakdown bar chart */}
        <div className="space-y-2">
          <CostBar 
            label="Compute" 
            value={task.costEstimate.actualCompute || task.costEstimate.estimatedCompute}
            total={task.costEstimate.actualTotal || task.costEstimate.estimatedTotal}
            color="bg-blue-500"
          />
          <CostBar 
            label="Data Transfer" 
            value={task.costEstimate.actualData || task.costEstimate.estimatedData}
            total={task.costEstimate.actualTotal || task.costEstimate.estimatedTotal}
            color="bg-orange-500"
          />
          <CostBar 
            label="Storage" 
            value={task.costEstimate.actualStorage || task.costEstimate.estimatedStorage}
            total={task.costEstimate.actualTotal || task.costEstimate.estimatedTotal}
            color="bg-purple-500"
          />
        </div>
        
        {/* Confidence */}
        <div className="mt-4 text-sm text-muted-foreground">
          Confidence: {(task.costEstimate.confidence * 100).toFixed(0)}%
        </div>
      </CardContent>
    </Card>
  )
}

function CostBar({ label, value, total, color }: { 
  label: string
  value: number
  total: number
  color: string 
}) {
  const percentage = (value / total) * 100
  
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span>${value.toFixed(4)}</span>
      </div>
      <div className="h-2 bg-gray-200 rounded">
        <div 
          className={`h-full rounded ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
```

### 6.4 Cost Optimization Recommendations

```tsx
function CostRecommendations({ data }: { data: CostDashboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Optimization</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-3 p-3 border rounded">
              <div className={`p-2 rounded ${
                rec.impact === 'high' ? 'bg-green-100' :
                rec.impact === 'medium' ? 'bg-yellow-100' : 'bg-gray-100'
              }`}>
                {rec.type === 'spot' && <ZapIcon className="w-4 h-4" />}
                {rec.type === 'reserved' && <CalendarIcon className="w-4 h-4" />}
                {rec.type === 'region' && <GlobeIcon className="w-4 h-4" />}
                {rec.type === 'rightsize' && <SettingsIcon className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <p className="font-medium">{rec.description}</p>
                <p className="text-sm text-green-600">
                  Potential savings: ${rec.potentialSavings.toFixed(2)}/month
                </p>
              </div>
              <Badge variant={
                rec.impact === 'high' ? 'default' :
                rec.impact === 'medium' ? 'secondary' : 'outline'
              }>
                {rec.impact}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
```

## 7. Working Without Cloud Billing APIs

### 7.1 Self-Declared Pricing

When cloud billing APIs are unavailable, nodes self-declare pricing:

```typescript
// Node registration with pricing
app.post('/api/nodes/register', async (req, res) => {
  const { name, region, pricing, ...nodeData } = req.body
  
  // Validate pricing
  if (!isValidPricing(pricing)) {
    return res.status(400).json({ error: 'Invalid pricing configuration' })
  }
  
  // Use template defaults for missing fields
  const template = getTemplateForRegion(region)
  const finalPricing = { ...template, ...pricing }
  
  const node = await db.edgeNode.create({
    data: {
      name,
      region,
      ...nodeData,
      pricing: { create: finalPricing }
    }
  })
  
  return res.status(201).json(node)
})
```

### 7.2 Pricing Validation

```typescript
function isValidPricing(pricing: Partial<NodePricing>): boolean {
  // Required fields
  if (pricing.baseHourlyRate === undefined || pricing.baseHourlyRate < 0) return false
  if (pricing.region === undefined) return false
  
  // Reasonable bounds
  if (pricing.baseHourlyRate > 100) return false // $100/hr seems wrong
  if (pricing.egressRate > 1) return false // $1/GB seems wrong
  
  // Discount bounds
  if (pricing.spotDiscount && (pricing.spotDiscount < 0 || pricing.spotDiscount > 0.95)) return false
  
  return true
}
```

### 7.3 Cost Learning from History

```typescript
// Improve estimates based on actual execution data
async function refineCostEstimates(): Promise<void> {
  const recentExecutions = await db.taskCostEstimate.findMany({
    where: {
      actualizedAt: { gte: subDays(new Date(), 30) },
      costVariance: { not: null }
    }
  })
  
  // Group by task type and node
  const grouped = groupBy(recentExecutions, e => `${e.taskId}-${e.nodeId}`)
  
  for (const [key, estimates] of Object.entries(grouped)) {
    const avgVariance = average(estimates.map(e => e.costVariance!))
    
    // If consistently over/under estimating, adjust
    if (Math.abs(avgVariance) > 0.2) {
      await db.costAdjustment.create({
        data: {
          key,
          adjustmentFactor: 1 + avgVariance,
          sampleSize: estimates.length,
          validFrom: new Date()
        }
      })
    }
  }
}
```

---

## Summary

| Component | Implementation |
|-----------|----------------|
| **Cost Model** | Multi-factor: compute + data + storage + premiums |
| **Node Pricing** | Self-declared with cloud provider templates |
| **Database** | NodePricing, TaskCostEstimate, CostHistory tables |
| **Scoring** | Weighted combination of cost, latency, load, reliability |
| **Scheduler** | Score-based selection with cost estimation |
| **Dashboard** | Cost cards, breakdowns, recommendations |
| **No API Mode** | Self-declared pricing + learning from history |

**Key Benefits:**
1. Works without cloud billing APIs
2. Improves estimates over time
3. Transparent cost breakdown
4. Policy-based weighting
5. Actionable recommendations
