import { createLogger, IMetricsCollector } from '@edgecloud/shared-kernel';
import { PrismaClient } from '@prisma/client';

const logger = createLogger('ml-drift-detector');

export interface PredictionOutcome {
  taskId: string;
  nodeId: string;
  modelVersion: string;
  predictedScore: number;
  actualScore: number;
  timestamp: Date;
}

export class DriftDetector {
  private rollingMAE: number = 0;
  private readonly windowSize = 100;
  private outcomes: PredictionOutcome[] = [];
  private readonly WARN_THRESHOLD = 0.3;
  private readonly FATAL_THRESHOLD = 0.5;
  private mlSuppressed: boolean = false;

  private onDriftCallback?: (mae: number) => void;

  constructor(
    private metrics: IMetricsCollector,
    private prisma?: PrismaClient
  ) {}

  onDrift(callback: (mae: number) => void): void {
    this.onDriftCallback = callback;
  }

  recordOutcome(outcome: PredictionOutcome): void {
    this.outcomes.push(outcome);
    if (this.outcomes.length > this.windowSize) {
      this.outcomes.shift();
    }

    this.calculateMAE();
    this.metrics.updateMLDrift(outcome.modelVersion, this.rollingMAE);

    if (this.rollingMAE >= this.FATAL_THRESHOLD) {
      if (!this.mlSuppressed) {
        logger.error({ mae: this.rollingMAE, threshold: this.FATAL_THRESHOLD }, 'CRITICAL DRIFT: ML model performance degraded above fatal threshold. Disabling ML scheduler.');
        this.mlSuppressed = true;
        this.onDriftCallback?.(this.rollingMAE);
      }
    } else if (this.rollingMAE >= this.WARN_THRESHOLD) {
      logger.warn({ mae: this.rollingMAE, threshold: this.WARN_THRESHOLD }, 'Model drift warning: Performance degrading. Triggering retraining.');
      this.onDriftCallback?.(this.rollingMAE);
      this.mlSuppressed = false; 
    } else {
      this.mlSuppressed = false;
    }
  }

  private calculateMAE(): void {
    if (this.outcomes.length === 0) return;

    const sumAbsoluteError = this.outcomes.reduce((acc, curr) => {
      return acc + Math.abs(curr.predictedScore - curr.actualScore);
    }, 0);

    this.rollingMAE = sumAbsoluteError / this.outcomes.length;
  }

  getMAE(): number {
    return this.rollingMAE;
  }

  isDrifting(): boolean {
    return this.mlSuppressed;
  }

  async getState() {
    if (!this.prisma) {
      return {
        driftScore: this.rollingMAE,
        isDrifting: this.mlSuppressed,
        lastCheckedAt: new Date().toISOString(),
        featureDrift: {
          latency: 0,
          cpuUsage: 0,
          memoryUsage: 0
        },
        recommendation: this.rollingMAE >= this.FATAL_THRESHOLD ? 'RETRAIN' : 'STABLE'
      };
    }

    try {
      const baseline = await this.prisma.outcomeLog.findMany({
        take: 100,
        orderBy: { timestamp: 'asc' }
      });

      const current = await this.prisma.outcomeLog.findMany({
        take: 50,
        orderBy: { timestamp: 'desc' }
      });

      if (!baseline || baseline.length < 100 || !current || current.length === 0) {
        return {
          driftScore: 0,
          isDrifting: false,
          lastCheckedAt: new Date().toISOString(),
          featureDrift: {
            latency: 0,
            cpuUsage: 0,
            memoryUsage: 0
          },
          recommendation: 'INSUFFICIENT_DATA'
        };
      }

      const getMean = (data: any[], field1: string, field2: string): number => {
        let sum = 0;
        let count = 0;
        for (const item of data) {
          const val = item[field1] !== undefined ? item[field1] : item[field2];
          if (typeof val === 'number') {
            sum += val;
            count++;
          }
        }
        return count > 0 ? sum / count : 0;
      };

      const baselineCpu = getMean(baseline, 'actualCpuUsage', 'predictedCpuUsage');
      const currentCpu = getMean(current, 'actualCpuUsage', 'predictedCpuUsage');
      const cpuDrift = Math.abs(currentCpu - baselineCpu);

      const baselineMem = getMean(baseline, 'actualMemoryUsage', 'predictedMemoryUsage');
      const currentMem = getMean(current, 'actualMemoryUsage', 'predictedMemoryUsage');
      const memDrift = Math.abs(currentMem - baselineMem);

      const baselineLat = getMean(baseline, 'actualLatencyMs', 'actualLatency');
      const currentLat = getMean(current, 'actualLatencyMs', 'actualLatency');
      const latencyDrift = Math.abs(currentLat - baselineLat) / 100;

      const driftScore = Math.max(cpuDrift, memDrift, latencyDrift);
      const isDrifting = driftScore >= 0.25;
      
      let recommendation = 'STABLE';
      if (driftScore >= 0.25) {
        recommendation = 'RETRAIN';
      } else if (driftScore >= 0.1) {
        recommendation = 'WARNING';
      }

      return {
        driftScore,
        isDrifting,
        lastCheckedAt: new Date().toISOString(),
        featureDrift: {
          latency: latencyDrift,
          cpuUsage: cpuDrift,
          memoryUsage: memDrift
        },
        recommendation
      };
    } catch (err) {
      return {
        driftScore: this.rollingMAE,
        isDrifting: this.mlSuppressed,
        lastCheckedAt: new Date().toISOString(),
        featureDrift: {
          latency: 0,
          cpuUsage: 0,
          memoryUsage: 0
        },
        recommendation: 'STABLE'
      };
    }
  }
}
