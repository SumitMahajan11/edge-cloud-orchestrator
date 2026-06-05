// Infrastructure module exports

// Database
export {
  DatabaseManager,
  databaseManager,
  PostgresAdapter,
  SQLiteAdapter,
} from "./database-adapters";

// Cache
export {
  CacheManager,
  cacheManager,
  MemoryCacheAdapter,
  RedisAdapter,
} from "./cache-adapters";

// Metrics
export { MetricsRegistry, metricsRegistry } from "./metrics";

// Health Check
export { HealthCheckManager, healthCheckManager } from "./health-check";

// Lifecycle
export {
  LifecycleManager,
  lifecycleManager,
  requestContext,
  RequestContextManager,
} from "./lifecycle";

// Tracing
export {
  CorrelationManager,
  correlationManager,
  RequestTimer,
  Tracer,
  tracer,
} from "./tracing";

// Types
export type { CacheAdapter, RedisConfig } from "./cache-adapters";
export type {
  DatabaseAdapter,
  PostgresConfig,
  QueryResult,
} from "./database-adapters";
export type {
  HealthCheckConfig,
  HealthCheckResult,
  HealthStatus,
  SystemHealth,
} from "./health-check";
export type {
  LifecycleConfig,
  LifecycleState,
  RequestContext,
  ShutdownHandler,
} from "./lifecycle";
export type {
  Counter,
  Gauge,
  Histogram,
  MetricType,
  MetricValue,
} from "./metrics";
export type { Span, SpanLog, Trace, TraceContext } from "./tracing";
