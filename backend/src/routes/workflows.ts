import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { createWorkflowSchema, executeWorkflowSchema, idParamSchema } from '../schemas'
import { zodToFastifySchema } from '../utils/zod-schema'

export default async function workflowRoutes(fastify: FastifyInstance) {
  // List workflows
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['workflows'],
      summary: 'List workflows',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const workflows = await fastify.prisma.workflow.findMany({
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    
    return workflows
  })
  
  // Get workflow
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      tags: ['workflows'],
      summary: 'Get workflow by ID',
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const workflow = await fastify.prisma.workflow.findUnique({
      where: { id: request.params.id },
      include: {
        executions: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    })
    
    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' })
    }
    
    return workflow
  })
  
  // Create workflow
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: zodToFastifySchema(createWorkflowSchema),
      tags: ['workflows'],
      summary: 'Create a new workflow',
    },
  }, async (request: FastifyRequest<{ Body: z.infer<typeof createWorkflowSchema> }>, reply: FastifyReply) => {
    const { name, version, nodes, edges, variables, timeout, retryPolicy } = request.body
    
    const workflow = await fastify.prisma.workflow.create({
      data: {
        name,
        version,
        definition: ({
          nodes,
          edges,
          variables,
          timeout,
          retryPolicy,
        }) as any,
      },
    })
    
    return reply.status(201).send(workflow)
  })
  
  // Execute workflow
  fastify.post('/:id/execute', {
    preHandler: [fastify.authenticate],
    schema: {
      params: zodToFastifySchema(idParamSchema),
      body: zodToFastifySchema(executeWorkflowSchema),
      tags: ['workflows'],
      summary: 'Execute a workflow',
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof executeWorkflowSchema> }>, reply: FastifyReply) => {
    const { id } = request.params
    const { input } = request.body
    
    const workflow = await fastify.prisma.workflow.findUnique({ where: { id } })
    
    if (!workflow || !workflow.isActive) {
      return reply.status(404).send({ error: 'Workflow not found or inactive' })
    }
    
    const execution = await fastify.prisma.workflowExecution.create({
      data: {
        workflowId: id,
        input: (input || {}) as any,
      },
    })
    
    // TODO: Start workflow execution engine
    
    return reply.status(202).send(execution)
  })
  
  // Get execution status
  fastify.get('/executions/:executionId', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['workflows'],
      summary: 'Get workflow execution status',
    },
  }, async (request: FastifyRequest<{ Params: { executionId: string } }>, reply: FastifyReply) => {
    const execution = await fastify.prisma.workflowExecution.findUnique({
      where: { id: request.params.executionId },
      include: { workflow: true },
    })
    
    if (!execution) {
      return reply.status(404).send({ error: 'Execution not found' })
    }
    
    return execution
  })
}
