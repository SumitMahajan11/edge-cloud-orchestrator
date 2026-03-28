/**
 * Cold Start Handler for New Nodes
 * 
 * Problem: New nodes have no historical data, making ML scheduling weak
 * Solution: Hybrid approach that gradually transitions from heuristic to ML
 * 
 * Phases:
 * 1. Cold Start (0-10 tasks): Use static heuristics
 * 2. Warm Up (10-50 tasks): Weighted combination
 * 3. Normal (50+ tasks): Full ML scheduling
 */

import Redis from 'ioredis';
import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// Types
// ============================================================================

export type ColdStartPhase = 'cold' | 'warm' | 'normal';

export interface NodeColdStartState {
  nodeId: string;
  phase: ColdStartPhase;
  tasksCompleted: number;
  tasksFailed: number;
  avgExecutionTime: number;
  successRate: number;
  mlConfidence: number; // 0-1
  joinedAt: Date;
  lastTaskAt?: Date;
}

export interface ColdStartConfig {
  coldPhaseThreshold: number; // Tasks to exit cold phase
  warmPhaseThreshold: number; // Tasks to exit warm phase
  minConfidenceForML: number; // ML confidence threshold
  explorationRate: number; // Probability to explore (try new node)
}

export interface SchedulingDecision {
  nodeId: string;
  algorithm: 'heuristic' | 'ml' | 'hybrid';
  confidence: number;
  reason: string;
  estimatedDuration: number;
  riskScore: number; // 0-1, higher = riskier
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: ColdStartConfig = {
  coldPhaseThreshold: 10,
  warmPhaseThreshold: 50,
  minConfidenceForML: 0.7,
  explorationRate: 0.2, // 20% chance to try new node
};

const REDIS_KEYS = {
  nodeState: (nodeId: string) => `coldstart:node:${nodeId}`,
  globalStats: 'coldstart:global',
};

// ============================================================================
// ColdStartHandler
// ============================================================================

export class ColdStartHandler extends EventEmitter {
  private redis: Redis;
  private prisma: PrismaClient;
  private logger: Logger;
  private config: ColdStartConfig;

