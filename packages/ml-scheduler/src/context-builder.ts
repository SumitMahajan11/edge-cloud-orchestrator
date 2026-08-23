import type { EdgeNode, Task } from "@edgecloud/shared-kernel";

/**
 * Builds a 12-dimensional scheduling feature/context vector for the contextual bandit.
 *
 * @param task Task definition
 * @param node EdgeNode candidate
 * @param carbonIntensity Carbon intensity at assignment time
 * @param hourOfDayNorm Optional normalized hour of the day [0, 1]
 */
export function buildSchedulingContext(
  task: Task,
  node: EdgeNode,
  carbonIntensity: number,
  hourOfDayNorm?: number
): number[] {
  const priorityMap: Record<string, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };

  const now = new Date();
  const h = hourOfDayNorm ?? now.getHours() / 24;
  const d = now.getDay() / 7;

  // Safe parse metadata (string in SQLite, object/JSON in PostgreSQL)
  let metadata: any = {};
  if (task.metadata) {
    if (typeof task.metadata === "string") {
      try {
        metadata = JSON.parse(task.metadata);
      } catch (_e) {
        // Fallback
      }
    } else {
      metadata = task.metadata;
    }
  }

  const estimatedDuration = (metadata.estimated_duration_ms as number) || 5000;
  const requiresGpu = metadata.requires_gpu ? 1 : 0;
  const imageSize = (metadata.image_size_mb as number) || 0;

  return [
    node.cpuUsage / 100,                                 // CPU load normalized
    node.memoryUsage / 100,                              // Memory load normalized
    node.tasksRunning / 20,                              // Active tasks scaled
    Math.min(1, node.latency / 1000),                    // Latency scaled
    Math.min(1, carbonIntensity / 1000.0),               // Carbon intensity normalized
    node.costPerHour / 2.0,                              // Cost hourly scaled
    (priorityMap[task.priority] ?? 1) / 3.0,             // Task priority normalized [0, 1]
    Math.min(1, estimatedDuration / 30000.0),            // Estimated duration scaled
    requiresGpu,                                         // Requires GPU binary
    Math.min(1, imageSize / 500.0),                      // Container image size scaled
    h,                                                   // Normalized hour of day
    d                                                    // Normalized day of week
  ];
}
