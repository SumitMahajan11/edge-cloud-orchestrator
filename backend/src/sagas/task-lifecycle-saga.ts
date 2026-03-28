/**
 * Task Lifecycle Saga
 * 
 * Orchestrates the complete lifecycle of a task from creation to completion
 * with proper compensation handling for failures.
 * 
 * Steps:
 * 1. ValidateTask - Check input validity and resource availability
 * 2. ReserveResources - Reserve node capacity
 * 3. ScheduleTask - Assign task to node
 * 4. ExecuteTask - Run task on edge agent
 * 5. CompleteTask - Record results and cleanup
 */

import { PrismaClient } from '@prisma/client';
import { SagaDefinition, SagaStepDefinition } from '@edgecloud/saga';
import type { Logger } from 'pino';
import axios from 'axios';

// ============================================================================
// Task Saga Context
// ============================================================================

export interface TaskSagaContext {
  taskId: string;
  taskName: string;
  taskType: string;
  priority: string;
  input: Record<string, unknown>;
  maxRetries: number;
  
  // Populated during execution
  nodeId?: string;
  nodeUrl?: string;
  reservationId?: string;
  containerId?: string;
  output?: Record<string, unknown>;
  duration?: number;
  
  // Error tracking
  error?: string;
  errorStack?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const TASK_TIMEOUT = 300000; // 5 minutes
const NODE_TIMEOUT = 30000; // 30 seconds
const RESERVATION_TTL = 60000; // 1 minute reservation TTL

// ============================================================================
// Task Lifecycle Saga Definition
// ============================================================================

export function createTaskLifecycleSaga(
  prisma: PrismaClient,
  logger: Logger,
  kafkaProducer?: any
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
        throw new Error(`Task ${context.taskId} is not in PENDING state (current: ${task.status})`);
      }
      
      // Validate input
      if (!context.taskName || !context.taskType) {
        throw new Error('Task name and type are required');
      }
      
