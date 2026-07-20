import { Permissions } from '@edgecloud/shared-kernel';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createWorkflowSchema,
  executeWorkflowSchema,
  idParamSchema,
} from '../schemas';
import { zodToFastifySchema } from '../utils/zod-schema';

export default async function workflowRoutes(fastify: FastifyInstance) {
  // List workflows
  fastify.get(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        tags: ['workflows'],
        summary: 'List workflows',
      },
    },
    async (request) => {
      const workflows = await request.tPrisma.workflow.findMany({
        where: {},
        include: {
          _count: { select: { executions: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        data: workflows,
        pagination: {
          page: 1,
          limit: workflows.length || 50,
          total: workflows.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
  );

  // Get workflow
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['workflows'],
        summary: 'Get workflow by ID',
      },
    },
    async (request, reply) => {
      const workflow = await request.tPrisma.workflow.findFirst({
        where: { id: request.params.id },
        include: {
          executions: {
            orderBy: { startedAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!workflow) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Workflow not found',
            requestId: request.id,
          },
        });
      }

      return workflow;
    },
  );

  // Create workflow
  fastify.post<{ Body: z.infer<typeof createWorkflowSchema> }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_CREATE),
      ],
      schema: {
        body: zodToFastifySchema(createWorkflowSchema),
        tags: ['workflows'],
        summary: 'Create a new workflow',
      },
    },
    async (request, reply) => {
      const { name, version, nodes, edges, variables, timeout, retryPolicy } =
        request.body;

      try {
        // Validate DAG
        const { DAGExecutor } = await import('@edgecloud/shared-kernel');
        const dagExecutor = new DAGExecutor();

        const workflowNodes = nodes.map((node) => ({
          id: node.id,
          stepName: node.name,
          taskSpec: (node.config as any) || {},
          dependsOn: edges.filter((e) => e.to === node.id).map((e) => e.from),
        }));

        const validation = dagExecutor.validate(workflowNodes as any);
        if (!validation.valid) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_DAG',
              message: `Invalid DAG: ${validation.errors.join(', ')}`,
              requestId: request.id,
            },
          });
        }
      } catch (err: any) {
        request.log.error(
          { err: err.message, stack: err.stack },
          'DAG Validation failed with error',
        );
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected server error occurred',
            requestId: request.id,
          },
        });
      }

      const workflow = await request.tPrisma.workflow.create({
        data: {
          name,
          version,
          definition: {
            nodes,
            edges,
            variables,
            timeout,
            retryPolicy,
          } as any,
          tenantId: request.user!.tenantId!,
        } as any,
      });

      return reply.status(201).send(workflow);
    },
  );

  // Execute workflow
  fastify.post<{
    Params: { id: string };
    Body: z.infer<typeof executeWorkflowSchema>;
  }>(
    '/:id/execute',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_CREATE),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        body: zodToFastifySchema(executeWorkflowSchema),
        tags: ['workflows'],
        summary: 'Execute a workflow',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      // Input extraction removed as it's currently unused in the execution trigger

      const workflow = await request.tPrisma.workflow.findFirst({
        where: { id },
      });

      if (!workflow) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Workflow not found',
            requestId: request.id,
          },
        });
      }

      const executionId = await fastify.workflowEngine.executeWorkflow(
        id,
        request.user!.tenantId!,
      );

      return reply.status(202).send({
        executionId,
        message: 'Workflow execution started',
      });
    },
  );

  // Get execution status
  fastify.get<{ Params: { executionId: string } }>(
    '/executions/:executionId',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_READ),
      ],
      schema: {
        params: {
          type: 'object',
          properties: {
            executionId: { type: 'string' },
          },
          required: ['executionId'],
        },
        tags: ['workflows'],
        summary: 'Get workflow execution status',
      },
    },
    async (request, reply) => {
      const execution = await request.tPrisma.workflowExecution.findUnique({
        where: { id: request.params.executionId },
        include: {
          workflow: true,
          taskRuns: {
            include: { task: true },
            orderBy: { startedAt: 'asc' },
          },
        },
      });

      if (!execution) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Execution not found',
            requestId: request.id,
          },
        });
      }

      return execution;
    },
  );

  // Update workflow
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      version?: string;
      nodes?: any[];
      edges?: any[];
    };
  }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.TASK_CREATE),
      ],
      schema: {
        params: zodToFastifySchema(idParamSchema),
        tags: ['workflows'],
        summary: 'Update a workflow',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, version, nodes, edges } = request.body;

      const existing = await request.tPrisma.workflow.findFirst({
        where: { id, tenantId: request.user!.tenantId! },
      });

      if (!existing) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Workflow not found',
            requestId: request.id,
          },
        });
      }

      let newDefinition = existing.definition as any;
      if (nodes || edges) {
        newDefinition = {
          ...newDefinition,
          ...(nodes && { nodes }),
          ...(edges && { edges }),
        };
      }

      const updated = await request.tPrisma.workflow.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(version !== undefined && { version }),
          ...(newDefinition && { definition: newDefinition }),
        },
      });

      return updated;
    },
  );
}

