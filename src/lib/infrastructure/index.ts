// Infrastructure module exports

// Database
export { PostgresAdapter, SQLiteAdapter, DatabaseManager, databaseManager } from './database-adapters'

// Cache
export { RedisAdapter, MemoryCacheAdapter, CacheManager, cacheManager } from './cache-adapters'

// Metrics
export { MetricsRegistry, metricsRegistry } from './metrics'

// Health Check
export { HealthCheckManager, healthCheckManager } from './health-check'

// Lifecycle
export { LifecycleManager, RequestContextManager, lifecycleManager, requestContext } from './lifecycle'

// Tracing
export { Tracer, CorrelationManager, RequestTimer, tracer, correlationManager } from './tracing'

// Types
export type { DatabaseAdapter, PostgresConfig, QueryResult } from './database-adapters'
export type { CacheAdapter, RedisConfig } from './cache-adapters'
export type { MetricValue, Counter, Gauge, Histogram, MetricType } from './metrics'
export type { HealthStatus, HealthCheckResult, SystemHealth, HealthCheckConfig } from './health-check'
export type { ShutdownHandler, LifecycleConfig, LifecycleState, RequestContext } from './lifecycle'
export type { TraceContext, Span, SpanLog, Trace } from './tracing'