  constructor(
    redis: Redis,
    prisma: PrismaClient,
    logger: Logger,
    config: Partial<ColdStartConfig> = {}
  ) {
    super();
    this.redis = redis;
    this.prisma = prisma;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize cold start state for a new node
   */
  async initializeNode(nodeId: string): Promise<NodeColdStartState> {
    const state: NodeColdStartState = {
      nodeId,
      phase: 'cold',
      tasksCompleted: 0,
      tasksFailed: 0,
      avgExecutionTime: 0,
      successRate: 0,
      mlConfidence: 0,
      joinedAt: new Date(),
    };

    await this.saveNodeState(state);

    this.logger.info({ nodeId }, 'Node initialized for cold start');
    this.emit('node-initialized', state);

    return state;
  }

  /**
   * Get scheduling algorithm for a node
   */
  async getSchedulingAlgorithm(nodeId: string): Promise<{
    algorithm: 'heuristic' | 'ml' | 'hybrid';
    mlWeight: number;
    heuristicWeight: number;
    confidence: number;
  }> {
    const state = await this.getNodeState(nodeId);

    if (!state) {
      // New node - initialize and use heuristic
      await this.initializeNode(nodeId);
      return {
        algorithm: 'heuristic',
        mlWeight: 0,
        heuristicWeight: 1,
        confidence: 0,
      };
    }

    const { tasksCompleted, mlConfidence } = state;

    // Cold phase: Pure heuristic
    if (tasksCompleted < this.config.coldPhaseThreshold) {
      return {
        algorithm: 'heuristic',
        mlWeight: 0,
        heuristicWeight: 1,
        confidence: mlConfidence,
      };
    }

    // Warm phase: Weighted combination
    if (tasksCompleted < this.config.warmPhaseThreshold) {
      const progress = (tasksCompleted - this.config.coldPhaseThreshold) /
        (this.config.warmPhaseThreshold - this.config.coldPhaseThreshold);
      const mlWeight = progress * mlConfidence;
      const heuristicWeight = 1 - mlWeight;

      return {
        algorithm: 'hybrid',
        mlWeight,
        heuristicWeight,
        confidence: mlConfidence,
      };
    }

    // Normal phase: Full ML (if confidence is high enough)
    if (mlConfidence >= this.config.minConfidenceForML) {
      return {
        algorithm: 'ml',
        mlWeight: 1,
        heuristicWeight: 0,
        confidence: mlConfidence,
      };
    }

    // Fallback to hybrid if ML confidence is low
    return {
      algorithm: 'hybrid',
      mlWeight: mlConfidence,
      heuristicWeight: 1 - mlConfidence,
      confidence: mlConfidence,
    };
  }

  /**
   * Make scheduling decision for a task
   * Considers cold start state of all candidate nodes
   */
  async selectNodeForTask(
    taskId: string,
    candidateNodes: string[],
    taskRequirements: {
      priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      estimatedDuration: number;
      cpuIntensive: boolean;
      memoryIntensive: boolean;
    }
  ): Promise<SchedulingDecision> {
    // Get cold start states for all candidates
    const nodeStates = await Promise.all(
      candidateNodes.map((id) => this.getNodeState(id))
    );

    // Separate nodes by phase
    const coldNodes: NodeColdStartState[] = [];
    const warmNodes: NodeColdStartState[] = [];
    const normalNodes: NodeColdStartState[] = [];

    for (const state of nodeStates) {
      if (!state) {
        // New node - initialize
        const newState = await this.initializeNode(candidateNodes[nodeStates.indexOf(state)]);
        coldNodes.push(newState);
      } else if (state.phase === 'cold') {
        coldNodes.push(state);
      } else if (state.phase === 'warm') {
        warmNodes.push(state);
      } else {
        normalNodes.push(state);
      }
    }

    // Decision logic based on task priority and node availability
    let selectedNode: NodeColdStartState | undefined;
    let algorithm: 'heuristic' | 'ml' | 'hybrid' = 'heuristic';
    let confidence = 0;
    let reason = '';

    // CRITICAL tasks: Prefer established nodes
    if (taskRequirements.priority === 'CRITICAL') {
      if (normalNodes.length > 0) {
        selectedNode = this.selectBestNormalNode(normalNodes, taskRequirements);
        algorithm = 'ml';
        confidence = selectedNode.mlConfidence;
        reason = 'Critical task - using established node with ML';
      } else if (warmNodes.length > 0) {
        selectedNode = this.selectBestWarmNode(warmNodes, taskRequirements);
        algorithm = 'hybrid';
        confidence = selectedNode.mlConfidence;
        reason = 'Critical task - using warm node with hybrid';
      } else {
        selectedNode = this.selectBestColdNode(coldNodes, taskRequirements);
        algorithm = 'heuristic';
        confidence = 0;
        reason = 'Critical task - no established nodes, using heuristic';
      }
    }
    // HIGH priority: Allow some exploration
    else if (taskRequirements.priority === 'HIGH') {
      const shouldExplore = Math.random() < this.config.explorationRate && coldNodes.length > 0;

      if (shouldExplore) {
        selectedNode = this.selectBestColdNode(coldNodes, taskRequirements);
        algorithm = 'heuristic';
        confidence = 0;
        reason = 'High priority - exploring new node';
      } else if (normalNodes.length > 0) {
        selectedNode = this.selectBestNormalNode(normalNodes, taskRequirements);
        algorithm = 'ml';
        confidence = selectedNode.mlConfidence;
        reason = 'High priority - using established node';
      } else {
        selectedNode = warmNodes[0] || coldNodes[0];
        algorithm = warmNodes.length > 0 ? 'hybrid' : 'heuristic';
        confidence = selectedNode?.mlConfidence || 0;
        reason = 'High priority - using available node';
      }
    }
    // MEDIUM/LOW priority: More exploration allowed
    else {
      const shouldExplore = Math.random() < this.config.explorationRate * 2 && coldNodes.length > 0;

      if (shouldExplore) {
        selectedNode = this.selectBestColdNode(coldNodes, taskRequirements);
        algorithm = 'heuristic';
        confidence = 0;
        reason = 'Normal priority - exploring new node';
      } else {
        selectedNode = normalNodes[0] || warmNodes[0] || coldNodes[0];
        algorithm = normalNodes.length > 0 ? 'ml' : warmNodes.length > 0 ? 'hybrid' : 'heuristic';
        confidence = selectedNode?.mlConfidence || 0;
        reason = 'Normal priority - using best available node';
      }
    }

    if (!selectedNode) {
      throw new Error('No candidate nodes available');
    }

    return {
      nodeId: selectedNode.nodeId,
      algorithm,
      confidence,
      reason,
      estimatedDuration: this.estimateDuration(selectedNode, taskRequirements),
      riskScore: this.calculateRiskScore(selectedNode, taskRequirements),
    };
  }

  /**
   * Record task completion and update cold start state
   */
  async recordTaskCompletion(
    nodeId: string,
    taskResult: {
      success: boolean;
      duration: number;
      error?: string;
    }
  ): Promise<NodeColdStartState> {
    let state = await this.getNodeState(nodeId);

    if (!state) {
      state = await this.initializeNode(nodeId);
    }

    // Update statistics
    if (taskResult.success) {
      state.tasksCompleted++;

      // Update average execution time
      const totalTasks = state.tasksCompleted;
      state.avgExecutionTime =
        (state.avgExecutionTime * (totalTasks - 1) + taskResult.duration) / totalTasks;
    } else {
      state.tasksFailed++;
    }

    // Update success rate
    const totalTasks = state.tasksCompleted + state.tasksFailed;
    state.successRate = state.tasksCompleted / totalTasks;

    // Calculate ML confidence based on data quality
    state.mlConfidence = this.calculateMLConfidence(state);

    // Update phase
    state.phase = this.determinePhase(state);
    state.lastTaskAt = new Date();

    await this.saveNodeState(state);

    // Emit phase change event
    this.emit('task-completed', {
      nodeId,
      state,
      result: taskResult,
    });

    this.logger.debug(
      { nodeId, phase: state.phase, tasksCompleted: state.tasksCompleted },
      'Task completion recorded'
    );

    return state;
  }

  /**
   * Get cold start state for a node
   */
  async getNodeState(nodeId: string): Promise<NodeColdStartState | null> {
    const data = await this.redis.get(REDIS_KEYS.nodeState(nodeId));
    if (!data) return null;

    const state: NodeColdStartState = JSON.parse(data);
    return state;
  }

  /**
   * Get all nodes in cold start phase
   */
  async getColdStartNodes(): Promise<NodeColdStartState[]> {
    const keys = await this.redis.keys(REDIS_KEYS.nodeState('*'));
    const states: NodeColdStartState[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        states.push(JSON.parse(data));
      }
    }

    return states.filter((s) => s.phase !== 'normal');
  }

