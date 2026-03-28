import { Task, EdgeNode, TaskScore, DEFAULT_SCORE_WEIGHTS } from '@edgecloud/shared-kernel';
import { SchedulingPredictor } from './predictor';

export interface ScoreWeights {
  latency: number;
  cpu: number;
  memory: number;
  cost: number;
  network: number;
  ml: number;
  health: number;
}

export interface NodeScoreResult {
  nodeId: string;
  score: number;
  components: {
    latency: number;
    cpu: number;
    memory: number;
    cost: number;
    network: number;
    mlPrediction: number;
    health: number;
  };
}

export class MultiObjectiveScorer {
  private predictor: SchedulingPredictor;
  private weights: ScoreWeights;

  constructor(predictor: SchedulingPredictor, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS) {
    this.predictor = predictor;
    this.weights = weights;
  }

  calculateScore(task: Task, node: EdgeNode): NodeScoreResult {
    // Normalize metrics to 0-1 scale (higher is better)
    const latencyScore = this.normalizeLatency(node.latency);
    const cpuScore = this.normalizeCpuUsage(node.cpuUsage);
    const memoryScore = this.normalizeMemoryUsage(node.memoryUsage);
    const costScore = this.normalizeCost(node.costPerHour);
    const networkScore = this.calculateNetworkScore(task, node);
    const healthScore = this.normalizeHealthScore(node.healthScore);

    // ML prediction
    const mlPrediction = this.predictor.predictSuccess(task, node);

    // Weighted sum
    const score =
      this.weights.latency * latencyScore +
      this.weights.cpu * cpuScore +
      this.weights.memory * memoryScore +
      this.weights.cost * costScore +
      this.weights.network * networkScore +
      this.weights.ml * mlPrediction +
      this.weights.health * healthScore;

    return {
      nodeId: node.id,
      score,
      components: {
        latency: latencyScore,
        cpu: cpuScore,
        memory: memoryScore,
        cost: costScore,
        network: networkScore,
        mlPrediction,
        health: healthScore,
      },
    };
  }

  rankNodes(task: Task, nodes: EdgeNode[]): NodeScoreResult[] {
    const scores = nodes.map((node) => this.calculateScore(task, node));
    return scores.sort((a, b) => b.score - a.score);
  }

  selectBestNode(task: Task, nodes: EdgeNode[]): NodeScoreResult | null {
    if (nodes.length === 0) return null;
    const ranked = this.rankNodes(task, nodes);
    return ranked[0];
  }

  // Normalization functions
  private normalizeLatency(latency: number): number {
    // Lower latency is better
    // Assume 0-500ms range
    const maxLatency = 500;
    return Math.max(0, 1 - latency / maxLatency);
  }

  private normalizeCpuUsage(cpuUsage: number): number {
    // Lower CPU usage is better (more capacity available)
    return Math.max(0, 1 - cpuUsage / 100);
  }

  private normalizeMemoryUsage(memoryUsage: number): number {
    // Lower memory usage is better
    return Math.max(0, 1 - memoryUsage / 100);
  }

  private normalizeCost(costPerHour: number): number {
    // Lower cost is better
    // Assume 0-1.0 range
    const maxCost = 1.0;
    return Math.max(0, 1 - costPerHour / maxCost);
  }

  private normalizeHealthScore(healthScore: number): number {
    // Health score is already 0-1, but ensure it's bounded
    // Default to 1.0 if not provided
    if (healthScore === undefined || healthScore === null) {
      return 1.0;
    }
    return Math.max(0, Math.min(1, healthScore));
  }

  private calculateNetworkScore(task: Task, node: EdgeNode): number {
    // Consider bandwidth and geographic proximity
    const bandwidthScore = Math.min(1, node.bandwidthInMbps / 1000);
    
    // Check if node has required capabilities
    const capabilityScore = this.checkCapabilities(task, node);
    
    return (bandwidthScore + capabilityScore) / 2;
  }

  private checkCapabilities(task: Task, node: EdgeNode): number {
    // Check if node can handle the task type
    // This is a simplified check - in production, use more sophisticated matching
    const requiredCapabilities = this.getRequiredCapabilities(task.type);
    
    if (requiredCapabilities.length === 0) return 1;
    
    const nodeCapabilities = node.capabilities || [];
    const matched = requiredCapabilities.filter((cap) =>
      nodeCapabilities.includes(cap)
    ).length;
    
    return matched / requiredCapabilities.length;
  }

  private getRequiredCapabilities(taskType: string): string[] {
    const capabilityMap: Record<string, string[]> = {
      IMAGE_CLASSIFICATION: ['gpu', 'ml'],
      VIDEO_PROCESSING: ['gpu', 'high-bandwidth'],
      MODEL_INFERENCE: ['gpu', 'ml'],
      DATA_AGGREGATION: ['high-memory'],
      SENSOR_FUSION: ['low-latency'],
      ANOMALY_DETECTION: ['ml'],
      LOG_ANALYSIS: ['high-storage'],
      CUSTOM: [],
    };
    
    return capabilityMap[taskType] || [];
  }
}
