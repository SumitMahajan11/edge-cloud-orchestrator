import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { WebSocketManager } from './websocket-manager';

export class NodeHealthScorer {
  private prisma: PrismaClient;
  private wsManager: WebSocketManager;
  private logger: Logger;
  private readonly WINDOW_SIZE = 100;
  private readonly ALPHA = 2 / (this.WINDOW_SIZE + 1);

  constructor(
    prisma: PrismaClient,
    wsManager: WebSocketManager,
    logger: Logger,
  ) {
    this.prisma = prisma;
    this.wsManager = wsManager;
    this.logger = logger;
  }

  /**
   * Record the outcome of a task execution on a node and update health scores.
   */
  public async recordTaskOutcome(
    nodeId: string,
    tenantId: string,
    outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'OOM',
    latencyMs: number,
  ): Promise<void> {
    this.logger.info(
      { nodeId, tenantId, outcome, latencyMs },
      'Recording task outcome for health evaluation'
    );

    // Fetch baseline latency from node
    const node = await this.prisma.edgeNode.findUnique({
      where: { id: nodeId },
    });

    if (!node) {
      this.logger.warn({ nodeId }, 'Cannot record task outcome: Edge node not found');
      return;
    }

    const baselineLatency = node.latency || 100;

    // Load existing health score or initialize a new one
    const health = await this.prisma.nodeHealthScore.findUnique({
      where: { nodeId },
    });

    const successValue = outcome === 'SUCCESS' ? 1.0 : 0.0;

    let successRate = 1.0;
    let avgLatencyMs = latencyMs;
    let latencyDeviation = 0.0;
    let currentMultiplier = 1.0;
    let wasAnomaly = false;

    if (health) {
      successRate = health.successRate * (1 - this.ALPHA) + successValue * this.ALPHA;
      currentMultiplier = health.penaltyMultiplier;
      wasAnomaly = health.isAnomaly;

      if (outcome === 'SUCCESS') {
        const deviation = Math.abs(latencyMs - health.avgLatencyMs);
        latencyDeviation = health.latencyDeviation * (1 - this.ALPHA) + deviation * this.ALPHA;
        avgLatencyMs = health.avgLatencyMs * (1 - this.ALPHA) + latencyMs * this.ALPHA;
      } else {
        avgLatencyMs = health.avgLatencyMs;
        latencyDeviation = health.latencyDeviation;
      }
    } else {
      // First observation
      successRate = successValue;
      avgLatencyMs = latencyMs;
      latencyDeviation = 0.0;
    }

    // Determine if anomaly thresholds are breached
    const isSuccessAnomaly = successRate < 0.85;
    const isLatencyAnomaly = avgLatencyMs > 3 * baselineLatency;
    const isAnomaly = isSuccessAnomaly || isLatencyAnomaly;

    // Calculate anomaly score (0.0 to 1.0)
    const successAnomalyScore = isSuccessAnomaly ? Math.min((0.85 - successRate) / 0.85, 1.0) : 0.0;
    const latencyAnomalyScore = isLatencyAnomaly ? Math.min((avgLatencyMs - 3 * baselineLatency) / (3 * baselineLatency), 1.0) : 0.0;
    const anomalyScore = Math.min(Math.max(successAnomalyScore, latencyAnomalyScore), 1.0);

    let penaltyMultiplier = currentMultiplier;

    if (isAnomaly) {
      // Apply penalty based on severity of anomaly
      penaltyMultiplier = Math.max(1.0 - anomalyScore, 0.1);
    } else {
      // Auto-recover: increase by 5% when healthy, up to 1.0
      penaltyMultiplier = Math.min(currentMultiplier + 0.05, 1.0);
    }

    // Save/update health score in database
    await this.prisma.nodeHealthScore.upsert({
      where: { nodeId },
      update: {
        successRate,
        avgLatencyMs,
        latencyDeviation,
        anomalyScore,
        isAnomaly,
        penaltyMultiplier,
      },
      create: {
        nodeId,
        tenantId,
        successRate,
        avgLatencyMs,
        latencyDeviation,
        anomalyScore,
        isAnomaly,
        penaltyMultiplier,
      },
    });

    this.logger.debug(
      {
        nodeId,
        successRate,
        avgLatencyMs,
        isAnomaly,
        anomalyScore,
        penaltyMultiplier,
      },
      'Updated node health scores'
    );

    // Broadcast WebSocket events if anomaly state transitioned
    if (wasAnomaly !== isAnomaly) {
      const event = isAnomaly ? 'node:anomaly-detected' : 'node:anomaly-resolved';
      this.logger.info(
        { nodeId, tenantId, isAnomaly, wasAnomaly },
        `Node anomaly status transitioned. Broadcasting WS event ${event}`
      );

      this.wsManager.broadcast(
        event,
        {
          nodeId,
          tenantId,
          successRate,
          avgLatencyMs,
          anomalyScore,
          timestamp: new Date().toISOString(),
        },
        tenantId
      );
    }
  }
}
