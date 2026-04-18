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
import { SecretManager } from '@edgecloud/shared-kernel';

// Service instances
let autoHealer: any = null;
let healthMonitor: any = null;
let slaMonitor: any = null;
let costOptimizer: any = null;
let sagaOrchestrator: any = null;
let k8sOperator: any = null;

/**
 * Initialize all advanced services
 */
export async function initializeServices(
  app: FastifyInstance,
  prisma: PrismaClient,
  redis: Redis,
  logger: Logger,
  secretManager: SecretManager,
) {
  logger.info('Initializing advanced services...');

  // 0. Alerting Service - Basic alerting (log-based + optional webhook)
  try {
    const { initializeAlerting } =
      await import('../services/alerting-service.js');

    const alertWebhookUrl = await secretManager.getSecret('ALERT_WEBHOOK_URL');
    const alertThrottleMs = parseInt(
      (await secretManager.getSecret('ALERT_THROTTLE_MS')) || '60000',
      10,
    );

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
    autoHealer.start();
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

    sagaOrchestrator = new SagaOrchestrator(prisma);

    // Register task lifecycle saga
    const scheduler = (app as any).taskScheduler;
    const taskSaga = createTaskLifecycleSaga(
      prisma, 
      logger, 
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
  const kubeconfig = await secretManager.getSecret('KUBECONFIG');
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
  };
}

/**
 * Graceful shutdown of services
 */
export async function shutdownServices(logger: Logger) {
  logger.info('Shutting down services...');

  if (autoHealer) {
    try {
      autoHealer.stop();
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
