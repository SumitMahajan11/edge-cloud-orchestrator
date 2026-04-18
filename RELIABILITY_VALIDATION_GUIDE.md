# 🔍 Reliability Validation Guide

**Quick reference for testing all reliability improvements**

---

## ✅ 1. Testing Retry with Exponential Backoff

### Manual Test
```typescript
// Import the retry utility
import { retryWithBackoff } from '@edgecloud/circuit-breaker';

// Simulate flaky service
let attempts = 0;
const flakyOperation = async () => {
  attempts++;
  if (attempts < 3) {
    throw new Error('Service temporarily unavailable');
  }
  return 'Success!';
};

// Should succeed on 3rd attempt
const result = await retryWithBackoff(flakyOperation, {
  maxRetries: 5,
  baseDelay: 100,
  maxDelay: 5000,
});

console.log(result); // 'Success!'
console.log(attempts); // 3
```

### Automated Test
```bash
cd edge-cloud-orchestrator
npm test -- packages/circuit-breaker/tests/retry.test.ts
```

### What to Look For
- ✅ Exponential increase in delay between retries
- ✅ Success after transient failure
- ✅ Proper error after max retries exhausted

---

## ✅ 2. Testing Circuit Breakers

### Manual Test
```typescript
const breaker = circuitBreakerRegistry.getOrCreate('test-service', {
  failureThreshold: 3,
  resetTimeout: 10000,
});

// Trigger failures
for (let i = 0; i < 3; i++) {
  try {
    await breaker.execute(() => Promise.reject(new Error('Fail')));
  } catch (error) {
    console.log(`Failure ${i + 1}`);
  }
}

// Circuit should now be OPEN
console.log(breaker.getState()); // 'OPEN'

// Wait for reset timeout
await new Promise(resolve => setTimeout(resolve, 10000));

// Circuit should be HALF_OPEN
console.log(breaker.getState()); // 'HALF_OPEN'

// Successful call should close it
await breaker.execute(() => Promise.resolve('Success'));
console.log(breaker.getState()); // 'CLOSED'
```

### Metrics Check
```typescript
const metrics = breaker.getMetrics();
console.log(metrics);
// {
//   state: 'CLOSED',
//   failures: 3,
//   successes: 1,
//   totalCalls: 4,
//   rejectedCalls: 0,
// }
```

### What to Look For
- ✅ Opens after failure threshold
- ✅ Transitions to half-open after timeout
- ✅ Closes after successful calls
- ✅ Rejects calls when open

---

## ✅ 3. Testing Request Timeouts

### Manual Test
```typescript
import { 
  withTimeout, 
  fetchWithTimeout, 
  TimeoutError,
  DEFAULT_TIMEOUTS 
} from './utils/timeout.util';

// Test 1: Generic promise timeout
try {
  await withTimeout(
    new Promise(resolve => setTimeout(resolve, 10000)),
    1000,
    'Slow operation'
  );
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('✓ Timed out as expected:', error.message);
  }
}

// Test 2: Fetch with timeout
try {
  await fetchWithTimeout('https://httpstat.us/200?sleep=5000', {
    timeoutMs: 2000,
  });
} catch (error) {
  console.log('✓ Fetch timed out:', error.message);
}

// Test 3: Fast operation succeeds
try {
  const result = await withTimeout(
    Promise.resolve('Fast'),
    5000,
    'Fast operation'
  );
  console.log('✓ Fast operation succeeded:', result);
}
```

### What to Look For
- ✅ TimeoutError thrown on timeout
- ✅ Operation completes successfully if fast enough
- ✅ Clear error messages with operation name

---

## ✅ 4. Testing WebSocket Race Condition Fix

### Manual Test (Browser Console)
```javascript
// Before fix: Events lost
// After fix: All events received

const wsClient = window.wsClient;

// Subscribe immediately (before connected)
wsClient.subscribe('tasks', (data) => {
  console.log('✓ Received task update:', data);
});

// Connect after subscription
await wsClient.connect();

// Send test event from server
// Should receive the event
```

### Test Sequence
```typescript
// 1. Create client
const client = new WebSocketClient(url);

// 2. Subscribe BEFORE connecting
client.subscribe('nodes', handler);
console.log('Subscription queued');

// 3. Connect AFTER subscribing
await client.connect();
console.log('Connected');

// 4. Server should receive subscription message
// 5. Client should receive broadcast on 'nodes' channel
```

### What to Look For
- ✅ Subscription queued while disconnected
- ✅ Subscription sent automatically on connect
- ✅ No missed events
- ✅ Console log shows "Queueing subscription" and "Flushing pending subscriptions"

---

## ✅ 5. Testing Graceful Shutdown

