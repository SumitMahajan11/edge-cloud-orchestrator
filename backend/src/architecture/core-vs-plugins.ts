// ============================================================================
// Edge-Cloud Orchestrator: Core Architecture Redesign
// ============================================================================
// 
// This document defines the separation between core orchestration functionality
// and optional plugin modules.
// ============================================================================

/**
 * ============================================================================
 * EXECUTIVE SUMMARY
 * ============================================================================
 * 
 * CURRENT STATE: Monolithic architecture with 15+ models, 12 route files,
 * 11 services - many are advanced features not needed for core orchestration.
 * 
 * PROPOSED STATE: Focused core with plugin architecture for extensions.
 * 
 * CORE LOOP:
 *   Task Submission → Scheduling → Edge Execution → Monitoring
 * 
 * REDUCTION: 15 models → 7 core models, 12 routes → 5 core routes
 */

// ============================================================================
// MODULE CLASSIFICATION
// ============================================================================

/**
 * TIER 1: CORE (Required for basic operation)
 * ============================================
 * These modules are essential for the orchestration loop and cannot be removed.
 */

export const CORE_MODULES = {
  // --------------------------------------------------------------------------
  // Core Data Models
  // --------------------------------------------------------------------------
  models: {
    User: {
      reason: 'Authentication and authorization',
      required: true,
    },
    Session: {
      reason: 'User session management',
      required: true,
    },
    ApiKey: {
      reason: 'Service-to-service authentication',
      required: true,
    },
    EdgeNode: {
      reason: 'Execution targets - fundamental to orchestration',
      required: true,
    },
    NodeMetric: {
      reason: 'Health monitoring and scheduling decisions',
      required: true,
    },
    Task: {
      reason: 'Core entity being orchestrated',
      required: true,
    },
    TaskExecution: {
      reason: 'Execution history and retry tracking',
      required: true,
    },
    TaskLog: {
      reason: 'Debugging and audit trail',
      required: true,
    },
  },

  // --------------------------------------------------------------------------
  // Core Services
  // --------------------------------------------------------------------------
  services: {
    TaskScheduler: {
      reason: 'Core scheduling logic',
      required: true,
      file: 'task-scheduler.ts',
    },
    HeartbeatMonitor: {
      reason: 'Node health tracking',
      required: true,
      file: 'heartbeat-monitor.ts',
    },
    WebSocketManager: {
      reason: 'Real-time updates',
      required: true,
      file: 'websocket-manager.ts',
    },
  },

  // --------------------------------------------------------------------------
  // Core Routes
  // --------------------------------------------------------------------------
  routes: {
    auth: {
      reason: 'Authentication endpoints',
      required: true,
      endpoints: ['POST /login', 'POST /logout', 'POST /refresh'],
    },
    tasks: {
      reason: 'Task lifecycle management',
      required: true,
      endpoints: ['GET', 'POST', 'GET/:id', 'POST/:id/cancel', 'POST/:id/retry'],
    },
    nodes: {
      reason: 'Node registration and management',
      required: true,
      endpoints: ['GET', 'POST', 'GET/:id', 'DELETE/:id'],
    },
    webhooks: {
      reason: 'Event notifications for external systems',
      required: true,
      endpoints: ['GET', 'POST', 'DELETE/:id'],
    },
  },
}

/**
 * TIER 2: SECURITY (Recommended for production)
 * ==============================================
 * Strongly recommended but can be disabled for development/testing.
 */

export const SECURITY_MODULES = {
  models: {
    CertificateAuthority: {
      reason: 'mTLS root CA for edge agents',
      required: false,
      plugin: 'mtls-auth',
    },
    BootstrapToken: {
      reason: 'Secure node registration',
      required: false,
      plugin: 'mtls-auth',
    },
    CertificateRevocation: {
      reason: 'CRL for compromised certificates',
      required: false,
      plugin: 'mtls-auth',
    },
    NodeCertificate: {
      reason: 'Node certificate tracking',
      required: false,
      plugin: 'mtls-auth',
    },
  },

  services: {
    CertificateManager: {
      reason: 'Certificate lifecycle management',
      required: false,
      file: 'certificate-manager.ts',
      plugin: 'mtls-auth',
    },
    MTLSAuthentication: {
      reason: 'mTLS handshake and validation',
      required: false,
      file: 'mtls-authentication.ts',
      plugin: 'mtls-auth',
    },
  },

  routes: {
    admin: {
      reason: 'User and system administration',
      required: false,
      plugin: 'admin-panel',
    },
  },
}