  /**
   * Get global cold start statistics
   */
  async getGlobalStats(): Promise<{
    totalNodes: number;
    coldNodes: number;
    warmNodes: number;
    normalNodes: number;
    avgWarmupTime: number;
  }> {
    const keys = await this.redis.keys(REDIS_KEYS.nodeState('*'));
    const states: NodeColdStartState[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        states.push(JSON.parse(data));
      }
    }

    const coldNodes = states.filter((s) => s.phase === 'cold').length;
    const warmNodes = states.filter((s) => s.phase === 'warm').length;
    const normalNodes = states.filter((s) => s.phase === 'normal').length;

    // Calculate average warmup time
    const warmedNodes = states.filter((s) => s.phase === 'normal' && s.lastTaskAt);
    let totalWarmupTime = 0;
    for (const node of warmedNodes) {
      if (node.lastTaskAt) {
        totalWarmupTime += new Date(node.lastTaskAt).getTime() - new Date(node.joinedAt).getTime();
      }
    }
    const avgWarmupTime = warmedNodes.length > 0 ? totalWarmupTime / warmedNodes.length : 0;

    return {
      totalNodes: states.length,
      coldNodes,
      warmNodes,
      normalNodes,
      avgWarmupTime,
    };
  }

  // Private helper methods

  private async saveNodeState(state: NodeColdStartState): Promise<void> {
    await this.redis.setex(
      REDIS_KEYS.nodeState(state.nodeId),
      86400, // 24 hour TTL
      JSON.stringify(state)
    );
  }

