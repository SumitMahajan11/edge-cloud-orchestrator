import { EventEmitter } from 'eventemitter3';
import { EventBus, TOPICS } from '@edgecloud/event-bus';

// Phase 12: Data Pipeline - Stream Processing & Analytics

export interface StreamWindow {
  startTime: Date;
  endTime: Date;
  events: StreamEvent[];
}

export interface StreamEvent {
  timestamp: Date;
  type: string;
  data: any;
}

export interface AggregationRule {
  id: string;
  name: string;
  sourceTopic: string;
  windowType: 'tumbling' | 'sliding' | 'session';
  windowSize: number; // milliseconds
  slideInterval?: number; // for sliding windows
  groupBy: string[];
  aggregations: {
    field: string;
    operation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'percentile';
    alias: string;
    percentile?: number; // for percentile operation
  }[];
  outputTopic: string;
}

export class StreamProcessor extends EventEmitter {
  private eventBus: EventBus;
  private rules: Map<string, AggregationRule> = new Map();
  private windows: Map<string, StreamWindow> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(eventBus: EventBus) {
    super();
    this.eventBus = eventBus;
  }

  async start(): Promise<void> {
    // Subscribe to raw metrics topic
    await this.eventBus.subscribe(TOPICS.METRICS_RAW, 'stream-processor', async (event) => {
      await this.processEvent(event as StreamEvent);
    });

    // Start window processing loop
    this.processingInterval = setInterval(() => {
      this.processWindows();
    }, 1000);

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.emit('stopped');
  }

  registerRule(rule: AggregationRule): void {
    this.rules.set(rule.id, rule);
    this.emit('ruleRegistered', rule);
  }

  private async processEvent(event: StreamEvent): Promise<void> {
    for (const rule of this.rules.values()) {
      if (event.type === rule.sourceTopic) {
        await this.addToWindow(rule, event);
      }
    }
  }

  private async addToWindow(rule: AggregationRule, event: StreamEvent): Promise<void> {
    const windowKey = this.getWindowKey(rule, event);
    
    let window = this.windows.get(windowKey);
    if (!window) {
      window = {
        startTime: new Date(),
        endTime: new Date(Date.now() + rule.windowSize),
        events: [],
      };
      this.windows.set(windowKey, window);
    }

    window.events.push(event);
  }

  private async processWindows(): Promise<void> {
    const now = new Date();

    for (const [key, window] of this.windows.entries()) {
      if (window.endTime <= now) {
        await this.emitWindowResults(key, window);
        this.windows.delete(key);
      }
    }
  }

  private async emitWindowResults(windowKey: string, window: StreamWindow): Promise<void> {
    const [ruleId] = windowKey.split(':');
    const rule = this.rules.get(ruleId);
    if (!rule) return;

    const results = this.aggregateWindow(rule, window);

    await this.eventBus.publish(rule.outputTopic, {
      eventType: 'WindowAggregated',
      aggregateId: windowKey,
      timestamp: new Date(),
      version: 1,
      window: {
        startTime: window.startTime,
        endTime: window.endTime,
        duration: window.endTime.getTime() - window.startTime.getTime(),
      },
      aggregations: results,
      eventCount: window.events.length,
    });

    this.emit('windowProcessed', { windowKey, results });
  }

  private aggregateWindow(rule: AggregationRule, window: StreamWindow): Record<string, any> {
    const results: Record<string, any> = {};

    for (const agg of rule.aggregations) {
      const values = window.events.map(e => this.getNestedValue(e.data, agg.field));
      
      switch (agg.operation) {
        case 'count':
          results[agg.alias] = values.length;
          break;
        case 'sum':
          results[agg.alias] = values.reduce((a, b) => a + (Number(b) || 0), 0);
          break;
        case 'avg':
          results[agg.alias] = values.reduce((a, b) => a + (Number(b) || 0), 0) / values.length;
          break;
        case 'min':
          results[agg.alias] = Math.min(...values.map(v => Number(v) || 0));
          break;
        case 'max':
          results[agg.alias] = Math.max(...values.map(v => Number(v) || 0));
          break;
        case 'percentile':
          results[agg.alias] = this.calculatePercentile(values, agg.percentile || 95);
          break;
      }
    }

    return results;
  }