/**
 * TIER 3: OPTIONAL PLUGINS (Feature-specific)
 * ============================================
 * These are advanced features that should be loaded as plugins.
 */

export const PLUGIN_MODULES = {
  // --------------------------------------------------------------------------
  // Cost Optimization Plugin
  // --------------------------------------------------------------------------
  costOptimization: {
    name: 'cost-optimization',
    description: 'Cost-aware scheduling and spend tracking',
    models: ['NodePricing', 'TaskCostEstimate', 'CostHistory'],
    services: ['cost-optimizer.ts'],
    routes: ['cost.ts'],
    dependencies: [],
    loadOrder: 10,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable cost optimization features',
      },
      pricingUpdateInterval: {
        type: 'number',
        default: 3600000, // 1 hour
        description: 'How often to refresh pricing data',
      },
    },
  },

  // --------------------------------------------------------------------------
  // Federated Learning Plugin
  // --------------------------------------------------------------------------
  federatedLearning: {
    name: 'federated-learning',
    description: 'Distributed ML model training across edge nodes',
    models: ['FLModel', 'FLSession', 'FLRound', 'FLClientUpdate'],
    services: ['fl-coordinator.ts'],
    routes: ['federated-learning.ts'],
    dependencies: [],
    loadOrder: 20,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable federated learning features',
      },
      minClients: {
        type: 'number',
        default: 3,
        description: 'Minimum clients per round',
      },
    },
  },

  // --------------------------------------------------------------------------
  // Carbon Tracking Plugin
  // --------------------------------------------------------------------------
  carbonTracking: {
    name: 'carbon-tracking',
    description: 'Carbon emissions tracking for compute workloads',
    models: ['CarbonIntensity', 'CarbonEmission'],
    services: ['carbon-tracker.ts'],
    routes: ['carbon.ts'],
    dependencies: ['cost-optimization'],
    loadOrder: 15,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable carbon tracking',
      },
      dataProvider: {
        type: 'string',
        default: 'electricity-maps',
        description: 'Carbon intensity data provider',
      },
    },
  },

  // --------------------------------------------------------------------------
  // Workflow Orchestration Plugin
  // --------------------------------------------------------------------------
  workflowOrchestration: {
    name: 'workflow-orchestration',
    description: 'Multi-task workflow definitions and execution',
    models: ['Workflow', 'WorkflowExecution', 'WorkflowNode', 'WorkflowEdge'],
    services: ['workflow-engine.ts'],
    routes: ['workflows.ts'],
    dependencies: [],
    loadOrder: 5,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable workflow orchestration',
      },
      maxConcurrentWorkflows: {
        type: 'number',
        default: 100,
        description: 'Maximum concurrent workflow executions',
      },
    },
  },

  // --------------------------------------------------------------------------
  // Compliance Manager Plugin
  // --------------------------------------------------------------------------
  complianceManager: {
    name: 'compliance-manager',
    description: 'SOC2/ISO27001/GDPR compliance helpers',
    models: ['DataRetentionPolicy', 'AuditExport'],
    services: ['compliance-manager.ts'],
    routes: [],
    dependencies: [],
    loadOrder: 30,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable compliance features',
      },
      auditLogRetentionDays: {
        type: 'number',
        default: 90,
        description: 'Days to retain audit logs',
      },
    },
  },

  // --------------------------------------------------------------------------
  // SLA Monitoring Plugin
  // --------------------------------------------------------------------------
  slaMonitoring: {
    name: 'sla-monitoring',
    description: 'SLA breach detection and alerting',
    models: ['SLADefinition', 'SLABreach'],
    services: ['sla-monitor.ts'],
    routes: [],
    dependencies: [],
    loadOrder: 25,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable SLA monitoring',
      },
      checkInterval: {
        type: 'number',
        default: 60000,
        description: 'SLA check interval in ms',
      },
    },
  },

  // --------------------------------------------------------------------------
  // Kubernetes Integration Plugin
  // --------------------------------------------------------------------------
  kubernetesIntegration: {
    name: 'kubernetes-integration',
    description: 'Deploy orchestrator on Kubernetes with CRDs',
    models: [],
    services: ['kubernetes-operator.ts'],
    routes: [],
    dependencies: [],
    loadOrder: 100,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable Kubernetes operator mode',
      },
      namespace: {
        type: 'string',
        default: 'edge-orchestrator',
        description: 'Kubernetes namespace',
      },
    },
  },

  // --------------------------------------------------------------------------
  // Backup Manager Plugin
  // --------------------------------------------------------------------------
  backupManager: {
    name: 'backup-manager',
    description: 'Automated backup and restore',
    models: ['BackupRecord'],
    services: ['backup-manager.ts'],
    routes: [],
    dependencies: [],
    loadOrder: 50,
    config: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable automated backups',
      },
      schedule: {
        type: 'string',
        default: '0 2 * * *',
        description: 'Cron schedule for backups',
      },
      retentionDays: {
        type: 'number',
        default: 30,
        description: 'Backup retention period',
      },
    },
  },
}

