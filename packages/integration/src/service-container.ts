import { EventEmitter } from 'eventemitter3';
import { EventBus } from '@edgecloud/event-bus';
import { VaultClient, ABACEngine, MTLSManager, PolicyBuilder, DEFAULT_POLICIES } from '@edgecloud/security';
import { MetricsCollector, TracingManager } from '@edgecloud/observability';
import { ChaosEngine } from '@edgecloud/chaos';
import { StreamProcessor, RealTimeAnalytics, PredictiveAnalytics } from '@edgecloud/analytics';
import { DistributedCache, PooledDatabase, DistributedRateLimiter } from '@edgecloud/performance';
import { ResourceReservationManager, GangScheduler } from '@edgecloud/scheduler';
import { CircuitBreaker, CircuitBreakerRegistry, RetryPolicy, CheckpointManager, type RetryConfig } from '@edgecloud/circuit-breaker';
import { SandboxRuntimeFactory, type SandboxRuntime, type SandboxConfig } from '@edgecloud/sandbox';
import { ResilientWebSocketClient, type WebSocketClientConfig } from '@edgecloud/websocket-client';
import { MultiObjectiveScorer, SchedulingPredictor } from '@edgecloud/ml-scheduler';
import { RaftNode, type RaftNodeConfig, type StateMachine } from '@edgecloud/raft-consensus';

export interface ServiceConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  
  // Infrastructure endpoints
  kafkaBrokers: string[];
  redisHost: string;
  redisPort: number;
  vaultAddress: string;
  vaultToken?: string;
  vaultRoleId?: string;
  vaultSecretId?: string;
  
  // Database
  databaseHost: string;
  databasePort: number;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  
  // Observability
  jaegerEndpoint?: string;
  prometheusPort?: number;
}

export class ServiceContainer extends EventEmitter {
  private config: ServiceConfig;
  
  // Core infrastructure
  public eventBus: EventBus;
  public cache: DistributedCache;
  public rateLimiter: DistributedRateLimiter;
  public db: PooledDatabase;
  
  // Security
  public vault: VaultClient;
  public abacEngine: ABACEngine;
  public mtlsManager: MTLSManager;
  
  // Observability
  public metrics: MetricsCollector;
  public tracing: TracingManager;
  
  // Chaos engineering
  public chaos: ChaosEngine;
  
  // Analytics
  public streamProcessor: StreamProcessor;
  public realTimeAnalytics: RealTimeAnalytics;
  public predictiveAnalytics: PredictiveAnalytics;
  
  // Advanced scheduling
  public reservationManager: ResourceReservationManager;
  public gangScheduler: GangScheduler;
  public mlScorer: MultiObjectiveScorer;
  public mlPredictor: SchedulingPredictor;
  
  // Fault tolerance
  public circuitBreakerRegistry: CircuitBreakerRegistry;
  public retryPolicy: RetryPolicy;
  public checkpointManager: CheckpointManager;
  
  // Sandbox runtime
  public sandboxRuntime: SandboxRuntime | null = null;
  
  // WebSocket client
  public wsClient: ResilientWebSocketClient | null = null;
  
  private initialized = false;