### Manual Test
```bash
# Start backend
cd backend
npm run dev

# In another terminal, send SIGTERM
kill -SIGTERM $(pgrep -f "node.*backend")

# Watch logs for graceful shutdown sequence
```

### Expected Log Output
```
[INFO] Received SIGTERM, starting graceful shutdown...
[INFO] Stopping HTTP server...
[INFO] HTTP server closed
[INFO] Disconnecting from database...
[INFO] Database disconnected
[INFO] Quitting Redis...
[INFO] Redis disconnected
[INFO] Disconnecting Kafka...
[INFO] Kafka disconnected
[INFO] Closing WebSocket connections...
[INFO] All clients disconnected
[INFO] Graceful shutdown completed
```

### What to Look For
- ✅ No "force kill" messages
- ✅ All connections closed cleanly
- ✅ Process exits with code 0
- ✅ No orphaned connections

---

## ✅ 6. Testing Idempotency

### Manual Test
```typescript
// First request
const result1 = await idempotencyService.checkAndRecord({
  idempotencyKey: 'task-create-123',
  resourceType: 'task',
  resourceId: 'task-uuid',
});

console.log(result1.isDuplicate); // false
console.log(result1.recordId); // some-id

// Second request with same key
const result2 = await idempotencyService.checkAndRecord({
  idempotencyKey: 'task-create-123',
  resourceType: 'task',
  resourceId: 'task-uuid',
});

console.log(result2.isDuplicate); // true
console.log(result2.existingResult); // cached result
```

### API Test
```bash
# First request
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{"name":"Test Task"}'

# Second request with same key
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{"name":"Test Task"}'

# Should return same response without creating duplicate
```

### What to Look For
- ✅ First request processed normally
- ✅ Duplicate requests return cached result
- ✅ No duplicate database records
- ✅ Cache hit on second request

---

## ✅ 7. Testing Dead Letter Queue

### Manual Test
```typescript
// Process message that will fail
const message = {
  topic: 'tasks',
  value: { taskId: '123' },
  offset: 42,
};

try {
  await processMessage(message);
} catch (error) {
  // Send to DLQ
  await dlqService.sendToDLQ({
    originalTopic: message.topic,
    value: message.value,
    errorMessage: error.message,
    retryCount: 0,
    maxRetries: 3,
  });
  
  console.log('✓ Message sent to DLQ');
}

// Check DLQ stats
const stats = await dlqService.getStats();
console.log(stats);
// { pending: 1, processing: 0, resolved: 0, exhausted: 0 }

// Reprocess from DLQ
await dlqService.reprocessMessage(messageId);
```

### Kafka Topic Check
```bash
# List DLQ topics
kafka-topics.sh --bootstrap-server localhost:9092 --list | grep dlq

# Consume DLQ messages
kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic dlq-tasks \
  --from-beginning
```

### What to Look For
- ✅ Failed messages sent to Kafka DLQ topic
- ✅ Retry scheduled in Redis
- ✅ Can reprocess manually
- ✅ Metrics show pending/resolved counts

---

## ✅ 8. Testing Input Validation

### Manual Test
```typescript
import { registerNodeSchema } from '../schemas';

// Valid data
try {
  const valid = registerNodeSchema.parse({
    name: 'Node-1',
    region: 'us-east',
    ipAddress: '192.168.1.1',
  });
  console.log('✓ Valid data accepted');
} catch (error) {
  console.error('✗ Valid data rejected:', error);
}

// Invalid data
try {
  const invalid = registerNodeSchema.parse({
    name: '', // Empty not allowed
    region: 'us-east',
  });
  console.error('✗ Invalid data accepted');
} catch (error) {
  console.log('✓ Invalid data rejected:', error.errors);
}
```

### API Test
```bash
# Valid request
curl -X POST http://localhost:3000/api/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Node-1",
    "region": "us-east",
    "ipAddress": "192.168.1.1"
  }'

# Invalid request (missing required field)
curl -X POST http://localhost:3000/api/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Node-1"
  }'

# Should return 400 Bad Request
```

### What to Look For
- ✅ Valid data passes through
- ✅ Invalid data rejected with 400 status
- ✅ Clear error messages
- ✅ Type coercion where appropriate

---

## ✅ 9. Testing Health Endpoints

### Manual Test
```bash
# Task service health
curl http://localhost:3001/health

# Expected response
{
  "status": "ok",
  "uptime": 123.456,
  "timestamp": "2026-03-29T10:00:00.000Z"
}

# Scheduler service health
curl http://localhost:3002/health

# Expected response
{
  "status": "ok",
  "raft": { "state": "follower", "term": 5 },
  "kafka": "connected"
}
```

