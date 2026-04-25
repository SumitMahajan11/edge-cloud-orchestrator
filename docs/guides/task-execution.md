# Task Execution Guide

## Task Timeout Configuration

### Overview

All tasks have a maximum execution duration limit to prevent resource leaks and runaway containers. When a task exceeds its time limit, the system automatically terminates it.

### Default Timeout

- **Default**: `maxDurationSeconds = 3600` (1 hour)
- **Minimum**: 60 seconds (1 minute)
- **Maximum**: 86400 seconds (24 hours)

### How Timeout Works

When a task reaches its `maxDurationSeconds` limit:

1. **SIGTERM (Grace Period)**: Container receives `SIGTERM` signal
   - Application has 15 seconds to gracefully shut down
   - Clean up resources, save state, close connections
   
2. **SIGKILL (Force Termination)**: If container is still running after 15 seconds
   - Container is forcefully killed with `SIGKILL`
   - Exit code: `137` (128 + 9, where 9 is SIGKILL signal number)

3. **Task Status Update**: Task status changes to `TIMEOUT`
   - Visible in task logs and API responses
   - Can be retried if `maxRetries > 0`

### Setting Custom Timeout

When creating a task, specify `maxDurationSeconds`:

```bash
# 10-minute timeout
curl -X POST http://api.edgecloud.io/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "image": "python:3.11-slim",
    "command": "python process_data.py",
    "maxDurationSeconds": 600
  }'

# 5-minute timeout
curl -X POST http://api.edgecloud.io/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "image": "node:18-alpine",
    "command": "node scrape.js",
    "maxDurationSeconds": 300
  }'
```

### Timeout Examples

#### Example 1: Quick Task (1 minute)
```json
{
  "image": "alpine:latest",
  "command": "echo 'Hello World'",
  "maxDurationSeconds": 60
}
```

#### Example 2: Data Processing (30 minutes)
```json
{
  "image": "python:3.11",
  "command": "python etl_pipeline.py",
  "maxDurationSeconds": 1800,
  "resources": {
    "cpu": 2.0,
    "memory": "2g"
  }
}
```

#### Example 3: Long-Running ML Training (4 hours)
```json
{
  "image": "tensorflow/tensorflow:latest-gpu",
  "command": "python train_model.py --epochs=100",
  "maxDurationSeconds": 14400,
  "resources": {
    "cpu": 4.0,
    "memory": "8g"
  }
}
```

### Monitoring Timeouts

#### Check Task Status
```bash
curl http://api.edgecloud.io/tasks/<task-id> \
  -H "Authorization: Bearer <token>"
```

Response for timed-out task:
```json
{
  "id": "task-123",
  "status": "FAILED",
  "executions": [
    {
      "status": "TIMEOUT",
      "exitCode": 137,
      "error": "Task exceeded max duration: 600s",
      "durationMs": 600000
    }
  ]
}
```

#### View Task Logs
```bash
curl http://api.edgecloud.io/tasks/<task-id>/logs \
  -H "Authorization: Bearer <token>"
```

Timeout logs:
```
[WARN] Task task-123 exceeded max duration (600s), sending SIGTERM
[WARN] Task task-123 did not stop after SIGTERM, sending SIGKILL
[ERROR] Task task-123 failed: Task exceeded max duration: 600s
```

### Retry Behavior

Tasks that timeout can be automatically retried:

```json
{
  "image": "python:3.11",
  "command": "python fragile_script.py",
  "maxDurationSeconds": 300,
  "maxRetries": 3
}
```

- If task times out, it counts as 1 attempt
- System will retry up to `maxRetries` times
- Each retry gets the full `maxDurationSeconds` allocation
- Final status: `FAILED_PERMANENT` if all retries exhaust

### Best Practices

1. **Set Realistic Timeouts**: 
   - Test tasks locally to determine actual execution time
   - Add 20-30% buffer for variability
   
2. **Implement Graceful Shutdown**:
   ```python
   import signal
   import sys
   
   def cleanup(signum, frame):
       print("Received SIGTERM, cleaning up...")
       save_checkpoint()
       sys.exit(0)
   
   signal.signal(signal.SIGTERM, cleanup)
   ```

3. **Use Checkpoints for Long Tasks**:
   - Save progress periodically
   - Resume from checkpoint on retry
   
4. **Monitor Timeout Metrics**:
   - Track timeout rate per task type
   - Adjust `maxDurationSeconds` based on historical data

### Troubleshooting

#### Task Keeps Timing Out
1. Check if timeout is too low for the workload
2. Profile task execution time locally
3. Increase `maxDurationSeconds` or optimize the task

#### Container Not Responding to SIGTERM
1. Ensure application handles SIGTERM properly
2. Check for blocked I/O operations
3. Add signal handlers for graceful shutdown

#### Exit Code 137
- Indicates container was killed by SIGKILL
- Usually means task ignored SIGTERM or took >15s to shut down
- Review application shutdown logic