  private determinePhase(state: NodeColdStartState): ColdStartPhase {
    if (state.tasksCompleted < this.config.coldPhaseThreshold) {
      return 'cold';
    }
    if (state.tasksCompleted < this.config.warmPhaseThreshold) {
      return 'warm';
    }
    return 'normal';
  }

  private calculateMLConfidence(state: NodeColdStartState): number {
    // Confidence based on:
    // - Number of completed tasks (more = better)
    // - Success rate (higher = better)
    // - Variance in execution times (lower = better)

    const taskCountScore = Math.min(state.tasksCompleted / this.config.warmPhaseThreshold, 1);
    const successRateScore = state.successRate;

    // Combined confidence score
    return taskCountScore * 0.4 + successRateScore * 0.6;
  }

  private selectBestNormalNode(
    nodes: NodeColdStartState[],
    requirements: { cpuIntensive: boolean; memoryIntensive: boolean }
  ): NodeColdStartState {
    // Sort by ML confidence and success rate
    return nodes.sort((a, b) => {
      const scoreA = a.mlConfidence * 0.6 + a.successRate * 0.4;
      const scoreB = b.mlConfidence * 0.6 + b.successRate * 0.4;
      return scoreB - scoreA;
    })[0];
  }

  private selectBestWarmNode(
    nodes: NodeColdStartState[],
    requirements: { cpuIntensive: boolean; memoryIntensive: boolean }
  ): NodeColdStartState {
    // Prefer nodes closer to normal phase
    return nodes.sort((a, b) => b.tasksCompleted - a.tasksCompleted)[0];
  }

  private selectBestColdNode(
    nodes: NodeColdStartState[],
    requirements: { cpuIntensive: boolean; memoryIntensive: boolean }
  ): NodeColdStartState {
    // For cold nodes, just pick the one with most tasks (closest to warm)
    return nodes.sort((a, b) => b.tasksCompleted - a.tasksCompleted)[0];
  }

  private estimateDuration(
    node: NodeColdStartState,
    requirements: { estimatedDuration: number }
  ): number {
    if (node.avgExecutionTime > 0) {
      // Use node's average with some buffer for cold nodes
      const buffer = node.phase === 'cold' ? 1.5 : node.phase === 'warm' ? 1.2 : 1.0;
      return node.avgExecutionTime * buffer;
    }

    // Fallback to requirement estimate
    return requirements.estimatedDuration;
  }

  private calculateRiskScore(
    node: NodeColdStartState,
    requirements: { priority: string }
  ): number {
    let risk = 0;

    // Cold nodes are riskier
    if (node.phase === 'cold') risk += 0.4;
    if (node.phase === 'warm') risk += 0.2;

    // Low success rate increases risk
    risk += (1 - node.successRate) * 0.3;

    // Low confidence increases risk
    risk += (1 - node.mlConfidence) * 0.3;

    return Math.min(risk, 1);
  }
}