// ============================================================================
// CORE ARCHITECTURE DIAGRAM
// ============================================================================

/**
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           CONTROL PLANE (Core)                          │
 * │                                                                         │
 * │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
 * │  │   API Layer  │───►│   Scheduler  │───►│   Registry   │              │
 * │  │              │    │              │    │              │              │
 * │  │ • Auth       │    │ • Queue      │    │ • Nodes      │              │
 * │  │ • Tasks CRUD │    │ • Policies   │    │ • Health     │              │
 * │  │ • Webhooks   │    │ • Assignment │    │ • Metrics    │              │
 * │  └──────────────┘    └──────────────┘    └──────────────┘              │
 * │         │                   │                   │                      │
 * │         └───────────────────┴───────────────────┘                      │
 * │                             │                                          │
 * │                    ┌────────▼────────┐                                 │
 * │                    │    Database     │                                 │
 * │                    │   (PostgreSQL)  │                                 │
 * │                    └─────────────────┘                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                              │
 *                              │ WebSocket / gRPC
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                            DATA PLANE (Core)                            │
 * │                                                                         │
 * │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
 * │  │  Edge Agent  │    │  Edge Agent  │    │  Edge Agent  │              │
 * │  │   (Node 1)   │    │   (Node 2)   │    │   (Node N)   │              │
 * │  │              │    │              │    │              │              │
 * │  │ • Heartbeat  │    │ • Heartbeat  │    │ • Heartbeat  │              │
 * │  │ • Execute    │    │ • Execute    │    │ • Execute    │              │
 * │  │ • Report     │    │ • Report     │    │ • Report     │              │
 * │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │
 * │         │                   │                   │                      │
 * │         ▼                   ▼                   ▼                      │
 * │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
 * │  │   Docker     │    │   Docker     │    │   Docker     │              │
 * │  │ Containers   │    │ Containers   │    │ Containers   │              │
 * │  └──────────────┘    └──────────────┘    └──────────────┘              │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 */

// ============================================================================
// PLUGIN ARCHITECTURE
// ============================================================================

/**
 * Plugin Interface Definition
 */
export interface OrchestratorPlugin {
  // Metadata
  name: string
  version: string
  description: string
  
  // Dependencies
  dependencies: string[]
  loadOrder: number
  
  // Lifecycle hooks
  onLoad?: (context: PluginContext) => Promise<void>
  onEnable?: () => Promise<void>
  onDisable?: () => Promise<void>
  onUnload?: () => Promise<void>
  
  // Extensions
  models?: PluginModel[]
  services?: PluginService[]
  routes?: PluginRoute[]
  middleware?: PluginMiddleware[]
  
  // Configuration schema
  configSchema: Record<string, PluginConfigOption>
}

export interface PluginContext {
  fastify: import('fastify').FastifyInstance
  prisma: import('@prisma/client').PrismaClient
  redis: import('ioredis').Redis
  config: Record<string, unknown>
  logger: import('pino').Logger
}

export interface PluginModel {
  name: string
  schema: string // Prisma schema snippet
  relations: string[] // Related models
}

export interface PluginService {
  name: string
  factory: (context: PluginContext) => unknown
}

export interface PluginRoute {
  prefix: string
  factory: (context: PluginContext) => Promise<void>
}

export interface PluginMiddleware {
  name: string
  hook: 'onRequest' | 'preHandler' | 'onResponse'
  handler: (context: PluginContext) => Promise<void>
}

export interface PluginConfigOption {
  type: 'boolean' | 'string' | 'number' | 'array'
  default: unknown
  description: string
  required?: boolean
  env?: string // Environment variable name
}

