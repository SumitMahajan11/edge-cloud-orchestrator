import { PrismaClient, TaskStatus, WorkflowExecutionStatus } from '@prisma/client';
import type { Logger } from 'pino';
import { DAGExecutor, WorkflowNode } from '@edgecloud/shared-kernel';
import type { TaskScheduler } from './task-scheduler';
import type { WebSocketManager } from './websocket-manager';

export class WorkflowEngine {
  private prisma: PrismaClient;
  private logger: Logger;
  private taskScheduler: TaskScheduler;
  private wsManager: WebSocketManager;
  private dagExecutor: DAGExecutor;

  constructor(
    prisma: PrismaClient,
    logger: Logger,
    taskScheduler: TaskScheduler,
    wsManager: WebSocketManager
  ) {
    this.prisma = prisma;
    this.logger = logger;
    this.taskScheduler = taskScheduler;
    this.wsManager = wsManager;
    this.dagExecutor = new DAGExecutor();

    // Listen for task outcomes to advance workflows
    this.taskScheduler.on('taskOutcome', async ({ taskId, status }) => {
      try {
        await this.handleTaskOutcome(taskId, status);
      } catch (error) {
        this.logger.error({ error, taskId }, 'Error handling task outcome in workflow engine');
      }
    });
  }

  /**
   * Start a new workflow execution
   */
  async executeWorkflow(workflowId: string, tenantId: string): Promise<string> {
    this.logger.info({ workflowId, tenantId }, 'Starting workflow execution');

    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId, tenantId },
    });

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const definition = workflow.definition as any;
    const rawNodes = definition.nodes || [];
    const rawEdges = definition.edges || [];
    
    // Map to DAGExecutor format
    const nodes: WorkflowNode[] = this.mapToWorkflowNodes(rawNodes, rawEdges);
    
    // Validate DAG
    const validation = this.dagExecutor.validate(nodes);
    if (!validation.valid) {
      throw new Error(`Invalid DAG: ${validation.errors.join(', ')}`);
    }

    // Create execution record
    const execution = await this.prisma.workflowExecution.create({
      data: {
        workflowId,
        tenantId,
        status: 'RUNNING',
      },
    });

    // Find root nodes (no dependencies)
    const readyNodes = this.dagExecutor.getReadyNodes(nodes, new Set());
    
    if (readyNodes.length === 0 && nodes.length > 0) {
      throw new Error('No root nodes found in DAG');
    }

    // Trigger initial tasks
    for (const node of readyNodes) {
      await this.submitTaskForNode(execution.id, node, tenantId);
    }

    // If no nodes at all, complete immediately
    if (nodes.length === 0) {
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }

    this.wsManager.broadcastToTenant(tenantId, 'workflow:execution_started', {
      executionId: execution.id,
      workflowId,
    });

    return execution.id;
  }

  /**
   * Handle task outcome and advance workflow if needed
   */
  private async handleTaskOutcome(taskId: string, status: 'COMPLETED' | 'FAILED') {
    const taskRun = await this.prisma.workflowTaskRun.findFirst({
      where: { taskId },
      include: { execution: { include: { workflow: true } } },
    });

    if (!taskRun) return; // Not part of a workflow

    this.logger.debug({ taskId, status, executionId: taskRun.executionId }, 'Processing task outcome for workflow');

    // Update task run status
    await this.prisma.workflowTaskRun.update({
      where: { id: taskRun.id },
      data: {
        status: status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        completedAt: new Date(),
      },
    });

    const executionId = taskRun.executionId;
    const tenantId = taskRun.execution.tenantId;

    if (status === 'FAILED') {
      // Fail the whole workflow for now (strict mode)
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'FAILED', completedAt: new Date() },
      });

      this.wsManager.broadcastToTenant(tenantId, 'workflow:execution_failed', {
        executionId,
        taskId,
        error: 'Task failed',
      });
      return;
    }

    // Check if we can advance
    const allRuns = await this.prisma.workflowTaskRun.findMany({
      where: { executionId },
    });

    const completedIds = new Set(
      allRuns
        .filter(r => r.status === 'COMPLETED')
        .map(r => r.stepName) // We use stepName in dependencies
    );

    const workflow = taskRun.execution.workflow;
    const definition = workflow.definition as any;
    const nodes: WorkflowNode[] = this.mapToWorkflowNodes(definition.nodes || [], definition.edges || []);

    const readyNodes = this.dagExecutor.getReadyNodes(nodes, completedIds);

    // Filter out nodes that are already in progress
    const inProgressStepNames = new Set(
      allRuns
        .filter(r => r.status === 'RUNNING' || r.status === 'SCHEDULED' || r.status === 'PENDING')
        .map(r => r.stepName)
    );

    const nextNodes = readyNodes.filter(n => !inProgressStepNames.has(n.stepName));

    if (nextNodes.length > 0) {
      for (const node of nextNodes) {
        await this.submitTaskForNode(executionId, node, tenantId);
      }
    } else {
      // Check if all nodes are completed
      const allStepNames = new Set(nodes.map(n => n.id));
      const finishedAll = Array.from(allStepNames).every(id => completedIds.has(id));

      if (finishedAll) {
        await this.prisma.workflowExecution.update({
          where: { id: executionId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });

        this.wsManager.broadcastToTenant(tenantId, 'workflow:execution_completed', {
          executionId,
        });
      }
    }
    
    // Broadcast progress update
    this.wsManager.broadcastToTenant(tenantId, 'workflow:progress', {
      executionId,
      completedSteps: Array.from(completedIds),
    });
  }

  private mapToWorkflowNodes(rawNodes: any[], rawEdges: any[]): WorkflowNode[] {
    return rawNodes.map(node => {
      const dependsOn = rawEdges
        .filter(edge => edge.to === node.id)
        .map(edge => edge.from);

      return {
        id: node.id,
        stepName: node.name,
        taskSpec: {
          name: node.name,
          type: node.config?.taskType || 'CUSTOM',
          priority: node.config?.priority || 'MEDIUM',
          target: node.config?.target || 'EDGE',
          input: node.config?.input || {},
          metadata: node.config?.metadata || {},
          nodeId: node.config?.nodeId,
        },
        dependsOn,
      };
    });
  }

  private async submitTaskForNode(executionId: string, node: WorkflowNode, tenantId: string) {
    this.logger.info({ executionId, step: node.stepName }, 'Submitting task for workflow step');

    // Create the actual Task
    const task = await this.prisma.task.create({
      data: {
        name: `${node.stepName} (Workflow)`,
        type: node.taskSpec.type as any,
        priority: node.taskSpec.priority as any || 'MEDIUM',
        target: node.taskSpec.target as any || 'EDGE',
        tenantId,
        policy: node.taskSpec.nodeId ? 'manual' : 'ml-optimized',
        reason: `Workflow execution ${executionId} step ${node.stepName}`,
        input: (node.taskSpec.input ?? {}) as any,
        metadata: {
          ...(node.taskSpec.metadata as any || {}),
          workflowExecutionId: executionId,
          workflowStepName: node.stepName,
        },
        nodeId: node.taskSpec.nodeId,
        executions: {
          create: {
            status: 'PENDING',
            attemptNumber: 1,
            tenantId,
          },
        },
      },
    });

    // Create WorkflowTaskRun record
    await this.prisma.workflowTaskRun.create({
      data: {
        executionId,
        taskId: task.id,
        stepName: node.id, // Using the node's stable ID as stepName for dependency tracking
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    // Enqueue in task scheduler
    await this.taskScheduler.enqueue(task as any);
  }
}
