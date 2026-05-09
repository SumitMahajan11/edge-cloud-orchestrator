/**
 * Service Initializer Module
 *
 * Safely initializes advanced services without breaking existing functionality.
 * All services are lazily loaded to avoid TypeScript compilation issues.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import type { Logger } from 'pino';

import { env } from '../config/env';

// Service instances
let autoHealer: any = null;
let healthMonitor: any = null;
let slaMonitor: any = null;
let costOptimizer: any = null;
let sagaOrchestrator: any = null;
let k8sOperator: any = null;
let modelStorage: any = null;
let workflowEngine: any = null;


/**
 * Initialize all advanced services
 */
export async function initializeServices(
  app: FastifyInstance,
  prisma: PrismaClient,
  redis: Redis,
  logger: Logger,
  idempotencyService?: any,
) {
  logger.info('Initializing advanced services...');

  // 0. Alerting Service - Basic alerting (log-based + optional webhook)
  try {
    const { initializeAlerting } =
      await import('../services/alerting-service.js');

    const alertWebhookUrl = env.ALERT_WEBHOOK_URL;
    const alertThrottleMs = env.ALERT_THROTTLE_MS;

    const alerting = initializeAlerting(logger, {
      logAlerts: true,
      webhookUrl: alertWebhookUrl,
      throttleMs: alertThrottleMs,
    });
    app.decorate('alerting', alerting);
    logger.info('✅ Alerting Service initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Alerting Service not initialized');
  }

  // 1. Auto-Healer - Automatic node recovery
  try {
    const { AutoHealer } = await import('../services/auto-healer.js');
    autoHealer = new AutoHealer(prisma, redis, logger);
    await autoHealer.start();
    app.decorate('autoHealer', autoHealer);
    logger.info('✅ Auto-Healer initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Auto-Healer not initialized');
  }

  // 2. Health Monitor - Comprehensive health checks
  try {
    const { HealthMonitor } = await import('../services/health-monitor.js');
    healthMonitor = new HealthMonitor(prisma, redis, logger);
    healthMonitor.start();
    app.decorate('healthMonitor', healthMonitor);
    logger.info('✅ Health Monitor initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Health Monitor not initialized');
  }

  // 3. SLA Monitor - Service level tracking
  try {
    const { SLAMonitor } = await import('../services/sla-monitor.js');
    slaMonitor = new SLAMonitor(prisma, redis);
    app.decorate('slaMonitor', slaMonitor);
    logger.info('✅ SLA Monitor initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ SLA Monitor not initialized');
  }

  // 4. Cost Optimizer - Cost-aware scheduling
  try {
    const { CostOptimizer } = await import('../services/cost-optimizer.js');
    costOptimizer = new CostOptimizer();
    app.decorate('costOptimizer', costOptimizer);
    logger.info('✅ Cost Optimizer initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Cost Optimizer not initialized');
  }

  // 5. Saga Orchestrator - Distributed transactions
  try {
    const { SagaOrchestrator } = await import('@edgecloud/saga');
    const { createTaskLifecycleSaga } =
      await import('../sagas/task-lifecycle-saga.js');

    sagaOrchestrator = new SagaOrchestrator(prisma, {}, redis);

    // Register task lifecycle saga
    const scheduler = (app as any).taskScheduler;
    const taskSaga = createTaskLifecycleSaga(
      prisma, 
      logger, 
      idempotencyService,
      redis,
      scheduler ? (taskId, durationMs, status) => scheduler.recordTaskOutcome(taskId, durationMs, status) : undefined
    );
    sagaOrchestrator.registerSaga(taskSaga);

    // Start saga recovery
    sagaOrchestrator.startRecovery();

    app.decorate('sagaOrchestrator', sagaOrchestrator);
    logger.info('✅ Saga Orchestrator initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Saga Orchestrator not initialized');
  }

  // 6. Kubernetes Operator - K8s integration (only if KUBECONFIG exists)
  const kubeconfig = env.KUBECONFIG;
  if (kubeconfig) {
    try {
      const { EdgeCloudOperator } =
        await import('../services/kubernetes-operator.js');
      k8sOperator = new EdgeCloudOperator('edge-cloud-orchestrator');
      app.decorate('k8sOperator', k8sOperator);
      logger.info('✅ Kubernetes Operator initialized');
    } catch (error: any) {
      logger.warn(
        { err: error.message },
        '⚠️ Kubernetes Operator not initialized',
      );
    }
  }

  // 7. Model Storage Service - S3/GCS weights storage
  try {
    const { ModelStorageService } = await import('@edgecloud/ml-scheduler');
    modelStorage = new ModelStorageService();
    app.decorate('modelStorage', modelStorage);
    logger.info('✅ Model Storage Service initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Model Storage Service not initialized');
  }

  // 8. Cold Start Handler - Hybrid scheduling for new nodes
  try {
    const { ColdStartHandler } = await import('../services/cold-start-handler.js');
    const coldStartHandler = new ColdStartHandler(redis, prisma, logger);
    app.decorate('coldStartHandler', coldStartHandler);
    
    const scheduler = (app as any).taskScheduler;
    if (scheduler && typeof scheduler.setColdStartHandler === 'function') {
      scheduler.setColdStartHandler(coldStartHandler);
      logger.info('✅ Cold Start Handler integrated with TaskScheduler');
    }
    
    logger.info('✅ Cold Start Handler initialized');
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Cold Start Handler not initialized');
  }

  // 9. Workflow Engine - DAG-based task orchestration
  try {
    const { WorkflowEngine } = await import('../services/workflow-engine.js');
    const scheduler = (app as any).taskScheduler;
    const wsManager = (app as any).wsManager;

    if (scheduler && wsManager) {
      workflowEngine = new WorkflowEngine(prisma, logger, scheduler, wsManager);
      app.decorate('workflowEngine', workflowEngine);
      logger.info('✅ Workflow Engine initialized');
    } else {
      logger.warn('⚠️ Workflow Engine requires TaskScheduler and WebSocketManager');
    }
  } catch (error: any) {
    logger.warn({ err: error.message }, '⚠️ Workflow Engine not initialized');
  }

  logger.info('Service initialization complete');
}

/**
 * Get status of all services
 */
export function getServiceStatus() {
  return {
    autoHealer: autoHealer !== null,
    healthMonitor: healthMonitor !== null,
    slaMonitor: slaMonitor !== null,
    costOptimizer: costOptimizer !== null,
    sagaOrchestrator: sagaOrchestrator !== null,
    kubernetesOperator: k8sOperator !== null,
    modelStorage: modelStorage !== null,
  };
}

/**
 * Graceful shutdown of services
 */
export async function shutdownServices(logger: Logger) {
  logger.info('Shutting down services...');

  if (autoHealer) {
    try {
      await autoHealer.stop();
    } catch (e) {}
  }
  if (healthMonitor) {
    try {
      healthMonitor.stop();
    } catch (e) {}
  }
  if (sagaOrchestrator) {
    try {
      sagaOrchestrator.stopRecovery();
    } catch (e) {}
  }

  logger.info('Services shutdown complete');
}
