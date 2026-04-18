import { createLogger } from '@edgecloud/shared-kernel';
import { MetricsCollector } from '@edgecloud/observability';

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

  constructor(private metrics: MetricsCollector) {}

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
      }
    } else if (this.rollingMAE >= this.WARN_THRESHOLD) {
      logger.warn({ mae: this.rollingMAE, threshold: this.WARN_THRESHOLD }, 'Model drift warning: Performance degrading.');
      this.mlSuppressed = false; // Re-enable if it drops back below FATAL but stays in WARN (optional policy)
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
}
