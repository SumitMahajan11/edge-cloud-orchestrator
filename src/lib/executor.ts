import type { Task } from '../types'
import type { ContainerExecution, TaskContainerMapping } from '../types/docker'
import { dockerClient, DEFAULT_TASK_MAPPINGS } from './docker'
import { webhookManager } from './webhook'
import { agentPool } from './agent-pool'
import { circuitBreakerRegistry } from './circuit-breaker'

class TaskExecutor {
  private executions: Map<string, ContainerExecution> = new Map()
  private taskMappings: TaskContainerMapping[] = DEFAULT_TASK_MAPPINGS

  async executeTask(task: Task, targetNodeUrl?: string): Promise<void> {
    const execution: ContainerExecution = {
      containerId: '',
      taskId: task.id,
      taskName: task.name,
      status: 'pending',
      logs: [],
    }

    this.executions.set(task.id, execution)

    // Use circuit breaker for the target node
    const nodeUrl = targetNodeUrl || 'local'
    const circuitBreaker = circuitBreakerRegistry.get(`node-${nodeUrl}`, {
      failureThreshold: 3,
      timeout: 30000
    })

    try {
      await circuitBreaker.execute(async () => {
        // If target node specified and not local, use agent pool
        if (targetNodeUrl && targetNodeUrl !== 'local') {
          await this.executeOnRemoteNode(task, execution, targetNodeUrl)
          return
        }

        // Check if Docker is available locally
        if (!dockerClient.isAvailable()) {
          // Fall back to simulation mode
          await this.simulateExecution(task, execution)
          return
        }

        // Get container mapping for task type
        const mapping = this.taskMappings.find(m => m.taskType === task.type)
        if (!mapping) {
          throw new Error(`No container mapping for task type: ${task.type}`)
        }

        // Update status
        execution.status = 'pulling'
        
        // Pull image
        try {
          await dockerClient.pullImage(mapping.image)
        } catch (error) {
          console.warn('Failed to pull image, may already exist:', error)
        }

        // Create container
        const containerName = `edgecloud-task-${task.id}`
        execution.containerId = await dockerClient.createContainer({
          image: mapping.image,
          name: containerName,
          cmd: mapping.command,
          env: mapping.env ? Object.entries(mapping.env).map(([k, v]) => `${k}=${v}`) : undefined,
          labels: {
            'edgecloud.task.id': task.id,
            'edgecloud.task.name': task.name,
            'edgecloud.task.type': task.type,
          },
          resources: mapping.resources,
        })

        // Start container
        execution.status = 'running'
        execution.startTime = new Date()
        await dockerClient.startContainer(execution.containerId)

        // Monitor container
        await this.monitorContainer(task, execution)
      })
    } catch (error) {
      execution.status = 'failed'
      execution.error = error instanceof Error ? error.message : 'Unknown error'
      execution.endTime = new Date()

      // Trigger webhook
      await webhookManager.triggerEvent('task.failed', {
        taskId: task.id,
        taskName: task.name,
        error: execution.error,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      })
    }
  }

  private async executeOnRemoteNode(
    task: Task,
    execution: ContainerExecution,
    nodeUrl: string
  ): Promise<void> {
    const mapping = this.taskMappings.find(m => m.taskType === task.type)
    if (!mapping) {
      throw new Error(`No container mapping for task type: ${task.type}`)
    }

    execution.status = 'running'
    execution.startTime = new Date()

    const result = await agentPool.executeTask(nodeUrl, {
      taskId: task.id,
      taskName: task.name,
      image: mapping.image,
      resources: mapping.resources
    }) as { status: string; exitCode: number; stdout: string; stderr: string }

    execution.endTime = new Date()

    if (result.status === 'completed' && result.exitCode === 0) {
      execution.status = 'completed'
      execution.logs = result.stdout.split('\n')

      await webhookManager.triggerEvent('task.completed', {
        taskId: task.id,
        taskName: task.name,
        duration: execution.endTime.getTime() - (execution.startTime?.getTime() || 0),
        cost: task.cost,
        output: result.stdout,
      })
    } else {
      execution.status = 'failed'
      execution.error = result.stderr || 'Remote execution failed'
      execution.logs = [result.stderr || 'Unknown error']

      await webhookManager.triggerEvent('task.failed', {
        taskId: task.id,
        taskName: task.name,
        error: execution.error,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      })
    }
  }

