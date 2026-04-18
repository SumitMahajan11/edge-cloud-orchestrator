import { Pool } from 'pg';
import { createLogger } from '@edgecloud/shared-kernel';

const logger = createLogger('ml-feature-extractor');

export interface TrainingRow {
  // Node Features
  cpu_usage_pct: number;
  ram_usage_pct: number;
  current_task_count: number;
  avg_latency_ms: number;
  historical_success_rate_7d: number;
  region_cost_rate: number;
  
  // Task Features
  priority: number;
  estimated_duration_ms: number;
  requires_gpu: number;
  image_size_mb: number;
  
  // Temporal Features
  hour_of_day: number;
  day_of_week: number;
  
  // Target
  scheduling_score: number; // 1.0 = on time, 0.5 = late, 0.0 = failure
}

export class FeatureExtractor {
  constructor(private pool: Pool) {}

  async extractTrainingData(lookbackDays: number = 7): Promise<TrainingRow[]> {
    logger.info(`Extracting training data for the last ${lookbackDays} days...`);
    
    // This query joins task executions with their scheduling decisions and node/task metadata
    const query = `
      SELECT 
        sd.score_components->>'cpu' as cpu_score_comp,
        sd.score_components->>'memory' as memory_score_comp,
        sd.score_components->>'latency' as latency_score_comp,
        sd.score_components->>'cost' as cost_score_comp,
        t.priority,
        t.metadata->>'estimated_duration_ms' as estimated_duration,
        t.metadata->>'requires_gpu' as requires_gpu,
        t.metadata->>'image_size_mb' as image_size,
        te.status as outcome_status,
        te.execution_time_ms,
        te.created_at as executed_at,
        n.cpu_usage,
        n.memory_usage,
        n.tasks_running,
        n.cost_per_hour,
        n.latency as node_latency
      FROM scheduling_decisions sd
      JOIN task_executions te ON sd.task_id = te.task_id AND sd.node_id = te.node_id
      JOIN tasks t ON sd.task_id = t.id
      JOIN nodes n ON sd.node_id = n.id
      WHERE sd.created_at > NOW() - INTERVAL '${lookbackDays} days'
      AND te.status IN ('COMPLETED', 'FAILED')
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows.map(row => this.mapToTrainingRow(row));
    } catch (error) {
      logger.error({ error }, 'Failed to extract training data');
      throw error;
    }
  }

  private mapToTrainingRow(row: any): TrainingRow {
    const executedAt = new Date(row.executed_at);
    
    // Priority mapping
    const priorityMap: Record<string, number> = {
      'LOW': 0,
      'MEDIUM': 1,
      'HIGH': 2,
      'CRITICAL': 3
    };

    // Outcome scoring logic (Requirement: 1.0 = on time, 0.5 = late, 0.0 = failed)
    let schedulingScore = 0.0;
    if (row.outcome_status === 'COMPLETED') {
      const estimated = parseFloat(row.estimated_duration) || 5000;
      const actual = parseFloat(row.execution_time_ms) || 0;
      
      if (actual <= estimated) {
        schedulingScore = 1.0;
      } else {
        schedulingScore = 0.5;
      }
    }

    return {
      cpu_usage_pct: parseFloat(row.cpu_usage || '0'),
      ram_usage_pct: parseFloat(row.memory_usage || '0'),
      current_task_count: parseInt(row.tasks_running || '0'),
      avg_latency_ms: parseFloat(row.node_latency || '0'),
      historical_success_rate_7d: 0.95, // Placeholder - ideally from a summary table
      region_cost_rate: parseFloat(row.cost_per_hour || '0.05'),
      
      priority: priorityMap[row.priority] || 1,
      estimated_duration_ms: parseFloat(row.estimated_duration) || 5000,
      requires_gpu: row.requires_gpu === 'true' || row.requires_gpu === true ? 1 : 0,
      image_size_mb: parseFloat(row.image_size) || 0,
      
      hour_of_day: executedAt.getHours(),
      day_of_week: executedAt.getDay(),
      
      scheduling_score: schedulingScore
    };
  }
}