  private getWindowKey(rule: AggregationRule, event: StreamEvent): string {
    const groupValues = rule.groupBy.map(field => this.getNestedValue(event.data, field));
    return `${rule.id}:${groupValues.join(':')}:${Math.floor(Date.now() / rule.windowSize)}`;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, p) => o?.[p], obj);
  }

  private calculatePercentile(values: any[], percentile: number): number {
    const sorted = values.map(v => Number(v) || 0).sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

// Real-time Analytics Dashboard Data
export interface DashboardMetrics {
  timestamp: Date;
  metrics: {
    tasksPerSecond: number;
    averageTaskDuration: number;
    successRate: number;
    activeNodes: number;
    cpuUtilization: number;
    memoryUtilization: number;
    schedulingLatency: number;
  };
}

export class RealTimeAnalytics extends EventEmitter {
  private eventBus: EventBus;
  private metrics: DashboardMetrics[] = [];
  private maxHistorySize: number = 1000;

  constructor(eventBus: EventBus) {
    super();
    this.eventBus = eventBus;
  }

  async start(): Promise<void> {
    // Subscribe to aggregated metrics
    await this.eventBus.subscribe(TOPICS.METRICS_AGGREGATED, 'analytics', async (event) => {
      await this.processAggregatedMetrics(event);
    });

    // Start real-time calculation
    setInterval(() => {
      this.calculateRealTimeMetrics();
    }, 5000);
  }

  private async processAggregatedMetrics(event: any): Promise<void> {
    // Store for historical analysis
    this.metrics.push({
      timestamp: new Date(),
      metrics: event.aggregations,
    });

    // Keep only recent history
    if (this.metrics.length > this.maxHistorySize) {
      this.metrics = this.metrics.slice(-this.maxHistorySize);
    }

    this.emit('metricsUpdated', this.getLatestMetrics());
  }

  private calculateRealTimeMetrics(): void {
    const latest = this.getLatestMetrics();
    
    // Publish real-time dashboard update
    this.eventBus.publish('metrics.realtime', {
      eventType: 'RealtimeMetrics',
      aggregateId: 'dashboard',
      timestamp: new Date(),
      version: 1,
      metrics: latest,
    });
  }

  getLatestMetrics(): DashboardMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  getMetricsHistory(durationMinutes: number): DashboardMetrics[] {
    const cutoff = new Date(Date.now() - durationMinutes * 60 * 1000);
    return this.metrics.filter(m => m.timestamp >= cutoff);
  }

  // Anomaly detection
  detectAnomalies(): Array<{ metric: string; value: number; threshold: number; severity: 'warning' | 'critical' }> {
    const anomalies: Array<{ metric: string; value: number; threshold: number; severity: 'warning' | 'critical' }> = [];
    const latest = this.getLatestMetrics();

    if (!latest) return anomalies;

    // Check success rate
    if (latest.metrics.successRate < 0.95) {
      anomalies.push({
        metric: 'successRate',
        value: latest.metrics.successRate,
        threshold: 0.95,
        severity: latest.metrics.successRate < 0.90 ? 'critical' : 'warning',
      });
    }

    // Check CPU utilization
    if (latest.metrics.cpuUtilization > 85) {
      anomalies.push({
        metric: 'cpuUtilization',
        value: latest.metrics.cpuUtilization,
        threshold: 85,
        severity: latest.metrics.cpuUtilization > 95 ? 'critical' : 'warning',
      });
    }

    // Check scheduling latency
    if (latest.metrics.schedulingLatency > 100) {
      anomalies.push({
        metric: 'schedulingLatency',
        value: latest.metrics.schedulingLatency,
        threshold: 100,
        severity: latest.metrics.schedulingLatency > 500 ? 'critical' : 'warning',
      });
    }

    return anomalies;
  }
}

// Predictive Analytics
export class PredictiveAnalytics extends EventEmitter {
  private historicalData: any[] = [];

  addDataPoint(point: any): void {
    this.historicalData.push({
      ...point,
      timestamp: new Date(),
    });

    // Keep last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.historicalData = this.historicalData.filter(d => d.timestamp >= cutoff);
  }

  predictLoad(nextMinutes: number): { timestamp: Date; predictedTasks: number; confidence: number }[] {
    // Simple moving average prediction
    const predictions: { timestamp: Date; predictedTasks: number; confidence: number }[] = [];
    
    const recentLoad = this.historicalData.slice(-12); // Last hour (5-min intervals)
    const avgLoad = recentLoad.reduce((sum, d) => sum + (d.tasksPerSecond || 0), 0) / recentLoad.length;
    
    for (let i = 1; i <= nextMinutes / 5; i++) {
      predictions.push({
        timestamp: new Date(Date.now() + i * 5 * 60 * 1000),
        predictedTasks: Math.round(avgLoad * 5 * 60), // 5 minutes worth of tasks
        confidence: 0.7, // Simplified confidence score
      });
    }

    return predictions;
  }

  predictNodeFailures(): { nodeId: string; probability: number; reasons: string[] }[] {
    // Analyze node health patterns to predict failures
    const predictions: { nodeId: string; probability: number; reasons: string[] }[] = [];

    // Group by node
    const nodeData = new Map<string, any[]>();
    for (const point of this.historicalData) {
      if (point.nodeId) {
        if (!nodeData.has(point.nodeId)) {
          nodeData.set(point.nodeId, []);
        }
        nodeData.get(point.nodeId)!.push(point);
      }
    }

    // Analyze each node
    for (const [nodeId, data] of nodeData) {
      const recent = data.slice(-6); // Last 30 minutes
      const avgCpu = recent.reduce((sum, d) => sum + (d.cpuUsage || 0), 0) / recent.length;
      const avgMemory = recent.reduce((sum, d) => sum + (d.memoryUsage || 0), 0) / recent.length;
      const errorRate = recent.filter(d => d.status === 'error').length / recent.length;

      const reasons: string[] = [];
      let probability = 0;

      if (avgCpu > 90) {
        probability += 0.3;
        reasons.push('Sustained high CPU usage');
      }
      if (avgMemory > 90) {
        probability += 0.3;
        reasons.push('Sustained high memory usage');
      }
      if (errorRate > 0.1) {
        probability += 0.4;
        reasons.push('Increased error rate');
      }

      if (probability > 0) {
        predictions.push({ nodeId, probability: Math.min(probability, 1), reasons });
      }
    }

    return predictions.sort((a, b) => b.probability - a.probability);
  }
}
