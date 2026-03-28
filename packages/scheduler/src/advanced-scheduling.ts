import { EventEmitter } from 'eventemitter3';
import { Task, EdgeNode } from '@edgecloud/shared-kernel';

// Phase 11: Advanced Scheduling - Resource Reservations & Gang Scheduling

export interface ResourceReservation {
  id: string;
  taskId: string;
  nodeId: string;
  resources: {
    cpu: number;
    memory: number;
    gpu?: number;
  };
  reservedAt: Date;
  expiresAt: Date;
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED';
}

export interface GangSchedulingRequest {
  id: string;
  name: string;
  tasks: Task[];
  constraints: {
    minNodes: number;
    maxNodes: number;
    requireSameRack?: boolean;
    requireSameRegion?: boolean;
  };
  status: 'PENDING' | 'SCHEDULING' | 'SCHEDULED' | 'FAILED';
}

export interface AffinityConstraint {
  type: 'node-affinity' | 'pod-affinity' | 'pod-anti-affinity';
  weight: number; // 1-100
  expressions: {
    key: string;
    operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
    values: string[];
  }[];
}

export class ResourceReservationManager extends EventEmitter {
  private reservations: Map<string, ResourceReservation> = new Map();
  private nodeReservations: Map<string, Set<string>> = new Map();