      logger.info({ taskId: context.taskId }, 'Task validated successfully');
      return { validatedAt: new Date().toISOString() };
    },
    compensate: async (_context) => {
      // No compensation needed for validation
      logger.debug('Validation step has no compensation');
    },
  };

  // Step 2: Reserve Resources
  const reserveResources: SagaStepDefinition<TaskSagaContext> = {
    name: 'ReserveResources',
    timeout: 10000,
    execute: async (context) => {
      logger.debug({ taskId: context.taskId }, 'Reserving resources');
      
      // Find suitable node
      const nodes = await prisma.edgeNode.findMany({
        where: {
          status: 'ONLINE',
          isMaintenanceMode: false,
          tasksRunning: { lt: 10 },
        },
        orderBy: [
          { tasksRunning: 'asc' },
          { latency: 'asc' },
        ],
        take: 1,
      });
      
      if (nodes.length === 0) {
        throw new Error('No available nodes for task execution');
      }
      
      const node = nodes[0];
      
      // Create a reservation using Redis or in DB
      // For now, we'll use the database to track reservations
      const reservation = await prisma.$transaction(async (tx) => {
        // Reserve the node by incrementing task count
        const updatedNode = await tx.edgeNode.update({
          where: { id: node.id },
          data: { tasksRunning: { increment: 1 } },
        });
        
        // Check if we didn't exceed capacity
        if (updatedNode.tasksRunning > updatedNode.maxTasks) {
          throw new Error('Node capacity exceeded during reservation');
        }
        
        return { nodeId: node.id, reservedAt: new Date() };
      });
      
      logger.info({ taskId: context.taskId, nodeId: node.id }, 'Resources reserved');
      
      return {
        nodeId: node.id,
        nodeUrl: node.url,
        reservationId: `res-${context.taskId}-${Date.now()}`,
      };
    },
    compensate: async (context) => {
      if (!context.nodeId) return;
      
      logger.info({ taskId: context.taskId, nodeId: context.nodeId }, 'Releasing resource reservation');
      
      // Check current count before decrement to avoid negative values
      const node = await prisma.edgeNode.findUnique({
        where: { id: context.nodeId },
        select: { tasksRunning: true }
      });
      
      if (node && node.tasksRunning > 0) {
        await prisma.edgeNode.update({
          where: { id: context.nodeId },
          data: { tasksRunning: { decrement: 1 } },
        });
      }
    },
  };

  // Step 3: Schedule Task
  const scheduleTask: SagaStepDefinition<TaskSagaContext> = {
    name: 'ScheduleTask',
    timeout: NODE_TIMEOUT,
    execute: async (context) => {
      if (!context.nodeId || !context.nodeUrl) {
        throw new Error('Node not assigned for scheduling');
      }
      
      logger.debug({ taskId: context.taskId, nodeId: context.nodeId }, 'Scheduling task on node');
      
      // Update task status to SCHEDULED
      await prisma.task.update({
        where: { id: context.taskId },
        data: {
          nodeId: context.nodeId,
          status: 'SCHEDULED',
          reason: `Scheduled on node ${context.nodeId}`,
        },
      });
      
      // Create task execution record
      await prisma.taskExecution.create({
        data: {
          taskId: context.taskId,
          nodeId: context.nodeId,
          nodeUrl: context.nodeUrl,
          status: 'SCHEDULED',
          scheduledAt: new Date(),
        },
      });
      
      logger.info({ taskId: context.taskId, nodeId: context.nodeId }, 'Task scheduled');
      
      return { scheduledAt: new Date().toISOString() };
    },
    compensate: async (context) => {
      logger.info({ taskId: context.taskId }, 'Unscheduling task');
      
      // Reset task to PENDING
      await prisma.task.update({
        where: { id: context.taskId },
        data: {
          nodeId: null,
          status: 'PENDING',
          reason: 'Task unscheduled due to saga compensation',
        },
      });
      
      // Cancel task execution
      await prisma.taskExecution.updateMany({
        where: { taskId: context.taskId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      });
    },
  };

  // Step 4: Execute Task
  const executeTask: SagaStepDefinition<TaskSagaContext> = {
    name: 'ExecuteTask',
    timeout: TASK_TIMEOUT,
    execute: async (context) => {
      if (!context.nodeUrl) {
        throw new Error('Node URL not available');
      }
      
      logger.debug({ taskId: context.taskId, nodeUrl: context.nodeUrl }, 'Executing task on node');
      
      // Update status to RUNNING
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
      
      const startTime = Date.now();
      
      try {
        // Send task to edge agent
        const response = await axios.post(
          `${context.nodeUrl}/run-task`,
          {
            taskId: context.taskId,
            taskName: context.taskName,
            type: context.taskType,
            input: context.input,
            timeout: TASK_TIMEOUT,
          },
          {
            timeout: TASK_TIMEOUT,
            headers: {
              'X-Request-ID': `${context.taskId}-${Date.now()}`,
              'X-Saga-ID': context.taskId,
            },
          }
        );
        
        const duration = Date.now() - startTime;
        const output = response.data;
        
        logger.info({ taskId: context.taskId, duration }, 'Task execution completed');
        
        return {
          output,
          duration,
          containerId: response.data.containerId,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = axios.isAxiosError(error)
          ? `HTTP ${error.response?.status || 'unknown'}: ${error.message}`
          : (error as Error).message;
        
        logger.error({ taskId: context.taskId, error: errorMessage }, 'Task execution failed');
        
        throw new Error(`Task execution failed: ${errorMessage}`);
      }
    },
    compensate: async (context) => {
      if (!context.nodeUrl) return;
      
      logger.info({ taskId: context.taskId }, 'Cancelling task execution');
      
      try {
        // Send cancel request to edge agent
        await axios.post(
          `${context.nodeUrl}/cancel-task`,
          { taskId: context.taskId },
          { timeout: 10000 }
        );
      } catch (error) {
        logger.warn({ taskId: context.taskId, error }, 'Failed to cancel task on node');
      }
      
      // Update execution record
      await prisma.taskExecution.updateMany({
        where: { taskId: context.taskId, status: 'RUNNING' },
        data: { 
          status: 'CANCELLED',
          completedAt: new Date(),
        },
      });
    },
  };

  // Step 5: Complete Task
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
        where: { taskId: context.taskId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          durationMs: context.duration,
          output: context.output,
        },
      });
      
      // Publish task completed event (if Kafka producer available)
      if (kafkaProducer) {
        await kafkaProducer.send({
          topic: 'tasks.events',
          messages: [{
            key: context.taskId,
            value: JSON.stringify({
              eventType: 'TaskCompleted',
              aggregateId: context.taskId,
              timestamp: new Date(),
              taskId: context.taskId,
              nodeId: context.nodeId,
              duration: context.duration,
              output: context.output,
            }),
          }],
        });
      }
      
      logger.info({ taskId: context.taskId, duration: context.duration }, 'Task completed successfully');
      
      return { completedAt: new Date().toISOString() };
    },
    compensate: async (_context) => {
      // Completion is the final step - no compensation needed
      logger.debug('Completion step has no compensation');
    },
  };

  // Return the saga definition
  return {
    name: 'TaskLifecycleSaga',
    steps: [validateTask, reserveResources, scheduleTask, executeTask, completeTask],
    timeout: TASK_TIMEOUT + 60000, // Total saga timeout
    retryDelayMs: 1000,
  };
}
