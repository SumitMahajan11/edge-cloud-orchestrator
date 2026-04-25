import { EdgeNode, Task, createLogger, ScoreWeights, tracer } from '@edgecloud/shared-kernel';
import { MetricsCollector } from '@edgecloud/observability';
import path from 'path';
import { SchedulingPredictor } from './predictor';
import { MultiObjectiveScorer, NodeScoreResult } from './scoring';
import { ModelRegistry } from './registry';
import { DriftDetector } from './drift-detector';
import { SpanStatusCode } from '@opentelemetry/api';

const logger = createLogger('ml-scheduler-orchestrator');

export class MLScheduler {
  private scorer: MultiObjectiveScorer;
  private isMLDisabled: boolean = false;

  constructor(
    private predictor: SchedulingPredictor,
    private registry: ModelRegistry,
    private driftDetector: DriftDetector,
    private metrics: MetricsCollector
  ) {
    this.scorer = new MultiObjectiveScorer(this.predictor);
  }

  async schedule(task: Task, nodes: EdgeNode[], weights: ScoreWeights): Promise<{
    decision: NodeScoreResult;
    explanation: any;
    candidateNodes: { nodeId: string; score: number; reason: string }[];
    modelVersion: string | null;
    fallbackUsed: boolean;
  } | null> {
    return await tracer.startActiveSpan('ml:node_score_calculation', async (span) => {
      const startTime = Date.now();
      const TIMEOUT_MS = 50;

      span.setAttribute('task.id', task.id);
      span.setAttribute('nodes.count', nodes.length);

      // 1. Check if ML is disabled due to drift
      if (this.driftDetector.isDrifting()) {
        span.setAttribute('ml.drift_detected', true);
        logger.warn('ML scheduling suppressed due to model drift');
        this.metrics.recordMLFallback('drift', 'load-balanced');
        const fallback = this.ruleBasedFallback(task, nodes);
        if (!fallback) {
          span.end();
          return null;
        }
        span.end();
        return {
          decision: fallback,
          explanation: { top_features: [] },
          candidateNodes: nodes.map(n => ({ nodeId: n.id, score: 0, reason: 'fallback' })),
          modelVersion: this.predictor.getVersion(),
          fallbackUsed: true
        };
      }

      try {
        // 2. Attempt ML-based scoring with timeout
        const predictionPromise = this.scorer.rankNodes(task, nodes);
        
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('ML_TIMEOUT')), TIMEOUT_MS)
        );

        const rankedNodes = await Promise.race([predictionPromise, timeoutPromise]) as NodeScoreResult[];

        if (!rankedNodes || rankedNodes.length === 0) {
          throw new Error('ML_INVALID_SCORE');
        }

        const bestNodeResult = rankedNodes[0];
        const bestNode = nodes.find(n => n.id === bestNodeResult.nodeId)!;

        // Calculate feature importance for the selected node
        const importance = await this.predictor.getFeatureImportance(task, bestNode);

        const duration = Date.now() - startTime;
        this.metrics.recordSchedulingDecision('ml-optimized', 'success', duration / 1000);
        
        span.setAttribute('ml.decision.nodeId', bestNodeResult.nodeId);
        span.setAttribute('ml.decision.score', bestNodeResult.score);
        span.setStatus({ code: SpanStatusCode.OK });

        return {
          decision: bestNodeResult,
          explanation: { top_features: importance.slice(0, 5) },
          candidateNodes: rankedNodes.slice(0, 5).map(r => ({ nodeId: r.nodeId, score: r.score, reason: 'ml-score' })),
          modelVersion: this.predictor.getVersion(),
          fallbackUsed: false
        };

      } catch (error: any) {
        const reason = error.message === 'ML_TIMEOUT' ? 'timeout' : 'error';
        span.setAttribute('ml.fallback_reason', reason);
        if (reason === 'timeout') {
          span.setAttribute('ml.timeout_ms', TIMEOUT_MS);
        }
        
        logger.warn({ reason, error: error.message }, 'ML scheduling failed, falling back to rule-based');
        
        // Record fallback metric
        this.metrics.recordMLFallback(reason, 'load-balanced');
        
        // 3. Mandatory Fallback Strategy: Load Balanced
        const fallback = this.ruleBasedFallback(task, nodes);
        if (!fallback) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'No nodes available for fallback' });
          return null;
        }

        span.setStatus({ code: SpanStatusCode.OK, message: `Fallback used: ${reason}` });

        return {
          decision: fallback,
          explanation: { top_features: [] },
          candidateNodes: nodes.map(n => ({ nodeId: n.id, score: 0, reason: 'fallback' })),
          modelVersion: this.predictor.getVersion(),
          fallbackUsed: true
        };
      } finally {
        span.end();
      }
    });
  }


  private ruleBasedFallback(task: Task, nodes: EdgeNode[]): NodeScoreResult | null {
    if (nodes.length === 0) return null;

    // Rule-based "Load Balanced": sort by tasksRunning (as seen in shared-kernel)
    const sorted = [...nodes].sort((a, b) => a.tasksRunning - b.tasksRunning);
    const best = sorted[0];

    return {
      nodeId: best.id,
      score: 1.0, // Placeholder score for fallback
      components: {
        latency: 1 - Math.min(best.latency / 500, 1),
        cpu: 1 - best.cpuUsage / 100,
        memory: 1 - best.memoryUsage / 100,
        cost: 0.5,
        network: 0.5,
        mlPrediction: 0.5,
        health: best.status === 'ONLINE' ? 1.0 : 0.0,
      }
    };
  }

  async checkHotSwap(): Promise<void> {
    const activeVersion = await this.registry.getActiveModel();
    if (activeVersion && activeVersion.version !== this.predictor.getVersion()) {
      logger.info({ newVersion: activeVersion.version }, 'Hot-swapping ML model');
      await this.predictor.loadModel(path.join(process.cwd(), 'models'), activeVersion.version);
    }
  }
}
