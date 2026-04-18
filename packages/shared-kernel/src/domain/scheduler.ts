import { DomainNode, DomainTask, ScoreWeights } from '../types/domain';

export type MLPredictor = (node: DomainNode, task: DomainTask) => Promise<number>;

export interface SelectNodeOptions {
  weights: ScoreWeights;
  predictor?: MLPredictor;
  policy?: string;
}

export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulingError';
  }
}

export async function selectNode(
  nodes: DomainNode[],
  task: DomainTask,
  options: SelectNodeOptions
): Promise<DomainNode> {
  const { policy = task.policy, weights, predictor } = options;

  if (nodes.length === 0) {
    throw new SchedulingError('No candidate nodes available for scheduling');
  }

  // Filter out maintenance nodes (invariant)
  const availableNodes = nodes.filter(n => n.status === 'ONLINE');
  if (availableNodes.length === 0) {
    throw new SchedulingError('All candidate nodes are OFFLINE or in MAINTENANCE');
  }

  switch (policy) {
    case 'latency-aware': {
      // Should select lowest RTT when CPU < 80%
      const candidates = availableNodes.filter(n => (n.cpuUsage || 0) < 80);
      
      if (candidates.length > 0) {
        return candidates.sort((a, b) => (a.latency || 999) - (b.latency || 999))[0];
      }
      
      // Fallback to round-robin (weighted by least tasks) when all nodes exceed CPU threshold
      return availableNodes.sort((a, b) => a.tasksRunning - b.tasksRunning)[0];
    }

    case 'cost-aware': {
      // Should select cheapest node with cross-region cost premium (20%)
      // and latency as tie-breaker
      return availableNodes.sort((a, b) => {
        const getEffectiveCost = (node: DomainNode) => {
          let cost = node.costPerHour || 0;
          // Apply 20% premium if cross-region (assuming task has preferred region or comparing to a reference)
          // For simplicity in this logic, we compare against a common reference or assume region 'global' is base
          if (node.region && node.region !== 'us-east-1') { // us-east-1 is base region
            cost *= 1.2;
          }
          return cost;
        };

        const costA = getEffectiveCost(a);
        const costB = getEffectiveCost(b);

        if (Math.abs(costA - costB) < 0.001) {
          return (a.latency || 999) - (b.latency || 999);
        }
        return costA - costB;
      })[0];
    }

    case 'ml-optimized': {
      const scoredNodes = await Promise.all(
        availableNodes.map(async (node) => ({
          node,
          score: await calculateNodeScore(node, task, weights, predictor),
        }))
      );
      return scoredNodes.sort((a, b) => b.score - a.score)[0].node;
    }

    case 'load-balanced':
    default: {
      // Should compute weighted score correctly: cpu*0.4 + memory*0.3 + latency*0.3
      // Lower score is better for load balancing
      return availableNodes.sort((a, b) => {
        const score = (n: DomainNode) => 
          (n.cpuUsage || 0) * 0.4 + 
          (n.memoryUsage || 0) * 0.3 + 
          (n.latency || 0) * 0.3;
        return score(a) - score(b);
      })[0];
    }
  }
}

export async function calculateNodeScore(
  node: DomainNode,
  task: DomainTask,
  weights: ScoreWeights,
  predictor?: MLPredictor
): Promise<number> {
  const latencyScore = node.latency ? 1 - Math.min(node.latency / 500, 1) : 0.5;
  const cpuScore = node.cpuUsage !== undefined ? 1 - node.cpuUsage / 100 : 0.5;
  const memoryScore = node.memoryUsage !== undefined ? 1 - node.memoryUsage / 100 : 0.5;
  const costScore = node.costPerHour ? 1 - Math.min(node.costPerHour, 1) : 0.5;
  const networkScore = node.bandwidthInMbps ? Math.min(node.bandwidthInMbps / 1000, 1) : 0.5;
  
  const mlScore = predictor ? await predictor(node, task) : 0.5;
  const healthScore = node.status === 'ONLINE' ? 1.0 : 0.0;

  return (
    weights.latency * latencyScore +
    weights.cpu * cpuScore +
    weights.memory * memoryScore +
    weights.cost * costScore +
    weights.network * networkScore +
    weights.ml * mlScore +
    weights.health * healthScore
  );
}

export function validateWeights(weights: ScoreWeights): boolean {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1.0) < 0.01;
}
