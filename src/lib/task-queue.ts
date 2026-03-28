import type { Task, TaskPriority } from '../types'

interface QueuedTask {
  id: string
  task: Task
  priority: number
  submittedAt: number
  retryCount: number
  maxRetries: number
}

interface QueueStats {
  total: number
  pending: number
  processing: number
  byPriority: Record<TaskPriority, number>
  avgWaitTime: number
}

const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25
}

class PriorityTaskQueue {
  private queue: QueuedTask[] = []
  private processing: Set<string> = new Set()
  private maxConcurrent: number
  private processingCallback: ((task: Task) => Promise<void>) | null = null

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent
  }

  enqueue(task: Task): void {
    const existingIndex = this.queue.findIndex(qt => qt.id === task.id)
    
    if (existingIndex !== -1) {
      // Update existing task if already queued
      this.queue[existingIndex].task = task
      this.reorderQueue()
      return
    }

    const queuedTask: QueuedTask = {
      id: task.id,
      task,
      priority: this.calculatePriority(task),
      submittedAt: Date.now(),
      retryCount: 0,
      maxRetries: task.maxRetries || 3
    }

    // Insert by priority (higher first)
    const insertIndex = this.queue.findIndex(
      qt => qt.priority < queuedTask.priority
    )
    
    if (insertIndex === -1) {
      this.queue.push(queuedTask)
    } else {
      this.queue.splice(insertIndex, 0, queuedTask)
    }

    this.processQueue()
  }

  private calculatePriority(task: Task): number {
    const basePriority = PRIORITY_WEIGHTS[task.priority] || 25
    const ageBonus = Math.min((Date.now() - task.submittedAt.getTime()) / 1000 / 60, 10) // Max 10 points for age
    return basePriority + ageBonus
  }

  private reorderQueue(): void {
    // Recalculate priorities and re-sort
    this.queue.forEach(qt => {
      qt.priority = this.calculatePriority(qt.task)
    })
    this.queue.sort((a, b) => b.priority - a.priority)
  }

  private async processQueue(): Promise<void> {
    if (!this.processingCallback) return
    if (this.processing.size >= this.maxConcurrent) return
    if (this.queue.length === 0) return

    const nextTask = this.queue.shift()
    if (!nextTask) return

    this.processing.add(nextTask.id)

    try {
      await this.processingCallback(nextTask.task)
    } catch (error) {
      console.error(`Task ${nextTask.id} failed:`, error)
      
      if (nextTask.retryCount < nextTask.maxRetries) {
        nextTask.retryCount++
        // Re-queue with exponential backoff delay
        const backoffDelay = Math.pow(2, nextTask.retryCount) * 1000
        setTimeout(() => {
          this.queue.push(nextTask)
          this.reorderQueue()
        }, backoffDelay)
      }
    } finally {
      this.processing.delete(nextTask.id)
      // Process next task
      this.processQueue()
    }
  }

  dequeue(): Task | undefined {
    const queued = this.queue.shift()
    return queued?.task
  }

  peek(): Task | undefined {
    return this.queue[0]?.task
  }

  remove(taskId: string): boolean {
    const index = this.queue.findIndex(qt => qt.id === taskId)
    if (index !== -1) {
      this.queue.splice(index, 1)
      return true
    }
    return false
  }

  setProcessor(callback: (task: Task) => Promise<void>): void {
    this.processingCallback = callback
    this.processQueue()
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max
    this.processQueue()
  }

  getStats(): QueueStats {
    const now = Date.now()
    const waitTimes = this.queue.map(qt => now - qt.submittedAt)
    const avgWaitTime = waitTimes.length > 0 
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length 
      : 0

    const byPriority: Record<TaskPriority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    }

    this.queue.forEach(qt => {
      byPriority[qt.task.priority]++
    })

    return {
      total: this.queue.length + this.processing.size,
      pending: this.queue.length,
      processing: this.processing.size,
      byPriority,
      avgWaitTime
    }
  }

  getQueue(): Task[] {
    return this.queue.map(qt => qt.task)
  }

  getPosition(taskId: string): number {
    return this.queue.findIndex(qt => qt.id === taskId)
  }

  clear(): void {
    this.queue = []
    this.processing.clear()
  }

  isProcessing(taskId: string): boolean {
    return this.processing.has(taskId)
  }

  isQueued(taskId: string): boolean {
    return this.queue.some(qt => qt.id === taskId)
  }

  size(): number {
    return this.queue.length
  }

  processingCount(): number {
    return this.processing.size
  }
}

// Singleton instance
export const taskQueue = new PriorityTaskQueue()

export { PriorityTaskQueue }
export type { QueuedTask, QueueStats }