### Kubernetes Probe Configuration
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  successThreshold: 2
```

### What to Look For
- ✅ Returns 200 OK
- ✅ Response includes service status
- ✅ Includes dependency health (DB, Kafka, etc.)
- ✅ Fast response (< 1 second)

---

## ✅ 10. Testing Structured Logging

### Manual Test
```typescript
logger.info({ userId: '123', action: 'login' }, 'User logged in');
logger.error({ error, taskId: '456' }, 'Task failed');
```

### Log Output (Development)
```
[INFO] 2026-03-29T10:00:00.000Z User logged in { userId: '123', action: 'login' }
[ERROR] 2026-03-29T10:00:01.000Z Task failed { error: 'Timeout', taskId: '456' }
```

### Log Output ( Production)
```json
{"level":"info","time":"2026-03-29T10:00:00.000Z","msg":"User logged in","userId":"123","action":"login"}
{"level":"error","time":"2026-03-29T10:00:01.000Z","msg":"Task failed","error":"Timeout","taskId":"456"}
```

### Log Aggregation Check
```bash
# Search logs in Grafana/Loki
{app="backend"} | json | userId="123"

# Search errors in Datadog
@level:error @taskId:456
```

### What to Look For
- ✅ JSON format in production
- ✅ Pretty-printed in development
- ✅ Consistent structure
- ✅ Contextual fields included
- ✅ Proper log levels used

---

## 🎯 COMPREHENSIVE FAILURE SCENARIO TEST

### Scenario: Task Service Unavailable

```typescript
// 1. Circuit breaker should open
try {
  await retryWithBackoff(
    () => callWithCircuitBreaker(taskServiceBreaker, () =>
      axios.get('http://task-service:3001/tasks')
    ),
    { maxRetries: 3 }
  );
} catch (error) {
  console.log('Task service unavailable');
}

// 2. Check circuit breaker state
console.log(taskServiceBreaker.getState()); // Should be OPEN

// 3. Subsequent calls should fail fast
try {
  await taskServiceBreaker.execute(() => axios.get(url));
} catch (error) {
  console.log('Circuit breaker rejected call'); // ✓
}

// 4. Failed tasks go to DLQ
await dlqService.sendToDLQ({ /* ... */ });

// 5. System remains stable despite failure
console.log('System still running'); // ✓
```

---

## 📊 METRICS TO MONITOR

### Circuit Breaker Metrics
```typescript
const metrics = circuitBreakerRegistry.getAllMetrics();
console.table(metrics);
/*
| Service       | State    | Failures | Successes | Rejected |
|---------------|----------|----------|-----------|----------|
| task-service  | CLOSED   | 0        | 150       | 0        |
| node-service  | HALF_OPEN| 5        | 1         | 12       |
| kafka         | CLOSED   | 0        | 1000      | 0        |
*/
```

### DLQ Metrics
```typescript
const dlqStats = await dlqService.getStats();
console.log(dlqStats);
/*
{
  pending: 3,
  processing: 1,
  resolved: 150,
  exhausted: 2,
  totalRetries: 45
}
*/
```

### Retry Metrics
```typescript
// Count retry attempts by service
const retryAttempts = logger.search({ level: 'warn', message: 'Retry attempt' });
console.log(`Total retries: ${retryAttempts.length}`);
```

---

## 🚨 TROUBLESHOOTING

### Issue: Circuit breaker not opening

**Check:**
1. Failure threshold too high?
2. Are errors being caught properly?
3. Is breaker wrapped around the call?

### Issue: Retries causing load spikes

**Check:**
1. Add jitter to prevent thundering herd
2. Reduce max retries
3. Implement retry budget

### Issue: WebSocket events still lost

**Check:**
1. Is `subscribe()` called before `connect()`?
2. Are you checking `isConnected` flag?
3. Review flushPendingSubscriptions() logs

### Issue: Idempotency not working

**Check:**
1. Same idempotency key being sent?
2. TTL too short?
3. Distributed lock working?

---

## ✅ FINAL VALIDATION CHECKLIST

- [ ] All retry tests passing
- [ ] Circuit breakers opening/closing correctly
- [ ] Timeouts enforced on all external calls
- [ ] WebSocket subscriptions queued when disconnected
- [ ] Graceful shutdown completes cleanly
- [ ] Idempotency prevents duplicates
- [ ] DLQ captures failed messages
- [ ] Input validation rejects bad data
- [ ] Health endpoints respond quickly
- [ ] Logs structured and searchable

---

**Validation Status:** READY FOR TESTING  
**Last Updated:** March 29, 2026  
**Owner:** Senior Distributed Systems Engineer
