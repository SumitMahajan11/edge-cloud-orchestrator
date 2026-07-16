/**
 * Task Lifecycle Saga
 *
 * Orchestrates the complete lifecycle of a task from creation to completion
 * with proper compensation handling for failures.
 *
 * Steps (as requested in v4.0.0 audit):
 * 1. ValidateTask - Check input validity
 * 2. ReserveNodeResources - Reserve node capacity
 * 3. CreateTaskExecutionRecord - Create initial record
 * 4. UpdateTaskStatusScheduled - Mark task as scheduled
 * 5. SendAssignmentToAgent - Dispatch to edge node
 * 6. StartHeartbeatMonitor - Monitor for timeouts
 * 7. CompleteTask - Finalize status
 */

import { SagaDefinition, SagaStepDefinition } from '@edgecloud/saga';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import crypto from 'crypto';
import type { Logger } from 'pino';
import { env } from '../config/env';

import {
  circuitBreakerConfigs,
  withCircuitBreaker,
} from '../utils/circuit-breakers';

// ============================================================================
// Task Saga Context
// ============================================================================

export interface TaskSagaContext {
  taskId: string;
  taskName: string;
  taskType: string;
  priority: string;
  input: Record<string, unknown>;

  // Populated during execution
  nodeId?: string;
  nodeUrl?: string;
  reservationId?: string;
  containerId?: string;
  output?: Record<string, unknown>;
  duration?: number;

  // Timestamps for saga tracking
  validatedAt?: string;
  scheduledAt?: string;
  reservedAt?: string;
  containerCreatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  tenantId?: string;