  async createReservation(
    taskId: string,
    nodeId: string,
    resources: { cpu: number; memory: number; gpu?: number },
    ttlSeconds: number = 300
  ): Promise<ResourceReservation> {
    const reservation: ResourceReservation = {
      id: `res-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      nodeId,
      resources,
      reservedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      status: 'PENDING',
    };

    this.reservations.set(reservation.id, reservation);

    // Track reservations per node
    if (!this.nodeReservations.has(nodeId)) {
      this.nodeReservations.set(nodeId, new Set());
    }
    this.nodeReservations.get(nodeId)!.add(reservation.id);

    this.emit('reservationCreated', reservation);

    // Auto-expire reservation
    setTimeout(() => {
      this.releaseReservation(reservation.id);
    }, ttlSeconds * 1000);

    return reservation;
  }

  async confirmReservation(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    reservation.status = 'CONFIRMED';
    this.emit('reservationConfirmed', reservation);
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;

    reservation.status = 'RELEASED';

    // Remove from node tracking
    const nodeRes = this.nodeReservations.get(reservation.nodeId);
    if (nodeRes) {
      nodeRes.delete(reservationId);
    }

    this.emit('reservationReleased', reservation);
    this.reservations.delete(reservationId);
  }

  getNodeReservedResources(nodeId: string): { cpu: number; memory: number; gpu: number } {
    const reservationIds = this.nodeReservations.get(nodeId) || new Set();
    let cpu = 0;
    let memory = 0;
    let gpu = 0;

    for (const id of reservationIds) {
      const res = this.reservations.get(id);
      if (res && res.status !== 'RELEASED') {
        cpu += res.resources.cpu;
        memory += res.resources.memory;
        gpu += res.resources.gpu || 0;
      }
    }

    return { cpu, memory, gpu };
  }

  getAvailableResources(node: EdgeNode): { cpu: number; memory: number; gpu: number } {
    const reserved = this.getNodeReservedResources(node.id);
    return {
      cpu: 100 - node.cpuUsage - reserved.cpu,
      memory: 100 - node.memoryUsage - reserved.memory,
      gpu: 100 - reserved.gpu, // Assuming GPU usage tracking
    };
  }
}

export class GangScheduler extends EventEmitter {
  private pendingGangs: Map<string, GangSchedulingRequest> = new Map();
  private reservationManager: ResourceReservationManager;

  constructor(reservationManager: ResourceReservationManager) {
    super();
    this.reservationManager = reservationManager;
  }

  async submitGangRequest(request: GangSchedulingRequest): Promise<string> {
    this.pendingGangs.set(request.id, request);
    this.emit('gangRequestSubmitted', request);

    // Attempt to schedule immediately
    await this.scheduleGang(request.id);

    return request.id;
  }

  private async scheduleGang(gangId: string): Promise<void> {
    const request = this.pendingGangs.get(gangId);
    if (!request || request.status !== 'PENDING') return;

    request.status = 'SCHEDULING';
    this.emit('gangSchedulingStarted', request);

    // This is a simplified implementation
    // In production, this would query available nodes and check constraints

    // Simulate finding suitable nodes
    const requiredNodes = Math.min(request.constraints.minNodes, request.tasks.length);

    if (requiredNodes > 0) {
      request.status = 'SCHEDULED';
      this.emit('gangScheduled', request);
    } else {
      request.status = 'FAILED';
      this.emit('gangSchedulingFailed', request);
    }

    this.pendingGangs.delete(gangId);
  }
}

export class AffinityScorer {
  calculateAffinityScore(
    task: Task,
    node: EdgeNode,
    constraints: AffinityConstraint[]
  ): number {
    let totalScore = 0;
    let totalWeight = 0;

    for (const constraint of constraints) {
      totalWeight += constraint.weight;
      const constraintScore = this.evaluateConstraint(task, node, constraint);
      totalScore += constraintScore * (constraint.weight / 100);
    }

    return totalWeight > 0 ? totalScore : 1.0;
  }

  private evaluateConstraint(
    task: Task,
    node: EdgeNode,
    constraint: AffinityConstraint
  ): number {
    let matches = 0;
    let total = constraint.expressions.length;

    for (const expr of constraint.expressions) {
      const nodeValue = this.getNodeLabel(node, expr.key);

      switch (expr.operator) {
        case 'In':
          if (expr.values.includes(nodeValue)) matches++;
          break;
        case 'NotIn':
          if (!expr.values.includes(nodeValue)) matches++;
          break;
        case 'Exists':
          if (nodeValue !== undefined) matches++;
          break;
        case 'DoesNotExist':
          if (nodeValue === undefined) matches++;
          break;
      }
    }

    return total > 0 ? matches / total : 1.0;
  }

  private getNodeLabel(node: EdgeNode, key: string): string | undefined {
    const labels = node.labels as Record<string, string> || {};
    return labels[key];
  }
}

// Preemption support for high-priority tasks
export interface PreemptionCandidate {
  taskId: string;
  nodeId: string;
  priority: number;
  resources: { cpu: number; memory: number };
  startTime: Date;
}

export class PreemptionManager extends EventEmitter {
  private runningTasks: Map<string, PreemptionCandidate> = new Map();

  registerRunningTask(candidate: PreemptionCandidate): void {
    this.runningTasks.set(candidate.taskId, candidate);
  }

  unregisterRunningTask(taskId: string): void {
    this.runningTasks.delete(taskId);
  }

  findPreemptionCandidates(
    requiredResources: { cpu: number; memory: number },
    minPriority: number,
    targetNodeId: string
  ): PreemptionCandidate[] {
    const candidates: PreemptionCandidate[] = [];

    for (const task of this.runningTasks.values()) {
      if (task.nodeId === targetNodeId && task.priority < minPriority) {
        candidates.push(task);
      }
    }

    // Sort by priority (lowest first) and start time (oldest first)
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.startTime.getTime() - b.startTime.getTime();
    });

    // Find minimal set of tasks to preempt
    const toPreempt: PreemptionCandidate[] = [];
    let cpuAvailable = 0;
    let memoryAvailable = 0;

    for (const candidate of candidates) {
      if (cpuAvailable >= requiredResources.cpu && memoryAvailable >= requiredResources.memory) {
        break;
      }
      toPreempt.push(candidate);
      cpuAvailable += candidate.resources.cpu;
      memoryAvailable += candidate.resources.memory;
    }

    return toPreempt;
  }

  async preemptTasks(taskIds: string[]): Promise<void> {
    for (const taskId of taskIds) {
      const task = this.runningTasks.get(taskId);
      if (task) {
        this.emit('taskPreempted', task);
        this.runningTasks.delete(taskId);
      }
    }
  }
}
