# Runbook: Task Stuck in Scheduling

## ALERT CONDITION
- **Metric**: `count(edgecloud_task_status{status=~"SCHEDULED|RUNNING"})` where `now() - timestamp > 300`
- **Threshold**: Tasks in non-terminal state for `> 5 minutes`.
- **Grafana Panel**: "Orchestrator -> Stuck Tasks"

## IMPACT
Users see tasks as "In Progress" indefinitely. Compute resources on edge nodes may be leaked if tasks are running but not reported.

## DIAGNOSIS STEPS
1. **Check Edge Agent Connectivity**:
   Identify if the assigned node is `OFFLINE`.
   - **Query**: `SELECT id, status, last_heartbeat FROM "Node" WHERE id = (SELECT "nodeId" FROM "Task" WHERE id = '<stuck_task_id>');`

2. **Verify Saga State**:
   Check if the Task Lifecycle Saga is stuck in a transition.
   - **Command (Redis)**: `kubectl exec -it redis-0 -- redis-cli HGETALL saga:task:<stuck_task_id>`

3. **Check Event Bus Backlog**:
   Verify if `tasks.events` topic is behind, delaying status updates.
   - **Command**: `kubectl exec -it kafka-0 -- kafka-consumer-groups --bootstrap-server localhost:9092 --group task-service --describe`

## RESOLUTION
1. **Force Saga Compensation**:
   Manually trigger a rollback of the saga to reset the task state to `PENDING` so it can be re-scheduled.
   - **Step**: Use the recovery utility or delete the saga key to trigger the orchestrator's timeout recovery.
   - **Command**: `kubectl exec -it redis-0 -- redis-cli DEL saga:task:<stuck_task_id>`

2. **Drain the problematic Node**:
   If a node is consistently losing tasks, prevent new tasks from being assigned.
   - **Query**: `UPDATE "Node" SET status = 'DRAINING' WHERE id = '<problematic_node_id>';`

3. **Restart the Agent**:
   If the agent is connected but not processing, force a restart.
   - **Command**: `kubectl rollout restart deployment agent -n <node-namespace>`

## ESCALATION
- **Level 2**: Contact Backend Engineering if the Saga state is `COMPENSATING` but stuck.
- **Level 3**: Contact Infrastructure Lead if Kafka message loss is suspected.

## POST-INCIDENT
- Audit the `Outbox` table for unsent status updates: `SELECT count(*) FROM "Outbox" WHERE status = 'PENDING';`
- Review Saga timeout settings in `apps/api/src/config/env.ts`.
- Check agent logs for `SIGTERM` or `OOM` events.
