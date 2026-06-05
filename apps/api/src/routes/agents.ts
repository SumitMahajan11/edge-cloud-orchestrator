import { trace } from '@opentelemetry/api';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { TenantId } from '../types/fastify.js';

const agentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const { AgentRegistrationService, CertificateAuthorityManager } =
    await import('../services/mtls-authentication.js');

  console.log(
    'DEBUG [agentRoutes] Entering agentRoutes, fastify.prisma exists:',
    !!fastify.prisma,
    'hasDecorator(prisma):',
    fastify.hasDecorator('prisma'),
  );
  if (!(fastify as any).prisma) {
    fastify.log.error(
      { route: 'agentRoutes' },
      'Prisma client not found on fastify instance in agentRoutes',
    );
  }
  const caManager = new CertificateAuthorityManager(
    fastify.prisma,
    fastify.log as any,
  );
  const registrationService = new AgentRegistrationService(
    caManager,
    fastify.prisma,
    fastify.log as any,
  );

  // Initialize CA on startup
  await caManager.initialize();

  /**
   * POST /v2/agents/certificates/sign
   *
   * Bootstraps an agent by signing its CSR and registering the node.
   * Requires a valid one-time bootstrap token.
   */
  fastify.post(
    '/certificates/sign',
    {
      config: { public: true },
      schema: {
        tags: ['agents'],
        summary: 'Bootstrap agent certificate and register node',
        body: {
          type: 'object',
          required: ['csr', 'bootstrapToken', 'nodeName', 'region'],
          properties: {
            csr: {
              type: 'string',
              description: 'PEM encoded Certificate Signing Request',
            },
            bootstrapToken: {
              type: 'string',
              description: 'One-time bootstrap token',
            },
            nodeName: { type: 'string' },
            region: { type: 'string' },
            ipAddress: { type: 'string' },
            port: { type: 'number' },
            cpuCores: { type: 'number' },
            memoryGB: { type: 'number' },
            storageGB: { type: 'number' },
            hardwareId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              certificate: { type: 'string' },
              caCertificate: { type: 'string' },
              nodeId: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
          400: { $ref: 'ErrorSchema#' },
          401: { $ref: 'ErrorSchema#' },
          403: { $ref: 'ErrorSchema#' },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await registrationService.registerAgent(
          request.body as any,
        );
        return result;
      } catch (error: unknown) {
        const err = error as Error;
        request.log.error({ err }, 'Agent registration failed');
        return reply.status(400).send({
          error: {
            code: 'REGISTRATION_FAILED',
            message: err.message,
            requestId: request.id,
          },
        });
      }
    },
  );

  /**
   * GET /v2/agents/ca
   *
   * Public endpoint to get the CA certificate for server verification.
   */
  fastify.get(
    '/ca',
    {
      config: { public: true },
      schema: {
        tags: ['agents'],
        summary: 'Get CA certificate',
        response: {
          200: {
            type: 'object',
            properties: {
              certificate: { type: 'string' },
            },
          },
        },
      },
    },
    async () => {
      return {
        certificate: caManager.getCACertificate(),
      };
    },
  );

  /**
   * GET /v2/agents/tasks/pending
   *
   * Polls for the next pending task assigned to this agent.
   */
  fastify.get(
    '/tasks/pending',
    {
      config: { public: true },
      schema: {
        tags: ['agents'],
        summary: 'Poll for pending tasks',
        response: {
          200: {
            type: 'object',
            properties: {
              task_id: { type: 'string' },
              runtime: { type: 'string' },
              image: { type: 'string' },
              input: { type: 'object', additionalProperties: true },
              memory_limit_mb: { type: 'number' },
              cpu_fuel: { type: 'number', nullable: true },
              timeout_seconds: { type: 'number' },
            },
          },
          404: {
            $ref: 'ErrorSchema#',
          },
        },
      },
    },
    async (request, reply) => {
      // Extract nodeId from certificate
      const cert = (request.raw.socket as any).getPeerCertificate?.();

      // In production, we ONLY trust the certificate CN.
      // In development/test, we allow a header fallback if no certificate is present.
      const nodeId =
        cert?.subject?.CN ||
        (process.env.NODE_ENV !== 'production'
          ? request.headers['x-node-id']
          : null);

      if (!nodeId) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid node certificate required',
            requestId: request.id,
          },
        });
      }

      // Resolve tenant context for the node to enable Prisma tenant filtering
      const node = await fastify.prisma.edgeNode.findUnique({
        where: { id: nodeId as string },
        select: { tenantId: true },
      });

      if (!node) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Node not registered or deactivated',
            requestId: request.id,
          },
        });
      }

      // Set tenant context for this asynchronous execution branch
      const { enterWithTenantContext } =
        await import('@edgecloud/shared-kernel');
      enterWithTenantContext(node.tenantId);

      // Find oldest pending task assigned to this node
      const task = await fastify.prisma.task.findFirst({
        where: {
          nodeId: nodeId as string,
          status: 'PENDING',
        },
        orderBy: {
          priority: 'asc', // Higher priority first (if priority is mapped correctly)
          // or just FIFO:
          // submittedAt: 'asc'
        },
        include: {
          executions: {
            where: { status: 'PENDING' },
            take: 1,
          },
        },
      });

      if (!task) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No tasks pending',
            requestId: request.id,
          },
        });
      }

      // Transition task and execution status to RUNNING
      const executionId = task.executions[0]?.id;
      if (executionId) {
        await fastify.prisma.$transaction([
          fastify.prisma.task.update({
            where: { id: task.id },
            data: { status: 'RUNNING' },
          }),
          fastify.prisma.taskExecution.update({
            where: { id: executionId },
            data: { status: 'RUNNING', startedAt: new Date() },
          }),
        ]);
      } else {
        await fastify.prisma.$transaction([
          fastify.prisma.task.update({
            where: { id: task.id },
            data: { status: 'RUNNING' },
          }),
          fastify.prisma.taskExecution.create({
            data: {
              taskId: task.id,
              nodeId: nodeId as string,
              status: 'RUNNING',
              startedAt: new Date(),
              tenantId: node.tenantId,
              attemptNumber: 1,
            },
          }),
        ]);
      }

      // Map to TaskSpec format expected by agent
      const taskSpec = {
        task_id: task.id,
        runtime: task.runtime === 'DOCKER' ? 'Docker' : 'Wasm',
        image: task.image || 'main.wasm', // In reality, this would be determined by task type/input
        input: task.input || {},
        memory_limit_mb: 512,
        cpu_fuel: null,
        timeout_seconds: 60,
        // Propagate trace context
        trace_id:
          (task as any).traceId || trace.getActiveSpan()?.spanContext().traceId,
        span_id:
          (task as any).spanId || trace.getActiveSpan()?.spanContext().spanId,
      };

      return taskSpec;
    },
  );

  /**
   * POST /v2/agents/heartbeat
   *
   * Receives heartbeat and metrics from an agent.
   */
  fastify.post(
    '/heartbeat',
    {
      config: { public: true },
      schema: {
        tags: ['agents'],
        summary: 'Agent heartbeat',
        body: {
          type: 'object',
          properties: {
            timestamp: { type: 'number' },
            status: { type: 'string' },
            metrics: {
              type: 'object',
              properties: {
                cpu_usage: { type: 'number' },
                memory_usage: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cert = (request.raw.socket as any).getPeerCertificate?.();
      const nodeId =
        cert?.subject?.CN ||
        (process.env.NODE_ENV !== 'production'
          ? request.headers['x-node-id']
          : null);

      if (!nodeId) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid node certificate required',
            requestId: request.id,
          },
        });
      }

      // Resolve tenant context
      const node = await fastify.prisma.edgeNode.findUnique({
        where: { id: nodeId as string },
        select: { tenantId: true },
      });

      if (!node) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Node not found',
            requestId: request.id,
          },
        });
      }
      const { enterWithTenantContext } =
        await import('@edgecloud/shared-kernel');
      enterWithTenantContext(node.tenantId);

      // Update node status and metrics
      const data = request.body as Record<string, unknown>;
      await fastify.prisma.edgeNode.update({
        where: { id: nodeId as string },
        data: {
          status: 'ONLINE',
          lastHeartbeat: new Date((data.timestamp as number) * 1000),
          // Optionally store metrics in NodeMetric table
        },
      });

      return { status: 'OK' };
    },
  );

  /**
   * POST /v2/agents/tasks/:taskId/status
   *
   * Updates the status of a task execution (e.g. to RUNNING).
   */
  fastify.post(
    '/tasks/:taskId/status',
    {
      config: { public: true },
      schema: {
        tags: ['agents'],
        summary: 'Update task execution status',
        params: {
          type: 'object',
          required: ['taskId'],
          properties: {
            taskId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { taskId } = request.params as any;
      const { status } = request.body as any;
      const cert = (request.raw.socket as any).getPeerCertificate?.();
      const nodeId =
        cert?.subject?.CN ||
        (process.env.NODE_ENV !== 'production'
          ? request.headers['x-node-id']
          : null);

      if (!nodeId) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid node certificate required',
            requestId: request.id,
          },
        });
      }

      // Resolve tenant context
      const node = await fastify.prisma.edgeNode.findUnique({
        where: { id: nodeId as string },
        select: { tenantId: true },
      });
      if (!node) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Node not found',
            requestId: request.id,
          },
        });
      }

      const { enterWithTenantContext } =
        await import('@edgecloud/shared-kernel');
      enterWithTenantContext(node.tenantId);

      // Update task status to RUNNING in TaskExecution
      const execution = await fastify.prisma.taskExecution.findFirst({
        where: {
          taskId,
          nodeId: nodeId as string,
          status: { in: ['PENDING', 'SCHEDULED'] },
        },
        orderBy: { attemptNumber: 'desc' },
      });

      if (!execution) {
        // If it's already RUNNING, just return OK (idempotency)
        const alreadyRunning = await fastify.prisma.taskExecution.findFirst({
          where: { taskId, nodeId: nodeId as string, status: 'RUNNING' },
        });
        if (alreadyRunning) {
          return { status: 'OK' };
        }

        request.log.warn(
          { taskId, nodeId },
          'No pending or scheduled execution found for task status update',
        );
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No pending or scheduled execution found',
            requestId: request.id,
          },
        });
      }

      await fastify.prisma.$transaction([
        fastify.prisma.taskExecution.update({
          where: { id: execution.id },
          data: { status: (status as string).toUpperCase() as any },
        }),
        fastify.prisma.task.update({
          where: { id: taskId },
          data: { status: (status as string).toUpperCase() as any },
        }),
      ]);

      return { status: 'OK' };
    },
  );

  /**
   * POST /v2/agents/tasks/:taskId/result
   *
   * Receives the execution result of a task from an agent.
   */
  fastify.post(
    '/tasks/:taskId/result',
    {
      config: { public: true },
      schema: {
        tags: ['agents'],
        summary: 'Report task result',
        params: {
          type: 'object',
          required: ['taskId'],
          properties: {
            taskId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['status', 'exit_code'],
          properties: {
            status: { type: 'string' },
            exit_code: { type: 'number' },
            stdout: { type: 'string' },
            stderr: { type: 'string' },
            duration_ms: { type: 'number' },
            error: { type: 'string', nullable: true },
            metrics: {
              type: 'object',
              properties: {
                cpu_usage_avg: { type: 'number' },
                memory_usage_max: { type: 'number' },
                network_ingress_bytes: { type: 'number' },
                network_egress_bytes: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { taskId } = request.params as any;
      const cert = (request.raw.socket as any).getPeerCertificate?.();
      const nodeId =
        cert?.subject?.CN ||
        (process.env.NODE_ENV !== 'production'
          ? request.headers['x-node-id']
          : null);

      if (!nodeId) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid node certificate required',
            requestId: request.id,
          },
        });
      }

      // Resolve tenant context
      const node = await fastify.prisma.edgeNode.findUnique({
        where: { id: nodeId as string },
        select: { tenantId: true },
      });

      if (!node) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Node not found',
            requestId: request.id,
          },
        });
      }
      const { enterWithTenantContext } =
        await import('@edgecloud/shared-kernel');
      enterWithTenantContext(node.tenantId);

      const result = request.body as Record<string, unknown>;
      const status = ((result.status as string) || 'FAILED').toUpperCase();

      // Update task and execution state in a transaction
      await fastify.prisma.$transaction(async (tx) => {
        // Find the execution record
        const execution = await tx.taskExecution.findFirst({
          where: { taskId, nodeId: nodeId as string, status: 'RUNNING' },
          orderBy: { attemptNumber: 'desc' },
        });

        if (execution) {
          request.log.info(
            { taskId, nodeId, executionId: execution.id, status },
            'Updating task execution result',
          );
          await tx.taskExecution.update({
            where: { id: execution.id },
            data: {
              status: status as any,
              exitCode: result.exit_code as number,
              durationMs: result.duration_ms as number,
              error: result.error as string | null,
              completedAt: new Date(),
            },
          });
        } else {
          request.log.warn(
            { taskId, nodeId },
            'No RUNNING execution found for task result report',
          );
          // If no running execution found for this node/task, reject
          throw new Error('No running execution found for this node and task');
        }

        await tx.task.update({
          where: { id: taskId },
          data: {
            status: status as any,
            nodeId: nodeId as string,
          },
        });
      });

      fastify.taskScheduler
        .recordTaskOutcome(
          taskId,
          (result.duration_ms as number) || 0,
          status as any,
        )
        .catch((err: Error) =>
          request.log.error({ err, taskId }, 'Failed to record task outcome'),
        );

      // Broadcast update
      fastify.wsManager.broadcastToTenant(
        node.tenantId as TenantId,
        'task:updated',
        { id: taskId, status },
      );

      return { status: 'OK' };
    },
  );
};

export default agentRoutes;