  private async monitorContainer(task: Task, execution: ContainerExecution): Promise<void> {
    const checkInterval = setInterval(async () => {
      try {
        const containers = await dockerClient.listContainers(true)
        const container = containers.find(c => c.id === execution.containerId)

        if (!container) {
          // Container removed
          clearInterval(checkInterval)
          execution.status = 'completed'
          execution.endTime = new Date()
          
          // Get logs
          try {
            const logs = await dockerClient.getContainerLogs(execution.containerId, 50)
            execution.logs = logs.split('\n')
          } catch {
            // Ignore log errors
          }

          // Trigger webhook
          await webhookManager.triggerEvent('task.completed', {
            taskId: task.id,
            taskName: task.name,
            duration: execution.endTime.getTime() - (execution.startTime?.getTime() || 0),
            cost: task.cost,
            output: execution.logs.join('\n'),
          })

          return
        }

        if (container.status === 'stopped') {
          clearInterval(checkInterval)
          execution.status = 'completed'
          execution.endTime = new Date()

          // Get logs
          try {
            const logs = await dockerClient.getContainerLogs(execution.containerId, 50)
            execution.logs = logs.split('\n')
          } catch {
            // Ignore log errors
          }

          // Trigger webhook
          await webhookManager.triggerEvent('task.completed', {
            taskId: task.id,
            taskName: task.name,
            duration: execution.endTime.getTime() - (execution.startTime?.getTime() || 0),
            cost: task.cost,
            output: execution.logs.join('\n'),
          })

          // Cleanup container
          try {
            await dockerClient.removeContainer(execution.containerId, true)
          } catch {
            // Ignore cleanup errors
          }
        }

      } catch (error) {
        console.error('Error monitoring container:', error)
      }
    }, 1000)

    // Timeout after task duration + 30 seconds
    setTimeout(() => {
      clearInterval(checkInterval)
      if (execution.status === 'running') {
        execution.status = 'failed'
        execution.error = 'Execution timeout'
        execution.endTime = new Date()

        // Stop and remove container
        dockerClient.stopContainer(execution.containerId, 0).catch(() => {})
        dockerClient.removeContainer(execution.containerId, true).catch(() => {})

        // Trigger webhook
        webhookManager.triggerEvent('task.failed', {
          taskId: task.id,
          taskName: task.name,
          error: 'Execution timeout',
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
        }).catch(() => {})
      }
    }, task.duration + 30000)
  }

  private async simulateExecution(task: Task, execution: ContainerExecution): Promise<void> {
    // Simulate execution with setTimeout
    setTimeout(async () => {
      const isFailed = Math.random() < 0.08
      
      if (isFailed) {
        execution.status = 'failed'
        execution.error = 'Simulated execution error'
        execution.endTime = new Date()

        await webhookManager.triggerEvent('task.failed', {
          taskId: task.id,
          taskName: task.name,
          error: execution.error,
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
        })
      } else {
        execution.status = 'completed'
        execution.endTime = new Date()
        execution.logs = [`Task ${task.name} completed successfully`]

        await webhookManager.triggerEvent('task.completed', {
          taskId: task.id,
          taskName: task.name,
          duration: task.duration,
          cost: task.cost,
          output: execution.logs.join('\n'),
        })
      }
    }, task.duration)
  }

  getExecution(taskId: string): ContainerExecution | undefined {
    return this.executions.get(taskId)
  }

  getAllExecutions(): ContainerExecution[] {
    return Array.from(this.executions.values())
  }

  setTaskMappings(mappings: TaskContainerMapping[]): void {
    this.taskMappings = mappings
  }

  getTaskMappings(): TaskContainerMapping[] {
    return this.taskMappings
  }
}

export const taskExecutor = new TaskExecutor()