  // Error tracking
  error?: string;
  errorStack?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const TASK_TIMEOUT = 300000; // 5 minutes
// NODE_TIMEOUT removed as it was unused

// ============================================================================
// Task Lifecycle Saga Definition
// ============================================================================

export function createTaskLifecycleSaga(
  prisma: PrismaClient,
  logger: Logger,
  idempotencyService: any,
  redis: any,
  onOutcome?: (
    taskId: string,
    durationMs: number,
    status: 'COMPLETED' | 'FAILED',
  ) => Promise<void>,
  // kafkaProducer removed as it was unused
): SagaDefinition<TaskSagaContext> {
  // Step 1: Validate Task
  const validateTask: SagaStepDefinition<TaskSagaContext> = {
    name: 'ValidateTask',
    timeout: 5000,
    execute: async (context) => {
      logger.debug({ taskId: context.taskId }, 'Validating task');

      // Check task exists and is in PENDING state
      const task = await prisma.task.findUnique({
        where: { id: context.taskId },
      });

      if (!task) {
        throw new Error(`Task ${context.taskId} not found`);
      }

      if (task.status !== 'PENDING') {
        throw new Error(
          `Task ${context.taskId} is not in PENDING state (current: ${task.status})`,
        );
      }

      // Validate input
      if (!context.taskName || !context.taskType) {
        throw new Error('Task name and type are required');
      }

      logger.info({ taskId: context.taskId }, 'Task validated successfully');
      return { validatedAt: new Date().toISOString() };
    },
    compensate: async (context) => {
      const idempotencyKey = `compensate:ValidateTask:${context.taskId}`;
      const check = await idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'SagaCompensation',
        resourceId: context.taskId,
      });

      if (check.isDuplicate) {
        return;
      }

      logger.debug(
        { taskId: context.taskId },
        'Validation step compensation (no-op)',
      );
      await idempotencyService.complete(idempotencyKey, {
        status: 'completed',
      });
    },
  };

  // Step 2: Reserve Node Resources
  const reserveNodeResources: SagaStepDefinition<TaskSagaContext> = {
    name: 'ReserveNodeResources',
    timeout: 10000,
    execute: async (context) => {
      logger.debug({ taskId: context.taskId }, 'Reserving node resources');

      // Find suitable node
      const nodes = await prisma.edgeNode.findMany({
        where: {
          status: 'ONLINE',
          isMaintenanceMode: false,
          tasksRunning: { lt: 10 },
        },
        orderBy: [{ tasksRunning: 'asc' }, { latency: 'asc' }],
        take: 1,
      });

      if (nodes.length === 0) {
        throw new Error('No available nodes for task execution');
      }

      const node = nodes[0];

      if (!node) {
        throw new Error('Node selection failed');
      }

      await prisma.$transaction(async (tx) => {
        // Reserve the node by incrementing task count
        const updatedNode = await tx.edgeNode.update({
          where: { id: node.id },
          data: { tasksRunning: { increment: 1 } },
        });

        // Check if we didn't exceed capacity
        if (updatedNode.tasksRunning > (updatedNode.maxTasks || 10)) {
          throw new Error('Node capacity exceeded during reservation');
        }

        return { nodeId: node.id, reservedAt: new Date() };
      });

      logger.info(
        { taskId: context.taskId, nodeId: node.id },
        'Resources reserved',
      );

      return {
        nodeId: node.id,
        nodeUrl: node.url,
        reservationId: `res-${context.taskId}-${Date.now()}`,
      };
    },
    compensate: async (context) => {
      const idempotencyKey = `compensate:ReserveNodeResources:${context.taskId}`;
      const check = await idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'SagaCompensation',
        resourceId: context.taskId,
      });

      if (check.isDuplicate) {
        logger.debug(
          { taskId: context.taskId },
          'ReserveNodeResources compensation already executed',
        );
        return;
      }

      if (!context.nodeId) {
        await idempotencyService.complete(idempotencyKey, {
          status: 'skipped_no_node',
        });
        return;
      }

      logger.info(
        { taskId: context.taskId, nodeId: context.nodeId },
        'Releasing resource reservation',
      );

      try {
        // Atomic decrement using updateMany with gt: 0 check to ensure no negative values
        await prisma.edgeNode.updateMany({
          where: {
            id: context.nodeId,
            tasksRunning: { gt: 0 },
          },
          data: {
            tasksRunning: { decrement: 1 },
          },
        });

        await idempotencyService.complete(idempotencyKey, {
          status: 'completed',
        });
      } catch (error) {
        logger.error(
          { taskId: context.taskId, nodeId: context.nodeId, error },
          'Failed to release resource reservation in compensation',
        );
        try {
          await prisma.idempotencyRecord.delete({
            where: { idempotencyKey },
          });
        } catch (cleanupErr) {
          logger.warn(
            { idempotencyKey, cleanupErr },
            'Failed to delete idempotency record on compensation failure',
          );
        }
        throw error;
      }
    },
  };

  // Step 3: Create TaskExecution record
  const createTaskExecutionRecord: SagaStepDefinition<TaskSagaContext> = {
    name: 'CreateTaskExecutionRecord',
    timeout: 5000,
    execute: async (context) => {
      if (!context.nodeId || !context.nodeUrl) {
        throw new Error('Node not assigned for execution record');
      }

      // Create task execution record
      await prisma.taskExecution.create({
        data: {
          taskId: context.taskId,
          nodeId: context.nodeId!,
          nodeUrl: context.nodeUrl!,
          status: 'PENDING',
          scheduledAt: new Date(),
          tenantId: context.tenantId!,
        },
      });

      return { scheduledAt: new Date().toISOString() };
    },
    compensate: async (context) => {
      const idempotencyKey = `compensate:CreateTaskExecutionRecord:${context.taskId}`;
      const check = await idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'SagaCompensation',
        resourceId: context.taskId,
      });

      if (check.isDuplicate) {
        return;
      }

      logger.info(
        { taskId: context.taskId },
        'Cancelling TaskExecution record',
      );

      try {
        // Mark TaskExecution as CANCELLED
        await prisma.taskExecution.updateMany({
          where: {
            taskId: context.taskId,
            status: { in: ['PENDING', 'SCHEDULED', 'RUNNING'] },
          },
          data: { status: 'CANCELLED' },
        });

        await idempotencyService.complete(idempotencyKey, {
          status: 'completed',
        });
      } catch (error) {
        logger.error(
          { taskId: context.taskId, error },
          'Failed to cancel TaskExecution record in compensation',
        );
        try {
          await prisma.idempotencyRecord.delete({
            where: { idempotencyKey },
          });
        } catch (cleanupErr) {
          logger.warn(
            { idempotencyKey, cleanupErr },
            'Failed to delete idempotency record on compensation failure',
          );
        }
        throw error;
      }
    },
  };

  // Step 4: Update task status to SCHEDULED
  const updateTaskStatusScheduled: SagaStepDefinition<TaskSagaContext> = {
    name: 'UpdateTaskStatusScheduled',
    timeout: 5000,
    execute: async (context) => {
      // Update task status to SCHEDULED
      await prisma.task.update({
        where: { id: context.taskId },
        data: {
          nodeId: context.nodeId || null,
          status: 'SCHEDULED',
          reason: `Scheduled on node ${context.nodeId}`,
        },
      });

      // Update execution record status
      await prisma.taskExecution.updateMany({
        where: { taskId: context.taskId, status: 'PENDING' },
        data: { status: 'SCHEDULED' },
      });

      return {};
    },
    compensate: async (context) => {
      const idempotencyKey = `compensate:UpdateTaskStatusScheduled:${context.taskId}`;
      const check = await idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'SagaCompensation',
        resourceId: context.taskId,
      });

      if (check.isDuplicate) {
        return;
      }

      logger.info(
        { taskId: context.taskId },
        'Reverting task status to PENDING',
      );

      try {
        // Revert to previous status (PENDING)
        await prisma.task.update({
          where: { id: context.taskId },
          data: {
            nodeId: null,
            status: 'PENDING',
            reason: 'Task status reverted due to saga compensation',
          },
        });

        await idempotencyService.complete(idempotencyKey, {
          status: 'completed',
        });
      } catch (error) {
        logger.error(
          { taskId: context.taskId, error },
          'Failed to revert task status in compensation',
        );
        try {
          await prisma.idempotencyRecord.delete({
            where: { idempotencyKey },
          });
        } catch (cleanupErr) {
          logger.warn(
            { idempotencyKey, cleanupErr },
            'Failed to delete idempotency record on compensation failure',
          );
        }
        throw error;
      }
    },
  };

  // Step 5: Send assignment to edge agent
  const sendAssignmentToAgent: SagaStepDefinition<TaskSagaContext> = {
    name: 'SendAssignmentToAgent',
    timeout: TASK_TIMEOUT,
    execute: async (context) => {
      if (!context.nodeUrl) {
        throw new Error('Node URL not available');
      }

      // Update status to RUNNING locally first to track intent
      await prisma.task.update({
        where: { id: context.taskId },
        data: { status: 'RUNNING' },
      });

      await prisma.taskExecution.updateMany({
        where: { taskId: context.taskId, status: 'SCHEDULED' },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });

      const dbTask = await prisma.task.findUnique({
        where: { id: context.taskId },
        select: { image: true },
      });
      const image = dbTask?.image || 'alpine:3.18';

      const startTime = Date.now();

      try {
        // Send task to edge agent with circuit breaker protection
        const response = await withCircuitBreaker(
          {
            ...circuitBreakerConfigs.nodeAgent,
            name: `node-agent-${context.nodeId}`,
          },
          () => {
            const payload = {
              taskId: context.taskId,
              taskName: context.taskName,
              type: context.taskType,
              input: context.input,
              timeout: TASK_TIMEOUT,
              image,
            };

            const signature = crypto
              .createHmac('sha256', env.REQUEST_SIGNATURE_SECRET)
              .update(JSON.stringify(payload))
              .digest('hex');

            return axios.post(
              `${context.nodeUrl}/run-task`,
              payload,
              {
                timeout: 10000,
                headers: {
                  'X-Request-ID': `${context.taskId}-${Date.now()}`,
                  'X-Saga-ID': context.taskId,
                  'x-signature': signature,
                },
              },
            );
          },
        );

        const duration = Date.now() - startTime;
        return {
          output: response.data,
          duration,
          containerId: response.data.containerId,
        };
      } catch (error) {
        const errorMessage = axios.isAxiosError(error)
          ? `HTTP ${error.response?.status || 'unknown'}: ${error.message}`
          : (error as Error).message;

        throw new Error(`Task dispatch failed: ${errorMessage}`);
      }
    },
    compensate: async (context) => {
      const idempotencyKey = `compensate:SendAssignmentToAgent:${context.taskId}`;
      const check = await idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'SagaCompensation',
        resourceId: context.taskId,
      });

      if (check.isDuplicate) {
        return;
      }

      logger.info({ taskId: context.taskId }, 'Sending cancellation to agent');

      try {
        if (context.nodeUrl) {
          try {
            await withCircuitBreaker(
              {
                ...circuitBreakerConfigs.nodeAgent,
                name: `node-agent-${context.nodeId}`,
              },
              () =>
                axios.post(
                  `${context.nodeUrl}/cancel-task`,
                  { taskId: context.taskId },
                  { timeout: 5000 },
                ),
            );
          } catch (error) {
            logger.warn(
              { taskId: context.taskId, error },
              'Failed to cancel task on node agent during compensation',
            );
          }
        }

        // Ensure local status is moved away from RUNNING
        await prisma.taskExecution.updateMany({
          where: { taskId: context.taskId, status: 'RUNNING' },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });

        await idempotencyService.complete(idempotencyKey, {
          status: 'completed',
        });
      } catch (error) {
        logger.error(
          { taskId: context.taskId, error },
          'Failed in SendAssignmentToAgent compensation',
        );
        try {
          await prisma.idempotencyRecord.delete({
            where: { idempotencyKey },
          });
        } catch (cleanupErr) {
          logger.warn(
            { idempotencyKey, cleanupErr },
            'Failed to delete idempotency record on compensation failure',
          );
        }
        throw error;
      }
    },
  };

  // Step 6: Start heartbeat timeout monitor
  const startHeartbeatMonitor: SagaStepDefinition<TaskSagaContext> = {
    name: 'StartHeartbeatMonitor',
    timeout: 5000,
    execute: async (context) => {
      if (redis) {
        const heartbeatKey = `task:heartbeat:${context.taskId}`;
        await redis.set(heartbeatKey, 'ACTIVE', 'PX', 60000); // 1 minute initial window
      }

      await prisma.taskExecution.updateMany({
        where: { taskId: context.taskId, status: 'RUNNING' },
        data: {
          metadata: {
            monitorStartedAt: new Date().toISOString(),
            heartbeatTimeoutMs: 60000,
          } as any,
        },
      });

      return {};
    },
    compensate: async (context) => {
      const idempotencyKey = `compensate:StartHeartbeatMonitor:${context.taskId}`;
      const check = await idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'SagaCompensation',
        resourceId: context.taskId,
      });

      if (check.isDuplicate) {
        return;
      }

      logger.info({ taskId: context.taskId }, 'Cancelling heartbeat monitor');

      try {
        if (redis) {
          await redis.del(`task:heartbeat:${context.taskId}`);
        }

        await idempotencyService.complete(idempotencyKey, {
          status: 'completed',
        });
      } catch (error) {
        logger.error(
          { taskId: context.taskId, error },
          'Failed in StartHeartbeatMonitor compensation',
        );
        try {
          await prisma.idempotencyRecord.delete({
            where: { idempotencyKey },
          });
        } catch (cleanupErr) {
          logger.warn(
            { idempotencyKey, cleanupErr },
            'Failed to delete idempotency record on compensation failure',
          );
        }
        throw error;
      }
    },
  };

  // Step 7: Complete Task
  const completeTask: SagaStepDefinition<TaskSagaContext> = {
    name: 'CompleteTask',
    timeout: 10000,
    execute: async (context) => {
      logger.debug({ taskId: context.taskId }, 'Completing task');

      // Update task status
      await prisma.task.update({
        where: { id: context.taskId },
        data: {
          status: 'COMPLETED',
        },
      });

      // Update execution record
      await prisma.taskExecution.updateMany({
        where: { taskId: context.taskId, status: 'RUNNING' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          durationMs: context.duration ?? null,
          output: context.output as any,
        },
      });

      if (onOutcome) {
        onOutcome(context.taskId, context.duration || 0, 'COMPLETED').catch(
          (err) =>
            logger.error(
              { taskId: context.taskId, err },
              'Failed to report outcome to drift detector',
            ),
        );
      }

      return { completedAt: new Date().toISOString() };
    },
    compensate: async (context) => {
      logger.info(
        { taskId: context.taskId },
        '[Saga] Compensating CompleteTask',
      );
      const idempotencyKey = `compensate:CompleteTask:${context.taskId}`;
      const check = await idempotencyService.checkAndRecord({
        idempotencyKey,
        resourceType: 'SagaCompensation',
        resourceId: context.taskId,
      });

      if (check.isDuplicate) {
        return;
      }

      logger.debug('Completion step compensation (no-op)');
      await idempotencyService.complete(idempotencyKey, {
        status: 'completed',
      });
    },
  };

  // Return the saga definition
  return {
    name: 'TaskLifecycleSaga',
    steps: [
      validateTask,
      reserveNodeResources,
      createTaskExecutionRecord,
      updateTaskStatusScheduled,
      sendAssignmentToAgent,
      startHeartbeatMonitor,
      completeTask,
    ],
    timeout: TASK_TIMEOUT + 60000, // Total saga timeout (5 min + 1 min buffer)
    retryDelayMs: 1000,
  };
}
