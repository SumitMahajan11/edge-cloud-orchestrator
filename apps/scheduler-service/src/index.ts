import crypto from 'crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import axios from 'axios';
import { EventBus, TOPICS } from '@edgecloud/event-bus';
import { RaftNode, StateMachine } from '@edgecloud/raft-consensus';
import { MultiObjectiveScorer, SchedulingPredictor } from '@edgecloud/ml-scheduler';
import { Task, EdgeNode, TaskScheduledEvent, SchedulingDecisionEvent } from '@edgecloud/shared-kernel';
import { CircuitBreakerRegistry } from '@edgecloud/circuit-breaker';

const app = Fastify({ logger: true, trustProxy: true });

// Configuration
const NODE_ID = process.env.NODE_ID || 'scheduler-1';
const RAFT_PEERS = (process.env.RAFT_PEERS || '').split(',').filter(Boolean).map(p => {
  const [id, host, port] = p.split(':');
  return { id, host, port: parseInt(port) };
});

const TASK_SERVICE_URL = process.env.TASK_SERVICE_URL || 'http://task-service:80';
const NODE_SERVICE_URL = process.env.NODE_SERVICE_URL || 'http://node-service:80';

// Event bus
const eventBus = new EventBus({
  clientId: `scheduler-${NODE_ID}`,
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

// ML Predictor
const predictor = new SchedulingPredictor();

// Scorer
const scorer = new MultiObjectiveScorer(predictor);

// Circuit breaker registry
const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Circuit breakers for external services
const taskServiceBreaker = circuitBreakerRegistry.getOrCreate('task-service', {
  failureThreshold: 3,
  resetTimeout: 15000,
});

const nodeServiceBreaker = circuitBreakerRegistry.getOrCreate('node-service', {
  failureThreshold: 3,
  resetTimeout: 15000,
});

// State machine for scheduling decisions
class SchedulingStateMachine implements StateMachine {
  private decisions: Map<string, any> = new Map();

  apply(command: unknown): void {
    const cmd = command as any;
    if (cmd.type === 'ASSIGN_TASK') {
      this.decisions.set(cmd.taskId, {
        nodeId: cmd.nodeId,
        score: cmd.score,
        timestamp: cmd.timestamp,
      });
    }
  }

  snapshot(): Buffer {
    return Buffer.from(JSON.stringify(Object.fromEntries(this.decisions)));
  }

  restore(snapshot: Buffer): void {
    this.decisions = new Map(Object.entries(JSON.parse(snapshot.toString())));
  }
}

// RAFT node
const stateMachine = new SchedulingStateMachine();
const raftNode = new RaftNode({
  id: NODE_ID,
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.RAFT_PORT || '7001'),
  peers: RAFT_PEERS,
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  maxLogEntriesPerRequest: 100,
}, stateMachine);

// Subscribe to task events
async function subscribeToEvents() {
  await eventBus.subscribe(TOPICS.TASK_EVENTS, `scheduler-${NODE_ID}`, async (event) => {
    if (event.eventType === 'TaskCreated') {
      // Only leader schedules tasks
      if (raftNode.isLeader()) {
        await scheduleTask(event.taskId);
      }
    }
  });
}

// Schedule a task
async function scheduleTask(taskId: string): Promise<void> {
  try {
    // Fetch task details
    const taskRes = await axios.get(`${TASK_SERVICE_URL}/tasks/${taskId}`);
    const task: Task = taskRes.data;

    if (task.status !== 'PENDING') {
      return; // Task already scheduled or cancelled
    }

    // Fetch healthy nodes
    const nodesRes = await axios.get(`${NODE_SERVICE_URL}/internal/nodes/healthy`);
    const nodes: EdgeNode[] = nodesRes.data;

    if (nodes.length === 0) {
      app.log.warn(`No healthy nodes available for task ${taskId}`);
      return;
    }

    // Score and rank nodes
    const ranked = scorer.rankNodes(task, nodes);
    const best = ranked[0];

    app.log.info(`Scheduling task ${taskId} to node ${best.nodeId} with score ${best.score}`);

    // Replicate through RAFT
    const command = {
      type: 'ASSIGN_TASK',
      taskId,
      nodeId: best.nodeId,
      score: best.score,
      timestamp: Date.now(),
    };

    const replicated = await raftNode.replicateCommand(command);
    
    if (!replicated) {
      app.log.error(`Failed to replicate scheduling decision for task ${taskId}`);
      return;
    }

    // Update task in task service
    await axios.post(`${TASK_SERVICE_URL}/internal/tasks/${taskId}/schedule`, {
      nodeId: best.nodeId,
      score: best.score,
    });

    // Publish scheduling decision event
    const decisionEvent: SchedulingDecisionEvent = {
      eventId: crypto.randomUUID(),
      eventType: 'SchedulingDecision',
      aggregateId: taskId,
      timestamp: new Date(),
      version: 1,
      taskId,
      nodeId: best.nodeId,
      score: best.score,
      scoreComponents: best.components,
      algorithm: 'multi-objective-ml',
    };

    await eventBus.publish(TOPICS.SCHEDULER_DECISIONS, decisionEvent);

  } catch (error) {
    app.log.error(`Error scheduling task ${taskId}: ${error}`);
  }
}

// API Routes
app.register(cors, { origin: true, credentials: true });

// Rate limiting
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1'],
});

app.get('/health', async () => {
  const circuitBreakerMetrics = circuitBreakerRegistry.getAllMetrics();
  const allHealthy = Object.values(circuitBreakerMetrics).every((m: any) => m.state !== 'OPEN');
  
  return {
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'scheduler-service',
    nodeId: NODE_ID,
    isLeader: raftNode.isLeader(),
    raftState: raftNode.getState(),
    timestamp: new Date().toISOString(),
    circuitBreakers: circuitBreakerMetrics,
  };
});

app.get('/metrics', async () => ({
  raft: raftNode.getMetrics(),
}));

// Trigger scheduling (for manual/ad-hoc scheduling)
app.post('/schedule/:taskId', async (request, reply) => {
  if (!raftNode.isLeader()) {
    reply.status(503).send({ 
      error: 'Not leader', 
      leaderId: raftNode.getLeaderId() 
    });
    return;
  }

  const { taskId } = request.params as any;
  await scheduleTask(taskId);
  reply.send({ scheduled: true });
});

// Start server
async function start() {
  await eventBus.connect();
  await subscribeToEvents();
  
  const port = parseInt(process.env.PORT || '3003');
  await app.listen({ port, host: '0.0.0.0' });
  
  app.log.info(`Scheduler Service (${NODE_ID}) running on port ${port}`);
  
  // Log leader changes
  raftNode.on('becameLeader', () => {
    app.log.info(`Became leader for term ${raftNode.getCurrentTerm()}`);
  });
  
  raftNode.on('stateChanged', (state) => {
    app.log.info(`RAFT state changed to ${state}`);
  });
}

// Graceful shutdown
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('Shutting down gracefully...');
  
  // Step down as leader if applicable
  raftNode.shutdown();
  
  // Stop accepting new connections
  await app.close();
  
  // Disconnect from event bus
  await eventBus.disconnect();
  
  console.log('Shutdown complete');
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  raftNode.shutdown();
  await app.close();
  await eventBus.disconnect();
  process.exit(0);
});

start();
