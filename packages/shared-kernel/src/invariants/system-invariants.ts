/**
 * System Invariants for Edge-Cloud Orchestrator
 * This file defines the consistency rules that the system must maintain.
 */

export interface InvariantResult {
  invariantName: string;
  isViolated: boolean;
  violations: any[];
  description: string;
}

export const SYSTEM_INVARIANTS = {
  TASK_EXECUTION_SYNC: {
    name: 'TASK_EXECUTION_SYNC',
    description: 'Every RUNNING task must have exactly one TaskExecution with status=RUNNING.',
    query: `
      SELECT t.id, t.name, COUNT(te.id) as running_executions
      FROM tasks t
      LEFT JOIN task_executions te ON t.id = te."taskId" AND te.status = 'RUNNING'
      WHERE t.status = 'RUNNING'
      GROUP BY t.id, t.name
      HAVING COUNT(te.id) != 1
    `
  },
  SCHEDULED_NODE_ONLINE: {
    name: 'SCHEDULED_NODE_ONLINE',
    description: 'Every SCHEDULED task must be assigned to a node that is ONLINE.',
    query: `
      SELECT t.id, t.name, t."nodeId", n.status as node_status
      FROM tasks t
      JOIN edge_nodes n ON t."nodeId" = n.id
      WHERE t.status = 'SCHEDULED' AND n.status != 'ONLINE'
    `
  },
  NODE_RESOURCE_RESERVATION: {
    name: 'NODE_RESOURCE_RESERVATION',
    description: "A node's reserved resources must not exceed its total resources.",
    query: `
      SELECT n.id, n.name, n."cpuCores", SUM(t_cpu) as reserved_cpu
      FROM edge_nodes n
      JOIN (
        SELECT "nodeId", (metadata->'specs'->>'cpuCores')::numeric as t_cpu
        FROM tasks
        WHERE status = 'RUNNING'
      ) t ON n.id = t."nodeId"
      GROUP BY n.id, n.name, n."cpuCores"
      HAVING SUM(t_cpu) > n."cpuCores"
    `
  },
  TASK_ATTEMPT_MONOTONIC: {
    name: 'TASK_ATTEMPT_MONOTONIC',
    description: 'Every TaskExecution must have attemptNumber >= 1 and be monotonically increasing.',
    query: `
      SELECT te.id, te."taskId", te."attemptNumber"
      FROM task_executions te
      WHERE te."attemptNumber" < 1
      OR EXISTS (
        SELECT 1 FROM task_executions te2
        WHERE te."taskId" = te2."taskId"
        AND te.id != te2.id
        AND te."attemptNumber" = te2."attemptNumber"
      )
    `
  },
  TENANT_ISOLATION: {
    name: 'TENANT_ISOLATION',
    description: "No tenant's data should be visible to another tenant.",
    query: `
      SELECT 'tasks' as table_name, id FROM tasks WHERE "tenantId" IS NULL
      UNION ALL
      SELECT 'edge_nodes' as table_name, id FROM edge_nodes WHERE "tenantId" IS NULL
      UNION ALL
      SELECT 'task_executions' as table_name, id FROM task_executions WHERE "tenantId" IS NULL
      UNION ALL
      SELECT 'audit_logs' as table_name, id FROM audit_logs WHERE "tenantId" IS NULL
    `
  },
  WEBHOOK_TASK_REFERENCE: {
    name: 'WEBHOOK_TASK_REFERENCE',
    description: 'Every completed WebhookDelivery must reference a valid task.',
    query: `
      SELECT id, payload
      FROM webhook_deliveries
      WHERE status = 'COMPLETED'
      AND (payload->>'taskId') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id = (payload->>'taskId')
      )
    `
  }
};

export const SAFE_FIXES = {
  STUCK_SCHEDULING: {
    name: 'STUCK_SCHEDULING',
    description: 'Tasks stuck in SCHEDULED status for > 10 minutes.',
    query: `
      SELECT id FROM tasks
      WHERE status = 'SCHEDULED'
      AND "updatedAt" < NOW() - INTERVAL '10 minutes'
    `,
    fix: async (prisma: any, ids: string[]) => {
      return prisma.task.updateMany({
        where: { id: { in: ids } },
        data: { status: 'PENDING', reason: 'Reset from stuck scheduling state' }
      });
    }
  },
  GHOST_NODES: {
    name: 'GHOST_NODES',
    description: 'Edge nodes with ONLINE status but no heartbeat for > 5 minutes.',
    query: `
      SELECT id FROM edge_nodes
      WHERE status = 'ONLINE'
      AND "lastHeartbeat" < NOW() - INTERVAL '5 minutes'
    `,
    fix: async (prisma: any, ids: string[]) => {
      return prisma.$transaction(async (tx: any) => {
        // Mark as OFFLINE
        await tx.edgeNode.updateMany({
          where: { id: { in: ids } },
          data: { status: 'OFFLINE' }
        });
        // Reassign their RUNNING tasks to PENDING
        return tx.task.updateMany({
          where: { 
            nodeId: { in: ids },
            status: 'RUNNING'
          },
          data: { status: 'PENDING', nodeId: null, reason: 'Node went offline' }
        });
      });
    }
  }
};
