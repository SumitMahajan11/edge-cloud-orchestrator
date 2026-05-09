import { EdgeNode, Task, createLogger, ScoreWeights, tracer, IMetricsCollector } from '@edgecloud/shared-kernel';
import path from 'path';
import { SchedulingPredictor } from './predictor';
import { MultiObjectiveScorer, NodeScoreResult } from './scoring';
import { ModelRegistry } from './registry';
import { DriftDetector } from './drift-detector';
import { SpanStatusCode } from '@opentelemetry/api';
import { OutcomeCollector } from './feedback/outcome-collector';
import { GridCarbonClient } from './carbon/grid-client';

const logger = createLogger('ml-scheduler-orchestrator');

export class MLScheduler {
  private scorer: MultiObjectiveScorer;

  constructor(
    private predictor: SchedulingPredictor,
    private registry: ModelRegistry,
    private driftDetector: DriftDetector,
    private metrics: IMetricsCollector,
    private outcomeCollector: OutcomeCollector,
    private carbonClient?: GridCarbonClient
  ) {
    this.scorer = new MultiObjectiveScorer(this.predictor);
  }

  async schedule(task: Task, nodes: EdgeNode[], _weights: ScoreWeights): Promise<{
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

      // 1. Policy-specific adjustments
      let carbonWeight = 0.0;
      if (task.policy === 'CARBON_OPTIMIZED') {
        carbonWeight = 0.4;
        
        // Find fastest and lowest-carbon nodes for trade-off calculation
        const firstNode = nodes[0]!;
        const fastestNode = nodes.reduce((prev, curr) => (curr.latency < prev.latency ? curr : prev), firstNode);
        const lowestCarbonNode = nodes.reduce((prev, curr) => 
          ((curr.carbonIntensity || 1000) < (prev.carbonIntensity || 1000) ? curr : prev), firstNode);
          
        if (lowestCarbonNode.latency > fastestNode.latency * 2) {
          logger.info('Carbon vs Latency trade-off: Capping carbon weight at 0.2');
          carbonWeight = 0.2;
        }
      }

      // 2. Fetch real-time carbon data if client is available
      if (this.carbonClient) {
        await Promise.all(nodes.map(async (node) => {
          if (node.region) {
            const zone = this.carbonClient!.mapRegionToZone(node.region);
            node.carbonIntensity = await this.carbonClient!.getCarbonIntensity(zone);
          }
        }));
      }

      // 3. Apply weights (save original for restoration)
      const originalWeights = { ...(this.scorer as any).weights };
      if (carbonWeight > 0) {
        (this.scorer as any).weights = { ...originalWeights, carbon: carbonWeight };
      }

      try {
        // 4. Contextual Bandit Layer: Epsilon-Greedy
        const EXPLORE_RATE = 0.1; // 10%
        const explore = Math.random() < EXPLORE_RATE;
        this.metrics.recordMetric('ml_bandit_explore_rate', EXPLORE_RATE);

        if (explore) {
          span.setAttribute('ml.bandit.mode', 'explore');
          logger.info('Bandit: Exploring (picking random node)');
          const eligibleNodes = nodes.filter(n => n.status === 'ONLINE');
          if (eligibleNodes.length > 0) {
            const randomNode = eligibleNodes[Math.floor(Math.random() * eligibleNodes.length)]!;
            const importance = await this.predictor.getFeatureImportance(task, randomNode);
            
            span.end();
            return {
              decision: { nodeId: randomNode.id, score: 1.0, components: {} as any },
              explanation: { top_features: importance.slice(0, 5), bandit: 'explore' },
              candidateNodes: [{ nodeId: randomNode.id, score: 1.0, reason: 'bandit-explore' }],
              modelVersion: this.predictor.getVersion(),
              fallbackUsed: false
            };
          }
        }

        span.setAttribute('ml.bandit.mode', 'exploit');
        // 3. Attempt ML-based scoring with bandit blending
        const predictionPromise = this.scorer.rankNodes(task, nodes);
        
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('ML_TIMEOUT')), TIMEOUT_MS)
        );

        const rankedNodes = await Promise.race([predictionPromise, timeoutPromise]) as NodeScoreResult[];

        if (!rankedNodes || rankedNodes.length === 0) {
          throw new Error('ML_INVALID_SCORE');
        }

        const duration = Date.now() - startTime;
        
        // 4. Blend Bandit Reward into final score
        // finalScore = 0.7 * xgboostScore + 0.3 * banditReward
        const blendedNodes = await Promise.all(rankedNodes.map(async (res) => {
          const reward = await this.outcomeCollector.getReward(res.nodeId);
          return {
            ...res,
            score: 0.7 * res.score + 0.3 * reward,
            banditReward: reward
          };
        }));
        
        blendedNodes.sort((a, b) => b.score - a.score);
        const bestNodeResult = blendedNodes[0]!;
        const bestNode = nodes.find(n => n.id === bestNodeResult.nodeId)!;

        // Calculate feature importance for the selected node
        const importance = await this.predictor.getFeatureImportance(task, bestNode);

        this.metrics.recordSchedulingDecision('ml-optimized', 'success', duration / 1000);
        
        // 5. Calculate carbon metrics
        const firstNodeForMetric = nodes[0]!;
        const fastestNodeForMetric = nodes.reduce((prev, curr) => (curr.latency < prev.latency ? curr : prev), firstNodeForMetric);
        const naiveCarbon = fastestNodeForMetric.carbonIntensity || 400;
        const actualCarbon = bestNode.carbonIntensity || 400;
        const savedCarbon = naiveCarbon - actualCarbon;
        this.metrics.recordCarbonMetrics(actualCarbon, savedCarbon);

        span.setAttribute('ml.decision.nodeId', bestNodeResult.nodeId);
        span.setAttribute('ml.decision.score', bestNodeResult.score);
        span.setAttribute('ml.carbon.intensity', actualCarbon);
        span.setAttribute('ml.carbon.saved', savedCarbon);
        span.setStatus({ code: SpanStatusCode.OK });

        // Restore original weights
        (this.scorer as any).weights = originalWeights;

        span.end();
        return {
          decision: bestNodeResult,
          explanation: { top_features: importance.slice(0, 5), banditReward: (bestNodeResult as any).banditReward },
          candidateNodes: blendedNodes.slice(0, 5).map((n) => ({
            nodeId: n.nodeId,
            score: n.score,
            reason: n.nodeId === bestNodeResult.nodeId ? 'best-match' : 'alternative',
          })),
          modelVersion: this.predictor.getVersion(),
          fallbackUsed: false,
        };

      } catch (error: any) {
        // Restore original weights even on error
        (this.scorer as any).weights = originalWeights;

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


  private ruleBasedFallback(_task: Task, nodes: EdgeNode[]): NodeScoreResult | null {
    // 1. Filter out unavailable nodes
    const eligibleNodes = nodes.filter(n => n.status !== 'OFFLINE' && n.status !== 'DRAINING');
    
    if (eligibleNodes.length === 0) return null;

    // 2. Sort by:
    //    a. CPU Availability (1 - cpuUsage/100) -> higher is better
    //    b. Memory Availability (1 - memoryUsage/100) -> higher is better
    const sorted = [...eligibleNodes].sort((a, b) => {
      // Ascending usage = Descending availability
      const cpuDiff = a.cpuUsage - b.cpuUsage;
      if (Math.abs(cpuDiff) > 1) return cpuDiff;
      
      return a.memoryUsage - b.memoryUsage;
    });
    
    const best = sorted[0];

    return {
      nodeId: best!.id,
      score: 1.0, // Placeholder score for fallback
      components: {
        latency: 1 - Math.min(best!.latency / 500, 1),
        cpu: 1 - best!.cpuUsage / 100,
        memory: 1 - best!.memoryUsage / 100,
        cost: 0.5,
        network: 0.5,
        mlPrediction: 0.5,
        health: best!.status === 'ONLINE' ? 1.0 : 0.0,
        carbon: 0.5
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
