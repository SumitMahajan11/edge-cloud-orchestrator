import type { Task, EdgeNode } from '../types'

interface TaskHistory {
  taskType: string
  nodeId: string
  executionTime: number
  success: boolean
  timestamp: number
  cpuAtExecution: number
  memoryAtExecution: number
}

interface NodeScore {
  node: EdgeNode
  score: number
  predictedLatency: number
  confidence: number
}

interface PredictionModel {
  taskType: string
  avgExecutionTime: number
  stdDeviation: number
  nodePerformance: Map<string, number>
  lastUpdated: number
}

class PredictiveScheduler {
  private history: TaskHistory[] = []
  private models: Map<string, PredictionModel> = new Map()
  private maxHistorySize = 1000
  private modelUpdateInterval = 60000 // 1 minute
  private lastModelUpdate = 0

  recordExecution(history: TaskHistory): void {
    this.history.push(history)
    
    // Trim history if too large
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize)
    }

    // Update model if needed
    if (Date.now() - this.lastModelUpdate > this.modelUpdateInterval) {
      this.updateModels()
    }
  }

  private updateModels(): void {
    const taskTypes = new Set(this.history.map(h => h.taskType))
    
    taskTypes.forEach(taskType => {
      const typeHistory = this.history.filter(h => h.taskType === taskType)
      
      if (typeHistory.length < 5) return // Need minimum data

      const executionTimes = typeHistory.map(h => h.executionTime)
      const avgExecutionTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length
      
      // Calculate standard deviation
      const variance = executionTimes.reduce((sum, time) => {
        return sum + Math.pow(time - avgExecutionTime, 2)
      }, 0) / executionTimes.length
      const stdDeviation = Math.sqrt(variance)

      // Calculate node performance scores
      const nodePerformance = new Map<string, number>()
      const nodeIds = new Set(typeHistory.map(h => h.nodeId))
      
      nodeIds.forEach(nodeId => {
        const nodeHistory = typeHistory.filter(h => h.nodeId === nodeId && h.success)
        if (nodeHistory.length === 0) return
        
        const nodeAvg = nodeHistory.reduce((sum, h) => sum + h.executionTime, 0) / nodeHistory.length
        const successRate = nodeHistory.length / typeHistory.filter(h => h.nodeId === nodeId).length
        
        // Score: lower is better (faster execution, higher success rate)
        nodePerformance.set(nodeId, nodeAvg / successRate)
      })

      this.models.set(taskType, {
        taskType,
        avgExecutionTime,
        stdDeviation,
        nodePerformance,
        lastUpdated: Date.now()
      })
    })

    this.lastModelUpdate = Date.now()
  }

  predictBestNode(task: Task, nodes: EdgeNode[]): EdgeNode | null {
    if (nodes.length === 0) return null

    const model = this.models.get(task.type)
    
    // If we have a model for this task type, use it
    if (model && model.nodePerformance.size > 0) {
      return this.predictFromModel(task, nodes, model)
    }

    // Fall back to heuristic-based prediction
    return this.predictFromHeuristics(task, nodes)
  }

  private predictFromModel(task: Task, nodes: EdgeNode[], model: PredictionModel): EdgeNode {
    const scores: NodeScore[] = nodes.map(node => {
      const nodePerformance = model.nodePerformance.get(node.id) || model.avgExecutionTime * 2
      const performanceScore = model.avgExecutionTime / nodePerformance
      
      // Current node load
      const loadFactor = (node.cpu / 100) * 0.5 + (node.memory / 100) * 0.5
      
      // Latency prediction
      const predictedLatency = nodePerformance * (1 + loadFactor)
      
      // Combined score (higher is better)
      const score = performanceScore * (1 - loadFactor) * 100
      
      // Calculate confidence based on data availability
      const historyCount = this.history.filter(
        h => h.taskType === task.type && h.nodeId === node.id
      ).length
      const confidence = Math.min(historyCount / 10, 1)

      return {
        node,
        score,
        predictedLatency,
        confidence
      }
    })

    // Sort by score (descending)
    scores.sort((a, b) => b.score - a.score)
    
    return scores[0].node
  }

  private predictFromHeuristics(_task: Task, nodes: EdgeNode[]): EdgeNode {
    const scores = nodes.map(node => {
      // Base score from current metrics
      const cpuScore = 100 - node.cpu
      const memoryScore = 100 - node.memory
      const latencyScore = Math.max(0, 100 - node.latency)
      
      // Task count penalty
      const taskPenalty = (node.tasksRunning / node.maxTasks) * 50
      
      // Combined score
      const score = (cpuScore + memoryScore + latencyScore) / 3 - taskPenalty

      return { node, score }
    })

    scores.sort((a, b) => b.score - a.score)
    return scores[0].node
  }

  predictExecutionTime(task: Task, node: EdgeNode): { estimated: number; confidence: number } {
    const model = this.models.get(task.type)
    
    if (!model) {
      // No model yet, use heuristic
      const baseTime = 1000 // 1 second base
      const loadFactor = 1 + (node.cpu / 100)
      return {
        estimated: baseTime * loadFactor,
        confidence: 0.3
      }
    }

    const nodePerformance = model.nodePerformance.get(node.id)
    
    if (nodePerformance) {
      return {
        estimated: nodePerformance,
        confidence: Math.min(this.history.filter(
          h => h.taskType === task.type && h.nodeId === node.id
        ).length / 10, 0.9)
      }
    }

    // Use average with penalty for unknown node
    return {
      estimated: model.avgExecutionTime * 1.5,
      confidence: 0.5
    }
  }

  getModelStats(): Array<{
    taskType: string
    samples: number
    avgExecutionTime: number
    nodesTested: number
    lastUpdated: number
  }> {
    return Array.from(this.models.values()).map(model => ({
      taskType: model.taskType,
      samples: this.history.filter(h => h.taskType === model.taskType).length,
      avgExecutionTime: model.avgExecutionTime,
      nodesTested: model.nodePerformance.size,
      lastUpdated: model.lastUpdated
    }))
  }

  getRecommendations(nodes: EdgeNode[]): Array<{
    taskType: string
    recommendedNode: string
    reason: string
  }> {
    const recommendations: Array<{
      taskType: string
      recommendedNode: string
      reason: string
    }> = []

    this.models.forEach((model, taskType) => {
      let bestNode = ''
      let bestScore = Infinity

      model.nodePerformance.forEach((score, nodeId) => {
        if (score < bestScore) {
          bestScore = score
          bestNode = nodeId
        }
      })

      if (bestNode) {
        const node = nodes.find(n => n.id === bestNode)
        recommendations.push({
          taskType,
          recommendedNode: node?.name || bestNode,
          reason: `Lowest average execution time (${model.avgExecutionTime.toFixed(0)}ms)`
        })
      }
    })

    return recommendations
  }

  clearHistory(): void {
    this.history = []
    this.models.clear()
    this.lastModelUpdate = 0
  }

  exportData(): { history: TaskHistory[]; models: PredictionModel[] } {
    return {
      history: this.history,
      models: Array.from(this.models.values())
    }
  }
}

// Singleton instance
export const predictiveScheduler = new PredictiveScheduler()

export { PredictiveScheduler }
export type { TaskHistory, NodeScore, PredictionModel }