  constructor(config: ServiceConfig) {
    super();
    this.config = config;

    // Initialize core infrastructure
    this.eventBus = new EventBus({
      clientId: config.serviceName,
      brokers: config.kafkaBrokers,
    });

    this.cache = new DistributedCache({
      host: config.redisHost,
      port: config.redisPort,
    });

    this.rateLimiter = new DistributedRateLimiter({
      host: config.redisHost,
      port: config.redisPort,
    });

    this.db = new PooledDatabase({
      host: config.databaseHost,
      port: config.databasePort,
      database: config.databaseName,
      user: config.databaseUser,
      password: config.databasePassword,
    });

    // Initialize security
    this.vault = new VaultClient({
      address: config.vaultAddress,
      token: config.vaultToken,
      roleId: config.vaultRoleId,
      secretId: config.vaultSecretId,
    });

    // Initialize observability
    this.metrics = new MetricsCollector({
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      collectDefaults: true,
    });

    this.tracing = new TracingManager({
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      environment: config.environment,
      jaegerEndpoint: config.jaegerEndpoint,
    });

    // Initialize chaos engineering
    this.chaos = new ChaosEngine(this.eventBus);

    // Initialize analytics
    this.streamProcessor = new StreamProcessor(this.eventBus);
    this.realTimeAnalytics = new RealTimeAnalytics(this.eventBus);
    this.predictiveAnalytics = new PredictiveAnalytics();

    // Initialize advanced scheduling
    this.reservationManager = new ResourceReservationManager();
    this.gangScheduler = new GangScheduler(this.reservationManager);
    
    // Initialize ML scheduler
    this.mlPredictor = new SchedulingPredictor();
    this.mlScorer = new MultiObjectiveScorer(this.mlPredictor);
    
    // Initialize fault tolerance
    this.circuitBreakerRegistry = new CircuitBreakerRegistry();
    this.retryPolicy = new RetryPolicy({
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
    });
    this.checkpointManager = new CheckpointManager();
    
    // Initialize ABAC engine with default policies
    this.abacEngine = new ABACEngine();
    DEFAULT_POLICIES.forEach((policy: import('@edgecloud/security').Policy) => this.abacEngine.addPolicy(policy));
    
    // Initialize mTLS manager
    this.mtlsManager = new MTLSManager();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.emit('initializing');

    try {
      // Connect to event bus
      await this.eventBus.connect();
      this.emit('eventBusConnected');

      // Authenticate with Vault
      await this.vault.authenticate();
      this.emit('vaultAuthenticated');

      // Initialize tracing
      await this.tracing.initialize();
      this.emit('tracingInitialized');

      // Start analytics
      await this.streamProcessor.start();
      await this.realTimeAnalytics.start();
      this.emit('analyticsStarted');

      // Initialize mTLS
      await this.mtlsManager.initialize();
      this.emit('mtlsInitialized');

      // Initialize sandbox runtime (optional)
      try {
        this.sandboxRuntime = await SandboxRuntimeFactory.createPreferredRuntime({
          runtime: 'firecracker',
          memoryLimit: 512,
          cpuLimit: 100,
          timeout: 300,
          networkEnabled: true,
          diskLimit: 1024,
        });
        this.emit('sandboxInitialized');
      } catch (error) {
        // Sandbox is optional, continue without it
        this.emit('sandboxUnavailable', { error });
      }

      this.initialized = true;
      this.emit('initialized');
    } catch (error) {
      this.emit('initializationError', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.emit('shuttingDown');

    // Disconnect WebSocket client
    if (this.wsClient) {
      this.wsClient.disconnect();
    }

    await this.tracing.shutdown();
    await this.streamProcessor.stop();
    await this.eventBus.disconnect();
    await this.cache.close();
    await this.rateLimiter.close();
    await this.db.close();
    await this.vault.close();

    this.emit('shutdown');
  }

  // Helper method for instrumented database queries
  async queryWithMetrics<T>(
    sql: string,
    params?: any[],
    operation: string = 'query'
  ): Promise<T[]> {
    const startTime = Date.now();
    
    try {
      const result = await this.db.query<T>(sql, params);
      
      this.metrics.recordDbQuery(
        operation,
        this.extractTableName(sql),
        (Date.now() - startTime) / 1000
      );
      
      return result;
    } catch (error) {
      this.metrics.dbConnectionErrors.inc({ error_type: 'query_error' });
      throw error;
    }
  }

  // Helper method for rate-limited operations
  async withRateLimit<T>(
    key: string,
    limit: number,
    windowSeconds: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const allowed = await this.rateLimiter.isAllowed(key, limit, windowSeconds);
    
    if (!allowed) {
      throw new Error('Rate limit exceeded');
    }
    
    return fn();
  }

  // Helper method for cached operations
  async withCache<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.cache.getOrSet(key, fn, ttlSeconds);
  }

  // Helper method for circuit breaker protected operations
  async withCircuitBreaker<T>(
    name: string,
    fn: () => Promise<T>,
    fallback?: () => T
  ): Promise<T> {
    const breaker = this.circuitBreakerRegistry.getOrCreate(name);
    return breaker.execute(fn, fallback);
  }

  // Helper method for retry operations
  async withRetry<T>(
    fn: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const policy = config ? new RetryPolicy(config) : this.retryPolicy;
    return policy.execute(() => fn());
  }

  // Helper method for ABAC authorization
  async checkAccess(request: import('@edgecloud/security').AccessRequest): Promise<import('@edgecloud/security').AccessDecision> {
    return this.abacEngine.evaluate(request);
  }

  // Helper method to connect WebSocket client
  connectWebSocket(url: string, config?: Partial<WebSocketClientConfig>): ResilientWebSocketClient {
    this.wsClient = new ResilientWebSocketClient({
      url,
      ...config,
    });
    this.wsClient.connect();
    return this.wsClient;
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
    details?: Record<string, any>;
  }> {
    const checks: Record<string, boolean> = {
      eventBus: false,
      database: false,
      cache: false,
      vault: false,
      mtls: false,
      sandbox: false,
      websocket: false,
    };

    const details: Record<string, any> = {};

    try {
      // Check database
      await this.db.query('SELECT 1');
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      // Check cache
      await this.cache.set('health-check', 'ok', 10);
      checks.cache = true;
    } catch {
      checks.cache = false;
    }

    try {
      // Check vault
      const vaultHealth = await this.vault.healthCheck();
      checks.vault = vaultHealth.initialized && !vaultHealth.sealed;
    } catch {
      checks.vault = false;
    }

    // Check mTLS
    checks.mtls = this.mtlsManager !== null;

    // Check sandbox
    checks.sandbox = this.sandboxRuntime !== null;
    if (this.sandboxRuntime) {
      try {
        checks.sandbox = await this.sandboxRuntime.isAvailable();
      } catch {
        checks.sandbox = false;
      }
    }

    // Check WebSocket
    checks.websocket = this.wsClient?.isConnected() ?? false;

    // Check circuit breakers
    details.circuitBreakers = this.circuitBreakerRegistry.healthCheck();

    // Determine overall status
    const coreChecks = ['eventBus', 'database', 'cache', 'vault'];
    const coreHealthy = coreChecks.every(k => checks[k]);
    const someHealthy = Object.values(checks).some(v => v);

    const status = coreHealthy ? 'healthy' : someHealthy ? 'degraded' : 'unhealthy';

    return { status, checks, details };
  }

  private extractTableName(sql: string): string {
    const match = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
    return match?.[1] || 'unknown';
  }
}
