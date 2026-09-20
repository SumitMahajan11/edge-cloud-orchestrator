import { Permissions } from '@edgecloud/shared-kernel';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { zodToFastifySchema } from '../utils/zod-schema.js';
import {
  carbonSavingsQuerySchema,
  carbonPolicyUpdateSchema,
  carbonReportQuerySchema,
} from '../schemas/index.js';

/**
 * Carbon & Eco-Scheduling Routes (v2)
 */
export default async function carbonRoutes(fastify: FastifyInstance) {
  const { taskScheduler } = fastify;

  // GET /api/v2/carbon/intensity
  fastify.get(
    '/intensity',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_READ),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Get regional carbon intensity',
        response: {
          200: {
            type: 'object',
            properties: {
              regions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    zone: { type: 'string' },
                    carbonIntensityGco2: { type: 'number' },
                    lastUpdatedAt: { type: 'string' },
                    source: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return { regions: [] };
      }
      return taskScheduler.getCarbonIntensityData();
    },
  );

  // GET /api/v2/carbon/summary
  fastify.get(
    '/summary',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_READ),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Get carbon footprint summary',
        response: {
          200: {
            type: 'object',
            properties: {
              totalSavedGco2Today: { type: 'number' },
              totalSavedGco2Week: { type: 'number' },
              equivalentTreesPlanted: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return {
          totalSavedGco2Today: 0,
          totalSavedGco2Week: 0,
          equivalentTreesPlanted: 0,
        };
      }
      const savings = await taskScheduler.getCarbonSavingsData(1);
      return {
        totalSavedGco2Today: savings.totalSavedGco2Today,
        totalSavedGco2Week: savings.totalSavedGco2Week,
        equivalentTreesPlanted: savings.equivalentTreesPlanted,
      };
    },
  );

  // GET /api/v2/carbon/by-region
  fastify.get(
    '/by-region',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_READ),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Get carbon breakdown by region',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                zone: { type: 'string' },
                carbonIntensityGco2: { type: 'number' },
                lastUpdatedAt: { type: 'string' },
                source: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return [];
      }
      const data = await taskScheduler.getCarbonIntensityData();
      return data.regions;
    },
  );

  // GET /api/v2/carbon/savings
  fastify.get(
    '/savings',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_READ),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Get carbon savings metrics',
        querystring: zodToFastifySchema(carbonSavingsQuerySchema),
        response: {
          200: {
            type: 'object',
            properties: {
              totalSavedGco2Today: { type: 'number' },
              totalSavedGco2Week: { type: 'number' },
              equivalentTreesPlanted: { type: 'number' },
              savingsHistory: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    savedGco2: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { days } = (request.query as { days?: number }) || { days: 7 };
      if (!taskScheduler) {
        return {
          totalSavedGco2Today: 0,
          totalSavedGco2Week: 0,
          equivalentTreesPlanted: 0,
          savingsHistory: [],
        };
      }
      return taskScheduler.getCarbonSavingsData(days);
    },
  );

  // GET /api/v2/carbon/policy
  fastify.get(
    '/policy',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_READ),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Get active carbon optimization policy',
        response: {
          200: {
            type: 'object',
            properties: {
              carbonWeight: { type: 'number' },
              isActive: { type: 'boolean' },
              activePolicy: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      if (!taskScheduler) {
        return { carbonWeight: 0.2, isActive: false, activePolicy: 'None' };
      }
      return taskScheduler.getCarbonPolicyData();
    },
  );

  // PATCH /api/v2/carbon/policy
  fastify.patch(
    '/policy',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_POLICY_WRITE),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Update carbon optimization weight',
        body: zodToFastifySchema(carbonPolicyUpdateSchema),
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              carbonWeight: { type: 'number' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { carbonWeight } = request.body as { carbonWeight: number };
      if (!taskScheduler) {
        return { success: false, carbonWeight: 0 };
      }
      return taskScheduler.updateCarbonPolicy(carbonWeight);
    },
  );

  // GET /api/v2/carbon/export
  fastify.get(
    '/export',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_READ),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Export tenant carbon data in EU CSRD format',
        querystring: zodToFastifySchema(carbonReportQuerySchema),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.user?.tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          error: 'A tenant context is required for carbon compliance exports',
        });
      }

      const { from, to } =
        (request.query as { from?: string; to?: string }) || {};
      const startDate = from
        ? new Date(from)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = to ? new Date(to) : new Date();

      const records = await request.tPrisma.carbonRecord.findMany({
        where: {
          tenantId,
          recordedAt: { gte: startDate, lte: endDate },
        },
        orderBy: { recordedAt: 'asc' },
      });

      const totalEnergyKwh = records.reduce(
        (total: number, record: any) =>
          total + (record.estimatedWatts * record.durationMs) / 3_600_000_000,
        0,
      );
      const weightedIntensity = records.reduce(
        (total: number, record: any) =>
          total +
          record.carbonIntensity *
            ((record.estimatedWatts * record.durationMs) / 3_600_000_000),
        0,
      );
      const carbonIntensityGCO2KWh = totalEnergyKwh
        ? weightedIntensity / totalEnergyKwh
        : 0;
      const totalCarbonScope2EmissionsKg = records.reduce(
        (total: number, record: any) => total + record.estimatedGco2eq / 1000,
        0,
      );

      const csvCell = (value: string | number) =>
        `"${String(value).replace(/"/g, '""')}"`;
      const csv = [
        [
          'TenantID',
          'PeriodStart',
          'PeriodEnd',
          'TotalEnergyKWh',
          'CarbonIntensityGCO2KWh',
          'TotalCarbonScope2EmissionsKg',
        ],
        [
          tenantId,
          startDate.toISOString(),
          endDate.toISOString(),
          totalEnergyKwh.toFixed(6),
          carbonIntensityGCO2KWh.toFixed(6),
          totalCarbonScope2EmissionsKg.toFixed(6),
        ],
      ]
        .map((row) => row.map(csvCell).join(','))
        .join('\n');

      return reply
        .header('Content-Type', 'text/csv')
        .header(
          'Content-Disposition',
          `attachment; filename="carbon-compliance-${
            startDate.toISOString().split('T')[0]
          }-to-${endDate.toISOString().split('T')[0]}.csv"`,
        )
        .send(csv);
    },
  );

  // GET /api/v2/carbon/report
  fastify.get(
    '/report',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requirePermission(Permissions.CARBON_READ),
      ],
      schema: {
        tags: ['carbon'],
        summary: 'Get auditable tenant carbon report',
        querystring: zodToFastifySchema(carbonReportQuerySchema),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { from, to, format } =
        (request.query as { from?: string; to?: string; format?: string }) ||
        {};

      const startDate = from
        ? new Date(from)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = to ? new Date(to) : new Date();

      // Query database
      const records = await request.tPrisma.carbonRecord.findMany({
        where: {
          recordedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: {
          recordedAt: 'asc',
        },
      });

      // Get task types by querying Task model
      const taskIds = records.map((r: any) => r.taskId);
      const tasks = await request.tPrisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, type: true },
      });
      const taskTypeMap = new Map(tasks.map((t: any) => [t.id, t.type]));

      const recordWithTaskType = records.map((r: any) => ({
        ...r,
        taskType: taskTypeMap.get(r.taskId) || 'unknown',
      }));

      // Summarize
      let totalGco2eq = 0;
      let totalBaselineGco2eq = 0;
      let totalSavedGco2eq = 0;
      let totalDurationMs = 0;
      let deferredTasks = 0;

      for (const r of recordWithTaskType) {
        totalGco2eq += r.estimatedGco2eq;
        totalBaselineGco2eq +=
          r.baselineGco2eq !== null ? r.baselineGco2eq : r.estimatedGco2eq;
        totalSavedGco2eq += r.carbonSavedGco2eq || 0;
        totalDurationMs += r.durationMs;
        if (r.wasDeferred) {
          deferredTasks += 1;
        }
      }

      // Per-workload breakdown
      const workloadBreakdown: Record<
        string,
        {
          totalGco2eq: number;
          totalSavedGco2eq: number;
          totalDurationMs: number;
          taskCount: number;
        }
      > = {};

      for (const r of recordWithTaskType) {
        const type = r.taskType;
        if (!workloadBreakdown[type]) {
          workloadBreakdown[type] = {
            totalGco2eq: 0,
            totalSavedGco2eq: 0,
            totalDurationMs: 0,
            taskCount: 0,
          };
        }
        workloadBreakdown[type].totalGco2eq += r.estimatedGco2eq;
        workloadBreakdown[type].totalSavedGco2eq += r.carbonSavedGco2eq || 0;
        workloadBreakdown[type].totalDurationMs += r.durationMs;
        workloadBreakdown[type].taskCount += 1;
      }

      // Check format
      const isCsv = format === 'csv' || request.headers.accept === 'text/csv';

      if (isCsv) {
        const csvHeaders = [
          'Task ID',
          'Task Type',
          'Region',
          'Node ID',
          'Carbon Intensity (gCO2eq/kWh)',
          'Duration (ms)',
          'Estimated gCO2eq',
          'Estimated Watts',
          'Was Deferred',
          'Baseline gCO2eq',
          'Carbon Saved gCO2eq',
          'Recorded At',
        ].join(',');

        const csvRows = recordWithTaskType.map((r: any) => {
          return [
            r.taskId,
            r.taskType,
            r.region,
            r.nodeId,
            r.carbonIntensity,
            r.durationMs,
            r.estimatedGco2eq.toFixed(4),
            r.estimatedWatts,
            r.wasDeferred ? 'TRUE' : 'FALSE',
            r.baselineGco2eq !== null ? r.baselineGco2eq.toFixed(4) : '',
            r.carbonSavedGco2eq !== null ? r.carbonSavedGco2eq.toFixed(4) : '',
            r.recordedAt.toISOString(),
          ]
            .map((val) => `"${String(val).replace(/"/g, '""')}"`)
            .join(',');
        });

        const csvContent = [csvHeaders, ...csvRows].join('\n');

        reply
          .header('Content-Type', 'text/csv')
          .header(
            'Content-Disposition',
            `attachment; filename="carbon-report-${
              startDate.toISOString().split('T')[0]
            }-to-${endDate.toISOString().split('T')[0]}.csv"`,
          )
          .send(csvContent);
        return;
      }

      // Return JSON
      return {
        summary: {
          totalGco2eq,
          totalBaselineGco2eq,
          totalSavedGco2eq,
          totalDurationMs,
          totalTasks: recordWithTaskType.length,
          deferredTasks,
        },
        workloads: recordWithTaskType,
        breakdown: workloadBreakdown,
      };
    },
  );
}
