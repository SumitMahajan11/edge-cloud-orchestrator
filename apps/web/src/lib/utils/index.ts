/**
 * Library Utilities Index
 * Provides a unified entry point for all utility modules
 */

// Core Utilities
export * from './utils'
export * from './logger'

// Type Transformations
export * from './typeTransformers'

// Security & Compliance
export { SecurityHeadersManager, securityHeaders } from './headers'
export { SecretManager, secretManager } from './secrets'
export { IntrusionDetectionSystem, intrusionDetection } from './intrusion-detection'
export { SandboxManager, sandboxManager, networkIsolation } from './SandboxManager'

// Infrastructure & Docker
export { DockerClient, dockerClient } from './docker'

// Observability & Metrics
export { JaegerTracer, jaegerTracer } from './jaeger'
export { PrometheusMetrics, orchestratorMetrics as prometheusMetrics } from './prometheus'
export { 
  MetricsRegistry, metricsRegistry,
  MetricsCollector, metricsCollector,
  AlertManager, alertManager,
  MetricsExporter, metricsExporter,
  createMetricsRegistry, createMetricsCollector,
  createAlertManager, createMetricsExporter
} from './exporter'
export { CarbonTracker, carbonTracker, createCarbonTracker } from './CarbonTracker'

// Reliability & Performance
export { RetryCircuitBreaker, RetryManager, retryManager } from './retry'
export { RateLimiter, rateLimiter } from './rate-limiter'
export { RequestDeduplicator as Deduplicator, requestDeduplicator as deduplicator } from './deduplication'
export { Benchmark, benchmark } from './benchmark'
export { 
  CircuitBreaker, 
  CircuitBreakerOpenError, 
  CircuitBreakerRegistry, 
  circuitBreakerRegistry 
} from './circuit-breaker'
export { FailureRecoveryManager, failureRecoveryManager, createFailureRecoveryManager } from './FailureRecoveryManager'

// Database & Persistence
export { Database, db } from './database'
export { EventStore, eventStore, EventTypes, EventBuilder, createEventStore, event } from './EventStore'

// Distributed Coordination & Consensus
export { RaftConsensus, createRaftCluster } from './RaftConsensus'
export { MultiClusterFederation, multiClusterFederation, createMultiClusterFederation } from './MultiClusterFederation'
export { ControlPlaneManager, controlPlane, createControlPlane } from './ControlPlaneManager'

// Advanced Scheduling & Optimization
export { DistributedScheduler, distributedScheduler, createDistributedScheduler } from './DistributedScheduler'
export { CapacityPlanner, capacityPlanner, createCapacityPlanner } from './CapacityPlanner'
export { CostOptimizationEngine, costOptimizationEngine, createCostOptimizationEngine } from './CostOptimizationEngine'
export { ResourceReservationManager, resourceReservationManager, createResourceReservationManager } from './ResourceReservationManager'
export { BlueGreenDeploymentManager, blueGreenDeploymentManager, createBlueGreenDeploymentManager } from './BlueGreenDeploymentManager'

// AI & ML Support
export { AIAnomalyDetector, aiAnomalyDetector, createAIAnomalyDetector } from './AIAnomalyDetector'
export { FederatedLearningCoordinator, federatedLearningCoordinator, createFederatedLearningCoordinator } from './FederatedLearningCoordinator'
export { EdgeFunctionMarketplace, edgeFunctionMarketplace as marketplace, createEdgeFunctionMarketplace as createMarketplace } from './EdgeFunctionMarketplace'

// Simulation & Validation
export * from './simulation'
export { 
  SchemaValidator, schemaValidator, 
  InputSanitizer, InputValidator,
  NodeRegistrationSchema, TaskSubmissionSchema, WebhookConfigSchema 
} from './validation'

// Networking
export { GeoRouter, geoRouter, createGeoRouter } from './geoRouter'
