import { EventEmitter } from 'eventemitter3';
import { EventBus } from '@edgecloud/event-bus';

export interface ChaosExperiment {
  id: string;
  name: string;
  type: 'node-failure' | 'network-partition' | 'latency' | 'packet-loss' | 'cpu-stress' | 'memory-stress' | 'db-failure' | 'kafka-failure';
  target: {
    service?: string;
    nodeId?: string;
    region?: string;
  };
  duration: number; // seconds
  intensity: number; // 0-1 for percentage or multiplier
  schedule?: {
    cron?: string;
    runOnce?: boolean;
  };
}

export interface ExperimentResult {
  experimentId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  events: ChaosEvent[];
  metrics: {
    tasksAffected: number;
    nodesAffected: number;
    recoveryTime?: number;
  };
}

export interface ChaosEvent {
  timestamp: Date;
  type: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
}

export class ChaosEngine extends EventEmitter {
  private experiments: Map<string, ExperimentResult> = new Map();
  private activeExperiments: Map<string, NodeJS.Timeout> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    super();
    this.eventBus = eventBus;
  }

  async startExperiment(experiment: ChaosExperiment): Promise<string> {
    const result: ExperimentResult = {
      experimentId: experiment.id,
      startTime: new Date(),
      status: 'running',
      events: [],
      metrics: {
        tasksAffected: 0,
        nodesAffected: 0,
      },
    };

    this.experiments.set(experiment.id, result);

    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'EXPERIMENT_STARTED',
      description: `Starting chaos experiment: ${experiment.name}`,
      severity: 'info',
    });

    // Execute experiment based on type
    switch (experiment.type) {
      case 'node-failure':
        await this.simulateNodeFailure(experiment);
        break;
      case 'network-partition':
        await this.simulateNetworkPartition(experiment);
        break;
      case 'latency':
        await this.injectLatency(experiment);
        break;
      case 'packet-loss':
        await this.injectPacketLoss(experiment);
        break;
      case 'cpu-stress':
        await this.injectCPUStress(experiment);
        break;
      case 'memory-stress':
        await this.injectMemoryStress(experiment);
        break;
      case 'db-failure':
        await this.simulateDatabaseFailure(experiment);
        break;
      case 'kafka-failure':
        await this.simulateKafkaFailure(experiment);
        break;
    }

    // Schedule experiment end
    const timeout = setTimeout(() => {
      this.stopExperiment(experiment.id);
    }, experiment.duration * 1000);

    this.activeExperiments.set(experiment.id, timeout);

    this.emit('experimentStarted', experiment);

    return experiment.id;
  }

  async stopExperiment(experimentId: string): Promise<void> {
    const result = this.experiments.get(experimentId);
    if (!result) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    // Clear timeout
    const timeout = this.activeExperiments.get(experimentId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeExperiments.delete(experimentId);
    }

    result.endTime = new Date();
    result.status = 'completed';
    result.metrics.recoveryTime = this.calculateRecoveryTime(result);

    this.logEvent(experimentId, {
      timestamp: new Date(),
      type: 'EXPERIMENT_STOPPED',
      description: `Chaos experiment stopped after ${result.metrics.recoveryTime}ms`,
      severity: 'info',
    });

    this.emit('experimentStopped', result);

    // Publish event for monitoring
    await this.eventBus.publish('system.alerts', {
      eventType: 'ChaosExperimentCompleted',
      aggregateId: experimentId,
      timestamp: new Date(),
      version: 1,
      experimentId,
      duration: result.metrics.recoveryTime,
      tasksAffected: result.metrics.tasksAffected,
      nodesAffected: result.metrics.nodesAffected,
    });
  }

  getExperimentResult(experimentId: string): ExperimentResult | undefined {
    return this.experiments.get(experimentId);
  }

  getAllExperiments(): ExperimentResult[] {
    return Array.from(this.experiments.values());
  }

  private async simulateNodeFailure(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'NODE_FAILURE_INJECTED',
      description: `Simulating node failure for node ${experiment.target.nodeId}`,
      severity: 'critical',
    });

    // Publish node failure event
    await this.eventBus.publish('nodes.events', {
      eventType: 'NodeFailed',
      aggregateId: experiment.target.nodeId || 'unknown',
      timestamp: new Date(),
      version: 1,
      nodeId: experiment.target.nodeId,
      reason: 'CHAOS_EXPERIMENT',
      experimentId: experiment.id,
    });

    const result = this.experiments.get(experiment.id)!;
    result.metrics.nodesAffected = 1;
  }

  private async simulateNetworkPartition(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'NETWORK_PARTITION_INJECTED',
      description: `Simulating network partition for service ${experiment.target.service}`,
      severity: 'critical',
    });

    // This would integrate with network chaos tools like Chaos Mesh or Gremlin
    // For now, we simulate by publishing events
    await this.eventBus.publish('system.alerts', {
      eventType: 'NetworkPartition',
      aggregateId: experiment.id,
      timestamp: new Date(),
      version: 1,
      service: experiment.target.service,
      region: experiment.target.region,
      duration: experiment.duration,
    });
  }

  private async injectLatency(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'LATENCY_INJECTED',
      description: `Injecting ${experiment.intensity * 100}ms latency`,
      severity: 'warning',
    });

    // Publish latency injection event
    await this.eventBus.publish('system.alerts', {
      eventType: 'LatencyInjected',
      aggregateId: experiment.id,
      timestamp: new Date(),
      version: 1,
      latencyMs: experiment.intensity * 100,
      target: experiment.target,
    });
  }

  private async injectPacketLoss(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'PACKET_LOSS_INJECTED',
      description: `Injecting ${experiment.intensity * 100}% packet loss`,
      severity: 'warning',
    });

    await this.eventBus.publish('system.alerts', {
      eventType: 'PacketLossInjected',
      aggregateId: experiment.id,
      timestamp: new Date(),
      version: 1,
      packetLossPercent: experiment.intensity * 100,
      target: experiment.target,
    });
  }

  private async injectCPUStress(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'CPU_STRESS_INJECTED',
      description: `Injecting CPU stress at ${experiment.intensity * 100}%`,
      severity: 'warning',
    });

    await this.eventBus.publish('system.alerts', {
      eventType: 'CPUStressInjected',
      aggregateId: experiment.id,
      timestamp: new Date(),
      version: 1,
      cpuPercent: experiment.intensity * 100,
      target: experiment.target,
    });
  }

  private async injectMemoryStress(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'MEMORY_STRESS_INJECTED',
      description: `Injecting memory stress`,
      severity: 'warning',
    });

    await this.eventBus.publish('system.alerts', {
      eventType: 'MemoryStressInjected',
      aggregateId: experiment.id,
      timestamp: new Date(),
      version: 1,
      memoryPercent: experiment.intensity * 100,
      target: experiment.target,
    });
  }

  private async simulateDatabaseFailure(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'DB_FAILURE_INJECTED',
      description: 'Simulating database failure',
      severity: 'critical',
    });

    await this.eventBus.publish('system.alerts', {
      eventType: 'DatabaseFailure',
      aggregateId: experiment.id,
      timestamp: new Date(),
      version: 1,
      failureType: 'connection_refused',
    });
  }

  private async simulateKafkaFailure(experiment: ChaosExperiment): Promise<void> {
    this.logEvent(experiment.id, {
      timestamp: new Date(),
      type: 'KAFKA_FAILURE_INJECTED',
      description: 'Simulating Kafka failure',
      severity: 'critical',
    });

    await this.eventBus.publish('system.alerts', {
      eventType: 'KafkaFailure',
      aggregateId: experiment.id,
      timestamp: new Date(),
      version: 1,
      failureType: 'broker_unavailable',
    });
  }

  private logEvent(experimentId: string, event: ChaosEvent): void {
    const result = this.experiments.get(experimentId);
    if (result) {
      result.events.push(event);
    }
    this.emit('chaosEvent', { experimentId, event });
  }

  private calculateRecoveryTime(result: ExperimentResult): number {
    if (!result.endTime) return 0;
    return result.endTime.getTime() - result.startTime.getTime();
  }
}

// Predefined chaos experiments
export const PREDEFINED_EXPERIMENTS: ChaosExperiment[] = [
  {
    id: 'node-failure-1',
    name: 'Single Node Failure',
    type: 'node-failure',
    target: {},
    duration: 60,
    intensity: 1,
  },
  {
    id: 'network-latency-1',
    name: 'Network Latency Injection',
    type: 'latency',
    target: {},
    duration: 300,
    intensity: 0.5, // 50ms
  },
  {
    id: 'db-failure-1',
    name: 'Database Connection Failure',
    type: 'db-failure',
    target: {},
    duration: 30,
    intensity: 1,
  },
  {
    id: 'kafka-failure-1',
    name: 'Kafka Broker Failure',
    type: 'kafka-failure',
    target: {},
    duration: 60,
    intensity: 1,
  },
  {
    id: 'cpu-stress-1',
    name: 'CPU Stress Test',
    type: 'cpu-stress',
    target: {},
    duration: 120,
    intensity: 0.8, // 80% CPU
  },
];