// ============================================================================
// PLUGIN LOADER IMPLEMENTATION
// ============================================================================

/**
 * Core Plugin Manager
 * 
 * Handles loading, enabling, disabling, and unloading of plugins.
 */
export class PluginManager {
  private plugins: Map<string, OrchestratorPlugin> = new Map()
  private enabledPlugins: Set<string> = new Set()
  private context: PluginContext
  
  constructor(context: PluginContext) {
    this.context = context
  }
  
  /**
   * Register a plugin
   */
  async register(plugin: OrchestratorPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already registered`)
    }
    
    // Check dependencies
    for (const dep of plugin.dependencies) {
      if (!this.plugins.has(dep)) {
        throw new Error(`Plugin ${plugin.name} requires ${dep} which is not registered`)
      }
    }
    
    this.plugins.set(plugin.name, plugin)
    
    // Call onLoad hook
    if (plugin.onLoad) {
      await plugin.onLoad(this.context)
    }
  }
  
  /**
   * Enable a registered plugin
   */
  async enable(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} is not registered`)
    }
    
    // Check dependencies are enabled
    for (const dep of plugin.dependencies) {
      if (!this.enabledPlugins.has(dep)) {
        throw new Error(`Plugin ${pluginName} requires ${dep} to be enabled first`)
      }
    }
    
    // Register routes
    if (plugin.routes) {
      for (const route of plugin.routes) {
        await route.factory(this.context)
      }
    }
    
    // Register services
    if (plugin.services) {
      for (const service of plugin.services) {
        const instance = service.factory(this.context)
        this.context.fastify.decorate(service.name, instance)
      }
    }
    
    // Call onEnable hook
    if (plugin.onEnable) {
      await plugin.onEnable()
    }
    
    this.enabledPlugins.add(pluginName)
    this.context.logger.info({ plugin: pluginName }, 'Plugin enabled')
  }
  
  /**
   * Disable an enabled plugin
   */
  async disable(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} is not registered`)
    }
    
    if (!this.enabledPlugins.has(pluginName)) {
      return // Already disabled
    }
    
    // Check if other plugins depend on this one
    for (const [name, p] of this.plugins) {
      if (p.dependencies.includes(pluginName) && this.enabledPlugins.has(name)) {
        throw new Error(`Cannot disable ${pluginName}: ${name} depends on it`)
      }
    }
    
    // Call onDisable hook
    if (plugin.onDisable) {
      await plugin.onDisable()
    }
    
    this.enabledPlugins.delete(pluginName)
    this.context.logger.info({ plugin: pluginName }, 'Plugin disabled')
  }
  
  /**
   * Load plugins from configuration
   */
  async loadFromConfig(config: Record<string, Record<string, unknown>>): Promise<void> {
    // Sort by load order
    const sortedPlugins = Array.from(this.plugins.values())
      .sort((a, b) => a.loadOrder - b.loadOrder)
    
    for (const plugin of sortedPlugins) {
      const pluginConfig = config[plugin.name]
      if (pluginConfig?.enabled === true) {
        await this.enable(plugin.name)
      }
    }
  }
  
  /**
   * Get list of enabled plugins
   */
  getEnabledPlugins(): string[] {
    return Array.from(this.enabledPlugins)
  }
  
  /**
   * Check if a plugin is enabled
   */
  isEnabled(pluginName: string): boolean {
    return this.enabledPlugins.has(pluginName)
  }
}

// ============================================================================
// CONFIGURATION EXAMPLE
// ============================================================================

/**
 * Example configuration for plugin loading
 */
export const examplePluginConfig = {
  // Core always loaded, no config needed
  
  // Security plugins (recommended)
  'mtls-auth': {
    enabled: true,
    certificateValidityDays: 90,
  },
  
  // Optional plugins
  'cost-optimization': {
    enabled: true,
    pricingUpdateInterval: 3600000,
  },
  
  'federated-learning': {
    enabled: false, // Not needed for basic orchestration
  },
  
  'carbon-tracking': {
    enabled: false,
    dataProvider: 'electricity-maps',
  },
  
  'workflow-orchestration': {
    enabled: true, // Useful for complex pipelines
    maxConcurrentWorkflows: 100,
  },
  
  'compliance-manager': {
    enabled: false, // Only for regulated industries
    auditLogRetentionDays: 90,
  },
  
  'sla-monitoring': {
    enabled: false,
    checkInterval: 60000,
  },
  
  'kubernetes-integration': {
    enabled: false, // Only for K8s deployments
  },
  
  'backup-manager': {
    enabled: true,
    schedule: '0 2 * * *',
    retentionDays: 30,
  },
}

// ============================================================================
// MIGRATION GUIDE
// ============================================================================

/**
 * ## Migration Steps
 * 
 * ### Phase 1: Isolate Core (Week 1)
 * 1. Move core models to `prisma/schema/core.prisma`
 * 2. Move core services to `services/core/`
 * 3. Move core routes to `routes/core/`
 * 
 * ### Phase 2: Extract Plugins (Week 2)
 * 1. Create `plugins/` directory
 * 2. Move each plugin module to its own directory:
 *    - `plugins/cost-optimization/`
 *    - `plugins/federated-learning/`
 *    - `plugins/carbon-tracking/`
 *    - etc.
 * 3. Each plugin gets:
 *    - `index.ts` (exports OrchestratorPlugin)
 *    - `models.prisma` (plugin-specific models)
 *    - `routes.ts` (plugin routes)
 *    - `services/` (plugin services)
 * 
 * ### Phase 3: Plugin Loader (Week 3)
 * 1. Implement PluginManager
 * 2. Add plugin configuration to `config/plugins.yaml`
 * 3. Update main entry point to load plugins
 * 
 * ### Phase 4: Testing (Week 4)
 * 1. Test core without any plugins
 * 2. Test each plugin individually
 * 3. Test plugin combinations
 * 4. Performance benchmarks
 */

// ============================================================================
// REDUCED SCHEMA (Core Only)
// ============================================================================

export const CORE_PRISMA_SCHEMA = `
// Core Schema - 7 models

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  passwordHash  String
  name          String
  role          Role      @default(VIEWER)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  sessions      Session[]
  apiKeys       ApiKey[]
  
  @@map("users")
}

