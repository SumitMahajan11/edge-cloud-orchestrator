/**
 * Federated Learning Support
 * Distributed ML training across edge nodes without centralizing data
 */

import { logger } from '../logger'
import type { EdgeNode } from '../../types'

// Types
export interface FLModel {
  id: string
  name: string
  version: string
  architecture: string
  inputShape: number[]
  outputShape: number[]
  parameters: number
  createdAt: number
  updatedAt: number
}

export interface FLClient {
  nodeId: string
  status: 'idle' | 'training' | 'uploading' | 'syncing' | 'error'
  lastSync: number
  localEpochs: number
  localSamples: number
  modelVersion: string
  gradientNorm: number
  loss: number
  accuracy: number
}

export interface FLRound {
  id: string
  roundNumber: number
  status: 'pending' | 'aggregating' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  participatingClients: string[]
  globalModelVersion: string
  aggregatedUpdates: Map<string, number[]>
  metrics: {
    avgLoss: number
    avgAccuracy: number
    clientCount: number
    totalSamples: number
  }
}

export interface FLConfig {
  minClients: number
  maxClients: number
  minSamplesPerClient: number
  localEpochs: number
  learningRate: number
  aggregationStrategy: 'fedavg' | 'fedprox' | 'fedadam'
  privacyBudget?: number // Differential privacy
  noiseMultiplier?: number
  gradientClipNorm?: number
  roundsPerEvaluation: number
  convergenceThreshold: number
}

export interface FLTrainingSession {
  id: string
  modelId: string
  config: FLConfig
  status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed'
  currentRound: number
  totalRounds: number
  clients: Map<string, FLClient>
  rounds: FLRound[]
  globalModel: FLModel
  startedAt: number
  completedAt?: number
  metrics: {
    bestAccuracy: number
    bestRound: number
    convergenceHistory: number[]
  }
}

type FLEvent = 'session.started' | 'round.started' | 'round.completed' | 'client.joined' | 'client.updated' | 'session.completed'
type FLCallback = (event: FLEvent, data: unknown) => void

const DEFAULT_CONFIG: FLConfig = {
  minClients: 3,
  maxClients: 10,
  minSamplesPerClient: 100,
  localEpochs: 5,
  learningRate: 0.01,
  aggregationStrategy: 'fedavg',
  roundsPerEvaluation: 5,
  convergenceThreshold: 0.001,
}

/**
 * Federated Learning Coordinator
 */
export class FederatedLearningCoordinator {
  private sessions: Map<string, FLTrainingSession> = new Map()
  private models: Map<string, FLModel> = new Map()
  private callbacks: Map<FLEvent, Set<FLCallback>> = new Map()
  private nodeProvider: (() => EdgeNode[]) | null = null
  private modelStorage: Map<string, number[]> = new Map() // modelId -> weights

  constructor() {}

  /**
   * Set node provider
   */
  setNodeProvider(provider: () => EdgeNode[]): void {
    this.nodeProvider = provider
  }