model Session {
  id           String   @id @default(uuid())
  userId       String
  token        String   @unique
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@map("sessions")
}

model ApiKey {
  id          String   @id @default(uuid())
  userId      String
  name        String
  key         String   @unique
  createdAt   DateTime @default(now())
  lastUsedAt  DateTime?
  
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@map("api_keys")
}

model EdgeNode {
  id                String   @id @default(uuid())
  name              String   @unique
  region            String
  ipAddress         String
  port              Int
  status            NodeStatus @default(OFFLINE)
  cpuCores          Int
  memoryGB          Int
  maxTasks          Int      @default(10)
  isMaintenanceMode Boolean  @default(false)
  lastHeartbeat     DateTime?
  createdAt         DateTime  @default(now())
  
  tasks             Task[]
  metrics           NodeMetric[]
  
  @@map("edge_nodes")
}

model NodeMetric {
  id           String   @id @default(uuid())
  nodeId       String
  timestamp    DateTime @default(now())
  cpuUsage     Float
  memoryUsage  Float
  tasksRunning Int
  
  node         EdgeNode @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  
  @@index([nodeId, timestamp])
  @@map("node_metrics")
}

model Task {
  id           String     @id @default(uuid())
  name         String
  type         String
  status       String     @default("PENDING")
  priority     String     @default("MEDIUM")
  nodeId       String?
  input        Json
  output       Json?
  maxRetries   Int        @default(3)
  submittedAt  DateTime   @default(now())
  startedAt    DateTime?
  completedAt  DateTime?
  
  node         EdgeNode?  @relation(fields: [nodeId], references: [id])
  executions   TaskExecution[]
  logs         TaskLog[]
  
  @@index([status])
  @@map("tasks")
}

model TaskExecution {
  id           String   @id @default(uuid())
  taskId       String
  attemptNumber Int    @default(1)
  nodeId       String?
  status       String  @default("PENDING")
  exitCode     Int?
  scheduledAt  DateTime @default(now())
  startedAt    DateTime?
  completedAt  DateTime?
  durationMs   Int?
  error        String?
  
  task         Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  
  @@index([taskId])
  @@map("task_executions")
}

model TaskLog {
  id        String   @id @default(uuid())
  taskId    String
  timestamp DateTime @default(now())
  level     String
  source    String
  message   String
  
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  
  @@index([taskId, timestamp])
  @@map("task_logs")
}
`