  /**
   * Register a model for federated training
   */
  registerModel(model: Omit<FLModel, 'createdAt' | 'updatedAt'>): FLModel {
    const flModel: FLModel = {
      ...model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.models.set(model.id, flModel)
    
    // Initialize random weights (simulated)
    const weights = this.initializeWeights(model.parameters)
    this.modelStorage.set(model.id, weights)

    logger.info('FL model registered', { modelId: model.id, name: model.name })
    return flModel
  }

  /**
   * Initialize model weights
   */
  private initializeWeights(paramCount: number): number[] {
    // Xavier initialization
    const scale = Math.sqrt(2 / paramCount)
    return Array.from({ length: Math.min(paramCount, 1000) }, () => 
      (Math.random() - 0.5) * 2 * scale
    )
  }

  /**
   * Start a federated training session
   */
  async startTrainingSession(
    modelId: string,
    config: Partial<FLConfig> = {},
    totalRounds: number = 10
  ): Promise<FLTrainingSession> {
    const model = this.models.get(modelId)
    if (!model) {
      throw new Error(`Model ${modelId} not found`)
    }

    const sessionId = `fl-session-${Date.now()}`
    const fullConfig: FLConfig = { ...DEFAULT_CONFIG, ...config }

    // Get available clients
    const nodes = this.nodeProvider ? this.nodeProvider().filter(n => n.status === 'online') : []
    const clientCount = Math.min(nodes.length, fullConfig.maxClients)

    if (clientCount < fullConfig.minClients) {
      throw new Error(`Insufficient clients: ${clientCount} < ${fullConfig.minClients}`)
    }

    const clients = new Map<string, FLClient>()
    for (let i = 0; i < clientCount; i++) {
      clients.set(nodes[i].id, {
        nodeId: nodes[i].id,
        status: 'idle',
        lastSync: Date.now(),
        localEpochs: 0,
        localSamples: Math.floor(Math.random() * 10000) + fullConfig.minSamplesPerClient,
        modelVersion: '0',
        gradientNorm: 0,
        loss: 1.0,
        accuracy: 0,
      })
    }

    const session: FLTrainingSession = {
      id: sessionId,
      modelId,
      config: fullConfig,
      status: 'initializing',
      currentRound: 0,
      totalRounds,
      clients,
      rounds: [],
      globalModel: model,
      startedAt: Date.now(),
      metrics: {
        bestAccuracy: 0,
        bestRound: 0,
        convergenceHistory: [],
      },
    }

    this.sessions.set(sessionId, session)
    this.emit('session.started', { sessionId, modelId, clientCount })

    logger.info('FL training session started', { sessionId, modelId, clientCount, totalRounds })

    // Run training
    await this.runTraining(session)

    return session
  }

  /**
   * Run federated training loop
   */
  private async runTraining(session: FLTrainingSession): Promise<void> {
    session.status = 'running'

    for (let round = 1; round <= session.totalRounds; round++) {
      if (session.status !== 'running') break

      session.currentRound = round
      const flRound = await this.executeRound(session, round)
      session.rounds.push(flRound)

      // Check convergence
      if (flRound.metrics.avgAccuracy > session.metrics.bestAccuracy) {
        session.metrics.bestAccuracy = flRound.metrics.avgAccuracy
        session.metrics.bestRound = round
      }
      session.metrics.convergenceHistory.push(flRound.metrics.avgAccuracy)

      // Early stopping
      if (round > session.config.roundsPerEvaluation) {
        const recent = session.metrics.convergenceHistory.slice(-session.config.roundsPerEvaluation)
        const improvement = Math.max(...recent) - Math.min(...recent)
        if (improvement < session.config.convergenceThreshold) {
          logger.info('FL training converged early', { sessionId: session.id, round })
          break
        }
      }
    }

    session.status = 'completed'
    session.completedAt = Date.now()
    this.emit('session.completed', session)
    logger.info('FL training completed', { sessionId: session.id, rounds: session.currentRound })
  }

  /**
   * Execute a single federated round
   */
  private async executeRound(session: FLTrainingSession, roundNumber: number): Promise<FLRound> {
    const roundId = `round-${session.id}-${roundNumber}`
    
    const round: FLRound = {
      id: roundId,
      roundNumber,
      status: 'pending',
      startedAt: Date.now(),
      participatingClients: Array.from(session.clients.keys()),
      globalModelVersion: `${roundNumber}`,
      aggregatedUpdates: new Map(),
      metrics: { avgLoss: 0, avgAccuracy: 0, clientCount: 0, totalSamples: 0 },
    }

    this.emit('round.started', { sessionId: session.id, roundNumber })

    // Phase 1: Distribute global model to clients
    await this.distributeModel(session, round)

    // Phase 2: Local training on each client
    const updates = await this.localTraining(session, round)

    // Phase 3: Aggregate updates
    round.status = 'aggregating'
    const aggregated = this.aggregateUpdates(session, updates, round)
    round.aggregatedUpdates = aggregated

    // Phase 4: Update global model
    this.updateGlobalModel(session, aggregated)

    // Calculate metrics
    round.metrics = this.calculateRoundMetrics(session, updates)
    round.status = 'completed'
    round.completedAt = Date.now()

    this.emit('round.completed', { sessionId: session.id, roundNumber, metrics: round.metrics })

    return round
  }

  /**
   * Distribute global model to clients
   */
  private async distributeModel(session: FLTrainingSession, _round: FLRound): Promise<void> {
    for (const [_nodeId, client] of session.clients) {
      client.status = 'syncing'
      client.modelVersion = _round.globalModelVersion
      
      // Simulate model distribution
      await new Promise(resolve => setTimeout(resolve, 10))
      
      client.status = 'training'
    }
  }

  /**
   * Execute local training on clients
   */
  private async localTraining(
    session: FLTrainingSession,
    _round: FLRound
  ): Promise<Map<string, { gradients: number[]; samples: number; loss: number; accuracy: number }>> {
    const updates = new Map<string, { gradients: number[]; samples: number; loss: number; accuracy: number }>()

    for (const [nodeId, client] of session.clients) {
      // Simulate local training
      const localUpdates = await this.simulateLocalTraining(client, session.config)
      updates.set(nodeId, localUpdates)

      client.status = 'uploading'
      client.localEpochs += session.config.localEpochs
      client.loss = localUpdates.loss
      client.accuracy = localUpdates.accuracy
      client.gradientNorm = Math.sqrt(localUpdates.gradients.reduce((s, g) => s + g * g, 0))

      this.emit('client.updated', { sessionId: session.id, nodeId, accuracy: client.accuracy })
    }

    return updates
  }

  /**
   * Simulate local training (in production, would call actual ML framework)
   */
  private async simulateLocalTraining(
    client: FLClient,
    _config: FLConfig
  ): Promise<{ gradients: number[]; samples: number; loss: number; accuracy: number }> {
    await new Promise(resolve => setTimeout(resolve, 50))

    // Simulate training improvement
    const improvement = Math.random() * 0.05
    const baseAccuracy = client.accuracy || 0.5
    const newAccuracy = Math.min(0.99, baseAccuracy + improvement)
    const newLoss = Math.max(0.01, (1 - newAccuracy) + Math.random() * 0.1)

    // Simulate gradients
    const gradients = Array.from({ length: 100 }, () => (Math.random() - 0.5) * 0.1)

    return {
      gradients,
      samples: client.localSamples,
      loss: newLoss,
      accuracy: newAccuracy,
    }
  }

  /**
   * Aggregate client updates (FedAvg)
   */
  private aggregateUpdates(
    session: FLTrainingSession,
    updates: Map<string, { gradients: number[]; samples: number; loss: number; accuracy: number }>,
    _round: FLRound
  ): Map<string, number[]> {
    const aggregated = new Map<string, number[]>()
    
    const totalSamples = Array.from(updates.values()).reduce((s, u) => s + u.samples, 0)
    
    // Weighted average of gradients
    const avgGradients: number[] = []
    const gradientLength = 100 // Simplified

    for (let i = 0; i < gradientLength; i++) {
      let weightedSum = 0
      for (const [, update] of updates) {
        weightedSum += (update.gradients[i] || 0) * (update.samples / totalSamples)
      }
      avgGradients.push(weightedSum)
    }

    // Apply differential privacy noise if configured
    if (session.config.privacyBudget && session.config.noiseMultiplier) {
      const noiseScale = session.config.noiseMultiplier / session.config.privacyBudget
      for (let i = 0; i < avgGradients.length; i++) {
        avgGradients[i] += (Math.random() - 0.5) * 2 * noiseScale
      }
    }

    // Clip gradients if configured
    if (session.config.gradientClipNorm) {
      const norm = Math.sqrt(avgGradients.reduce((s, g) => s + g * g, 0))
      if (norm > session.config.gradientClipNorm) {
        const scale = session.config.gradientClipNorm / norm
        for (let i = 0; i < avgGradients.length; i++) {
          avgGradients[i] *= scale
        }
      }
    }

    aggregated.set('global', avgGradients)
    return aggregated
  }

  /**
   * Update global model with aggregated updates
   */
  private updateGlobalModel(
    session: FLTrainingSession,
    aggregated: Map<string, number[]>
  ): void {
    const currentWeights = this.modelStorage.get(session.modelId) || []
    const gradients = aggregated.get('global') || []

    // SGD update
    const newWeights = currentWeights.map((w, i) => 
      w - session.config.learningRate * (gradients[i] || 0)
    )

    this.modelStorage.set(session.modelId, newWeights)
    
    // Update model
    const model = this.models.get(session.modelId)
    if (model) {
      model.updatedAt = Date.now()
    }
  }

  /**
   * Calculate round metrics
   */
  private calculateRoundMetrics(
    _session: FLTrainingSession,
    updates: Map<string, { gradients: number[]; samples: number; loss: number; accuracy: number }>
  ): FLRound['metrics'] {
    const values = Array.from(updates.values())
    const totalSamples = values.reduce((s, u) => s + u.samples, 0)

    return {
      avgLoss: values.reduce((s, u) => s + u.loss, 0) / values.length,
      avgAccuracy: values.reduce((s, u) => s + u.accuracy, 0) / values.length,
      clientCount: values.length,
      totalSamples,
    }
  }

  /**
   * Get session
   */
  getSession(sessionId: string): FLTrainingSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Get model
   */
  getModel(modelId: string): FLModel | undefined {
    return this.models.get(modelId)
  }

  /**
   * Get model weights
   */
  getModelWeights(modelId: string): number[] | undefined {
    return this.modelStorage.get(modelId)
  }

  /**
   * Get all sessions
   */
  getAllSessions(): FLTrainingSession[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Pause training
   */
  pauseSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'running') return false
    session.status = 'paused'
    return true
  }

  /**
   * Resume training
   */
  async resumeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'paused') return false
    session.status = 'running'
    await this.runTraining(session)
    return true
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalModels: number
    totalSessions: number
    activeSessions: number
    completedSessions: number
  } {
    let active = 0
    let completed = 0

    for (const session of this.sessions.values()) {
      if (session.status === 'running') active++
      if (session.status === 'completed') completed++
    }

    return {
      totalModels: this.models.size,
      totalSessions: this.sessions.size,
      activeSessions: active,
      completedSessions: completed,
    }
  }

  /**
   * Subscribe to events
   */
  on(event: FLEvent, callback: FLCallback): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set())
    }
    this.callbacks.get(event)!.add(callback)

    return () => {
      this.callbacks.get(event)?.delete(callback)
    }
  }

  private emit(event: FLEvent, data: unknown): void {
    this.callbacks.get(event)?.forEach(cb => {
      try {
        cb(event, data)
      } catch (error) {
        logger.error('FL callback error', error as Error)
      }
    })
  }
}

/**
 * Create FL coordinator
 */
export function createFederatedLearningCoordinator(): FederatedLearningCoordinator {
  return new FederatedLearningCoordinator()
}

// Default instance
export const federatedLearningCoordinator = new FederatedLearningCoordinator()
